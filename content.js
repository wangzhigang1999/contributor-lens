(() => {
  const send = (m) => chrome.runtime.sendMessage(m),
    valid = (u) => /^[a-z\d][a-z\d-]{0,38}(?:\[bot\])?$/i.test(u || "");
  let pageKey = "",
    auto = new Set(),
    queue = [],
    running = 0,
    limit = 4,
    detail = "",
    detailUser = "",
    scanTimer;
  const hosts = new Set();
  function url(h) {
    try {
      const u = new URL(h, location.href);
      return u.origin === location.origin ? u : null;
    } catch {
      return null;
    }
  }
  function author(el) {
    const hover = el.getAttribute("data-hovercard-url");
    if (hover) {
      const u = url(hover),
        m = u?.pathname.match(/^\/users\/([^/]+)\/hovercard$/);
      if (m && valid(m[1])) return m[1];
    }
    const u = url(el.getAttribute("href") || "");
    if (!u) return null;
    const q = u.searchParams.get("q") || "",
      a = q.match(/(?:^|\s)author:([a-z\d-]+(?:\[bot\])?)(?:\s|$)/i);
    if (a && valid(a[1])) return a[1];
    const m = u.pathname.match(/^\/([^/]+)\/?$/);
    return m &&
      valid(m[1]) &&
      ![
        "issues",
        "pulls",
        "marketplace",
        "explore",
        "settings",
        "notifications",
        "login",
        "signup",
        "orgs",
        "features",
        "topics",
        "sponsors",
      ].includes(m[1])
      ? m[1]
      : null;
  }
  function make(anchor, user) {
    if (anchor.parentElement?.querySelector(":scope > .cl-host")) {
      const old = anchor.parentElement.querySelector(":scope > .cl-host");
      if (old.dataset.user === user) return;
      old.remove();
    }
    const host = document.createElement("span");
    host.className = "cl-host";
    host.dataset.user = user;
    host.addEventListener("click", (e) => e.stopPropagation());
    anchor.after(host);
    hosts.add(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{display:inline-block;margin-left:6px;font:12px system-ui;color:#1f2328}button{cursor:pointer;border:1px solid #8c959f;border-radius:6px;background:#f6f8fa;color:#24292f;padding:3px 8px;font:inherit}section{position:fixed;z-index:2147483646;top:80px;right:20px;width:min(380px,calc(100vw - 40px));max-height:70vh;overflow:auto;background:white;border:1px solid #8c959f;border-radius:9px;box-shadow:0 8px 30px #0003;padding:16px;font:13px/1.6 system-ui}a{color:#0969da;display:block}h3{margin:0}p{margin:8px 0}.close{float:right}</style><button type="button">Check activity</button>`;
    const b = root.querySelector("button");
    let result, pending;
    async function load() {
      if (pending) return pending;
      b.textContent = "Checking…";
      pending = send({ type: "query", user, days: 7 })
        .then((r) => {
          result = r;
          b.textContent = r.ok
            ? `${r.items.length} PR · ${r.items.filter((p) => p.state === "open").length} open${r.incomplete ? " · partial" : ""}`
            : "Retry activity";
          return r;
        })
        .catch(() => {
          result = { ok: false, error: { kind: "extension_unavailable" } };
          b.textContent = "Retry activity";
          return result;
        })
        .finally(() => (pending = null));
      return pending;
    }
    b.addEventListener("click", async () => {
      if (root.querySelector("section")) {
        root.querySelector("section").remove();
        return;
      }
      const card = document.createElement("section");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", `${user} activity`);
      const close = document.createElement("button");
      close.className = "close";
      close.textContent = "Close";
      close.onclick = () => card.remove();
      card.append(close);
      const title = document.createElement("h3");
      title.textContent = user;
      card.append(title);
      const info = document.createElement("p");
      info.textContent = "Loading last 7 days…";
      card.append(info);
      root.append(card);
      const r = await load();
      if (!card.isConnected) return;
      if (!r.ok) {
        info.textContent = `查询失败：${r.error?.kind}，页码 ${r.error?.page || "—"}。未显示不完整前页统计。`;
        return;
      }
      const counts = { open: 0, merged: 0, closed: 0 },
        repos = {};
      r.items.forEach((p) => {
        counts[p.state]++;
        repos[p.repo] = (repos[p.repo] || 0) + 1;
      });
      info.textContent = `最近 7 天创建 ${r.items.length} PR · ${counts.open} open · ${counts.merged} merged · ${counts.closed} closed without merge${r.incomplete ? " · 结果不完整" : ""}${r.items.length ? "" : " · 查询成功，没有活动"}`;
      const repo = document.createElement("p");
      repo.textContent = Object.entries(repos)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
      card.append(repo);
      for (const p of r.items) {
        const a = document.createElement("a");
        a.href = p.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = `${p.repo} — ${p.title} (${p.state})`;
        card.append(a);
      }
      const full = document.createElement("a");
      full.href = chrome.runtime.getURL(
        `popup.html?user=${encodeURIComponent(user)}`,
      );
      full.target = "_blank";
      full.textContent = "Open full report / 完整报告";
      full.onclick = (e) => {
        e.preventDefault();
        send({ type: "openReport", user });
      };
      card.append(full);
    });
    host._load = load;
    observer.observe(host);
  }
  function pump() {
    while (running < 2 && queue.length) {
      const h = queue.shift();
      if (!h.isConnected || auto.has(h.dataset.user)) continue;
      if (auto.size >= limit) continue;
      auto.add(h.dataset.user);
      running++;
      h._load().finally(() => {
        running--;
        pump();
      });
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          observer.unobserve(e.target);
          queue.push(e.target);
        }
      pump();
    },
    { rootMargin: "200px" },
  );
  async function scan() {
    for (const h of hosts)
      if (!h.isConnected) {
        observer.unobserve(h);
        hosts.delete(h);
      }
    const key = location.pathname + location.search;
    if (key !== pageKey) {
      pageKey = key;
      auto = new Set();
      queue = [];
      for (const h of hosts) {
        h.remove();
        observer.unobserve(h);
      }
      hosts.clear();
      detailUser = "";
      detail = "";
      send({ type: "settings" })
        .then((s) => {
          limit = s.authenticated ? 24 : 4;
          pump();
        })
        .catch(() => {});
    }
    const match = location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/,
    );
    if (match) {
      const path = match.slice(1).join("/");
      // Only the PR header may supply a DOM fallback; never inspect timeline authors.
      const initialHeader = document.querySelector(
        '#partial-discussion-header, .gh-header, [data-testid="issue-header"]',
      );
      const initialAuthor = initialHeader?.querySelector("a.author");
      const initialUser = initialAuthor && author(initialAuthor);
      if (!detailUser && initialUser) {
        detailUser = initialUser;
        if (!initialHeader.querySelector(".cl-host"))
          make(initialAuthor, detailUser);
      }
      if (detail !== path) {
        detail = path;
        try {
          const r = await send({ type: "prAuthor", path });
          if (detail !== path) return;
          detailUser = r.user || detailUser;
        } catch {
          detail = "";
        }
      }
      if (detailUser) {
        const header =
          document.querySelector(
            '#partial-discussion-header, .gh-header, [data-testid="issue-header"], [class*="PageHeader-TitleArea"]',
          ) || document.querySelector("main h1")?.parentElement;
        const a =
          header?.querySelector(
            '.author, [data-hovercard-type="user"], a[href="/' +
              CSS.escape(detailUser) +
              '"]',
          ) ||
          header?.querySelector("h1") ||
          header;
        const existing = header?.querySelector(".cl-host");
        if (existing && existing.dataset.user !== detailUser) existing.remove();
        if (a && !header.querySelector(".cl-host")) make(a, detailUser);
      }
      return;
    }
    const list = location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/(issues|pulls)\/?$/,
    );
    if (!list) return;
    for (const a of document.querySelectorAll("a[href]")) {
      if (a.closest(".cl-host")) continue;
      const u = url(a.getAttribute("href"));
      const m = u?.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)$/);
      if (
        !m ||
        m[1] !== list[1] ||
        m[2] !== list[2] ||
        (list[3] === "pulls" && m[3] !== "pull")
      )
        continue;
      const row = a.closest(
        '.js-issue-row, [id^="issue_"], [data-testid="issue-row"], [data-testid="list-row"], .Box-row, [role="listitem"], [class*="ListItem-module__listItem"], li[class*="listItem__"]',
      );
      if (!row) continue;
      const primary = row.querySelectorAll(
        '.opened-by a, a.author, [data-testid="author-filter-link"], a[href*="author"]',
      );
      const fallback = row.querySelectorAll(
        'a[data-hovercard-type="user"], button[data-hovercard-url], a[data-hovercard-url]',
      );
      for (const candidate of new Set([...primary, ...fallback])) {
        const user = author(candidate);
        if (user) {
          make(candidate, user);
          break;
        }
      }
    }
  }
  const schedule = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 120);
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  for (const event of ["turbo:load", "turbo:render", "pjax:end", "popstate"])
    addEventListener(event, schedule);
  setInterval(() => {
    if (pageKey !== location.pathname + location.search) schedule();
  }, 1000);
  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (m.type === "credentialsChanged") {
      pageKey = "";
      schedule();
      reply({ ok: true });
      return;
    }
    if (m.type === "context") {
      const p = location.pathname.match(/^\/([^/]+)\/?$/);
      reply({
        user:
          detailUser ||
          (p &&
          valid(p[1]) &&
          document.querySelector("[itemprop=additionalName], .vcard-username")
            ? p[1]
            : null),
      });
    }
  });
  scan();
})();
