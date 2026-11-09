import { search, classify, validate, isBot } from "./core.js";
export function createService(storage, fetcher = fetch) {
  let serial = Promise.resolve(),
    generation = 0,
    flights = new Map(),
    active = 0,
    waiting = [];
  const locked = (fn) => {
    const p = serial.then(fn);
    serial = p.catch(() => {});
    return p;
  };
  const ready = Promise.resolve(
    storage.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }),
  ).then(async () => {
    generation = (await storage.get("credentialEpoch")).credentialEpoch || 0;
  });
  async function request(path, { token, page = null, operation }) {
    if (active >= 2) await new Promise((r) => waiting.push(r));
    else active++;
    const start = Date.now();
    let status = null,
      kind = null,
      headers = new Headers();
    try {
      const res = await fetcher("https://api.github.com" + path, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      status = res.status;
      headers = res.headers;
      const body = await res.text();
      if (!res.ok) {
        kind = classify(status, headers, body);
        throw Object.assign(new Error(kind), { kind, status });
      }
      return JSON.parse(body);
    } catch (e) {
      kind ||= "network";
      throw Object.assign(e, { kind, status });
    } finally {
      const durationMs = Date.now() - start;
      try {
        await locked(async () => {
          const { logs = [] } = await storage.get("logs");
          logs.push({
            time: new Date(start).toISOString(),
            operation,
            page,
            durationMs,
            status,
            failure: kind,
            rate: {
              remaining: headers.get("x-ratelimit-remaining"),
              limit: headers.get("x-ratelimit-limit"),
              reset: headers.get("x-ratelimit-reset"),
              retryAfter: headers.get("retry-after"),
            },
          });
          await storage.set({ logs: logs.slice(-100) });
        });
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    }
  }
  async function handle(m) {
    await ready;
    if (m.type === "openReport") {
      validate(m.user, 7);
      await chrome.tabs.create({
        url: chrome.runtime.getURL(
          "popup.html?user=" + encodeURIComponent(m.user) + "&days=7",
        ),
      });
      return { ok: true };
    }
    if (m.type === "settings")
      return locked(async () => ({
        authenticated: !!(await storage.get("token")).token,
      }));
    if (m.type === "token")
      return locked(async () => {
        generation++;
        await storage.set({
          token: String(m.token || "").trim(),
          credentialEpoch: generation,
          cache: [],
        });
        // Tab IDs are available without the broad tabs permission.
        if (globalThis.chrome?.tabs) {
          chrome.tabs
            .query({})
            .then((tabs) => {
              for (const tab of tabs)
                chrome.tabs
                  .sendMessage(tab.id, { type: "credentialsChanged" })
                  .catch(() => {});
            })
            .catch(() => {});
        }
        return { ok: true };
      });
    if (m.type === "logs")
      return locked(async () => ({
        logs: (await storage.get("logs")).logs || [],
      }));
    if (m.type === "prAuthor") {
      if (!/^[-\w.]+\/[-\w.]+\/\d+$/.test(m.path)) throw new Error("Invalid PR");
      const { token } = await locked(() => storage.get("token"));
      const [o, r, n] = m.path.split("/");
      const p = await request(`/repos/${o}/${r}/pulls/${n}`, {
        token,
        operation: "pr_author",
      });
      return { user: p.user.type === "Bot" || isBot(p.user.login) ? null : p.user.login };
    }
    if (m.type !== "query") throw new Error("Unknown operation");
    validate(m.user, m.days);
    m.user = m.user.toLowerCase();
    const snapshot = await locked(async () => {
      const { token = "", cache = [] } = await storage.get(["token", "cache"]);
      return { token, cache, epoch: generation };
    });
    const key = `${snapshot.epoch}:${snapshot.token ? "auth" : "anon"}:${m.user}:${m.days}`;
    const cached = snapshot.cache.find(
      (c) => c.key === key && Date.now() - c.time < 600000,
    );
    if (cached) return { ...cached.result, cached: true };
    if (flights.has(key)) return flights.get(key);
    const promise = (async () => {
      const result = await search({
        user: m.user,
        days: m.days,
        token: snapshot.token,
        request,
      });
      if (snapshot.epoch !== generation)
        return { ok: false, error: { kind: "credentials_changed" } };
      if (result.ok)
        await locked(async () => {
          if (snapshot.epoch !== generation) return;
          const { cache = [] } = await storage.get("cache");
          await storage.set({
            cache: [
              { key, time: Date.now(), result },
              ...cache.filter((c) => c.key !== key),
            ].slice(0, 12),
          });
        });
      return result;
    })();
    flights.set(key, promise);
    try {
      return await promise;
    } finally {
      flights.delete(key);
    }
  }
  return { handle };
}
if (globalThis.chrome?.runtime?.onMessage) {
  const service = createService(chrome.storage.local);
  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (s.id !== chrome.runtime.id) return;
    service.handle(m).then(reply, (e) =>
      reply({
        ok: false,
        error: { kind: e.kind || "internal", status: e.status || null },
      }),
    );
    return true;
  });
}
