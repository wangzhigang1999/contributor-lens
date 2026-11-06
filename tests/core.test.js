import { test } from "node:test";
import assert from "node:assert/strict";
import { search, statistics, classify, markdown } from "../core.js";
import { createService } from "../background.js";
const now = Date.parse("2026-11-06T12:00:00Z");
const pr = (id, time = now, state = "open", merged = null) => ({
  id,
  title: `PR ${id}`,
  created_at: new Date(time).toISOString(),
  html_url: `https://github.com/o/r/pull/${id}`,
  state,
  pull_request: { merged_at: merged },
});
function storage() {
  let data = {};
  return {
    async get(keys) {
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k) => [
          k,
          structuredClone(data[k]),
        ]),
      );
    },
    async set(x) {
      Object.assign(data, structuredClone(x));
    },
  };
}
const response = (status, data = {}, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
test("exact timestamps, three disjoint states, duplicates, future and cutoff date", async () => {
  const r = await search({
    user: "octocat",
    days: 1,
    now,
    request: async () => ({
      total_count: 6,
      items: [
        pr(1),
        pr(2, now - 1000, "closed", "2026-11-06"),
        pr(3, now - 2000, "closed"),
        pr(4, now - 864e5 - 1),
        pr(5, now + 1),
        pr(1),
      ],
    }),
  });
  assert.equal(r.items.length, 3);
  assert.deepEqual(statistics(r).counts, { open: 1, merged: 1, closed: 1 });
  assert.match(markdown(r), /github.com\/o\/r\/pull\/1/);
});
test("sliding window crosses clock buckets; local zero days", () => {
  const r = {
    now,
    cutoff: now - 3 * 864e5,
    items: [0, 550000, 590000, 1200000].map((x, i) => ({
      created: new Date(now - 1800000 + x).toISOString(),
      repo: "o/r",
      state: "open",
    })),
  };
  const s = statistics(r);
  assert.equal(s.peak10, 3);
  assert.equal(s.adjacent60, 1);
  assert.equal(s.daily.length, 4);
  assert.equal(s.daily.filter((x) => x[1] === 0).length, 3);
});
test("zero results success; incomplete flag and cap", async () => {
  for (const total of [0, 1000]) {
    const r = await search({
      user: "octocat",
      days: 7,
      now,
      request: async () => ({ total_count: total, items: [] }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.incomplete, total === 1000);
  }
  const r = await search({
    user: "octocat",
    days: 7,
    now,
    request: async () => ({
      total_count: 0,
      incomplete_results: true,
      items: [],
    }),
  });
  assert.equal(r.incomplete, true);
});
test("403 evidence classification", () => {
  assert.equal(classify(403, new Headers(), "Forbidden"), "http");
  assert.equal(
    classify(403, new Headers({ "x-ratelimit-remaining": "0" })),
    "rate_limit",
  );
  assert.equal(
    classify(
      403,
      new Headers(),
      "Resource not accessible by personal access token",
    ),
    "permission",
  );
  assert.equal(classify(401, new Headers()), "token_rejected");
  assert.equal(classify(422, new Headers()), "account_unsearchable");
});
test("page 2 rate limit logs both requests and persists on service restart", async () => {
  const st = storage();
  let calls = 0;
  const svc = createService(st, async () =>
    ++calls === 1
      ? response(200, {
          total_count: 150,
          items: Array.from({ length: 100 }, (_, i) => pr(i)),
        })
      : response(429, {}, { "retry-after": "30" }),
  );
  const r = await svc.handle({ type: "query", user: "octocat", days: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.error.page, 2);
  assert.equal(r.error.kind, "rate_limit");
  const logs = (await createService(st).handle({ type: "logs" })).logs;
  assert.deepEqual(
    logs.map((x) => x.status),
    [200, 429],
  );
  assert.deepEqual(
    logs.map((x) => x.page),
    [1, 2],
  );
  assert(!JSON.stringify(logs).includes("octocat"));
  assert.equal((await st.get("cache")).cache, undefined);
});
test("concurrent dedup, serialized logs, limit two requests, cache 12 and log 100", async () => {
  const st = storage();
  let calls = 0,
    active = 0,
    max = 0;
  const svc = createService(st, async () => {
    calls++;
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    return response(200, { total_count: 0, items: [] });
  });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      svc.handle({ type: "query", user: "same", days: 7 }),
    ),
  );
  assert.equal(calls, 1);
  for (let n = 0; n < 11; n++)
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        svc.handle({ type: "query", user: `user${n * 10 + i}`, days: 7 }),
      ),
    );
  assert(max <= 2);
  assert.equal((await st.get("logs")).logs.length, 100);
  assert.equal((await st.get("cache")).cache.length, 12);
});
test("changing token prevents old request cache writes and old token goes only to GitHub", async () => {
  const st = storage();
  let resolve;
  let observed;
  const svc = createService(st, async (url, options) => {
    observed = { url, options };
    await new Promise((r) => (resolve = r));
    return response(200, { total_count: 0, items: [] });
  });
  await svc.handle({ type: "token", token: "old-secret" });
  const pending = svc.handle({ type: "query", user: "octocat", days: 7 });
  while (!resolve) await new Promise((r) => setTimeout(r, 1));
  await svc.handle({ type: "token", token: "new-secret" });
  resolve();
  const r = await pending;
  assert.equal(r.error.kind, "credentials_changed");
  assert.equal((await st.get("cache")).cache.length, 0);
  assert.equal(new URL(observed.url).hostname, "api.github.com");
  assert.equal(observed.options.headers.Authorization, "Bearer old-secret");
  assert(!JSON.stringify((await st.get("logs")).logs).includes("secret"));
});
test("network and HTTP errors remain distinct", async () => {
  for (const [mode, kind] of [
    [403, "http"],
    [401, "token_rejected"],
    [422, "account_unsearchable"],
    [0, "network"],
  ]) {
    const svc = createService(storage(), async () => {
      if (!mode) throw new TypeError("offline");
      return response(mode);
    });
    const r = await svc.handle({ type: "query", user: "someone", days: 7 });
    assert.equal(r.error.kind, kind);
    assert.equal((await svc.handle({ type: "logs" })).logs.length, 1);
  }
});

test("authenticated cache survives worker restart and remains isolated after token removal", async () => {
  const st = storage();
  const service = createService(st, async () =>
    response(200, { total_count: 0, items: [] }),
  );
  await service.handle({ type: "token", token: "test-token" });
  await service.handle({ type: "query", user: "user", days: 7 });
  const restarted = createService(st, async () => {
    throw new Error("cache should avoid fetch");
  });
  assert.equal(
    (await restarted.handle({ type: "query", user: "user", days: 7 })).cached,
    true,
  );
  await restarted.handle({ type: "token", token: "" });
  assert.equal((await st.get("cache")).cache.length, 0);
});
