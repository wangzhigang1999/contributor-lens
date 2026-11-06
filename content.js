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
    const style = document.createElement("style");
    style.textContent = `
      :host { display: inline-block; margin-left: 6px; color: #20242c; font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      button { cursor: pointer; border: 1px solid #dce1e8; border-radius: 6px; background: #fff; color: #606976; padding: 2px 8px; font: inherit; transition: background 140ms, border-color 140ms; }
      button:hover { color: #2563eb; border-color: #afc5ed; background: #f4f7fc; }
      button:focus-visible, a:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
      button[aria-expanded=true] { color: #2563eb; border-color: #afc5ed; background: #f4f7fc; }
      section { position: fixed; z-index: 2147483646; top: 80px; right: 20px; left: auto; bottom: auto; margin: 0; width: min(392px, calc(100vw - 40px)); max-height: calc(100vh - 104px); overflow: auto; background: #fff; color: #20242c; border: 1px solid #dce1e8; border-radius: 12px; box-shadow: 0 8px 32px #17233514; padding: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .card-header { padding: 20px 20px 0; }
      .card-brand { font-size: 11px; color: #727c89; margin: 0 0 8px; }
      h3 { margin: 0; font-size: 18px; font-weight: 500; color: #20242c; }
      p { margin: 0; }
      .card-info { padding: 8px 20px 16px; color: #727c89; font-size: 12px; }
      .close { float: right; padding: 2px 6px; min-width: 24px; border: 0; background: transparent; color: #727c89; font-size: 18px; line-height: 20px; }
      .card-counts { display: grid; grid-template-columns: repeat(3, 1fr); padding: 0 20px 16px; border-bottom: 1px solid #e6e9ee; gap: 16px; }
      .card-counts strong { display: block; color: #20242c; font-size: 24px; font-weight: 500; line-height: 1.2; font-variant-numeric: tabular-nums; }
      .card-counts span { display: block; color: #727c89; font-size: 11px; margin-top: 4px; }
      h4 { margin: 0; padding: 16px 20px 8px; font-size: 12px; font-weight: 500; }
      .card-repos { max-height: 104px; overflow: auto; padding: 0 20px 8px; }
      .repo-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 4px 0; color: #606976; font-size: 12px; }
      .repo-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .repo-count { color: #727c89; font-family: ui-monospace, Consolas, monospace; }
      .card-prs { max-height: 216px; overflow: auto; padding: 0 20px; }
      .record { display: block; padding: 10px 0; border-bottom: 1px solid #edf0f4; color: #20242c; text-decoration: none; font-size: 12px; line-height: 1.5; }
      .record:last-child { border-bottom: 0; }
      .record:hover { color: #2563eb; }
      .record small { display: block; margin-top: 4px; color: #727c89; font-size: 11px; }
      .card-footer { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 12px; padding: 12px 20px; border-top: 1px solid #e6e9ee; background: #fafbfc; }
      .card-footer span { color: #727c89; font-size: 11px; }
      .full-report { color: #2563eb; text-decoration: none; font-size: 12px; font-weight: 500; white-space: nowrap; }
      .full-report:hover { text-decoration: underline; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } }
    `;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Check activity";
    root.append(style, b);
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
    b.setAttribute("aria-expanded", "false");
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    b.addEventListener("click", async () => {
      const existing = root.querySelector("section");
      if (existing) {
        existing.remove();
        b.setAttribute("aria-expanded", "false");
        return;
      }
      const card = node("section");
      // A popover stays above GitHub's clipping and transformed list containers.
      card.setAttribute("popover", "manual");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", `${user} activity`);
      const dismiss = () => {
        card.remove();
        b.setAttribute("aria-expanded", "false");
        b.focus();
      };
      const header = node("div", "card-header");
      const close = node("button", "close", "×");
      close.setAttribute("aria-label", "Close activity card");
      close.onclick = dismiss;
      header.append(
        close,
        node("p", "card-brand", "Contributor Lens"),
        node("h3", "", `@${user}`),
      );
      const info = node("p", "card-info", "Loading last 7 days…");
      card.append(header, info);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Escape") dismiss();
      });
      root.append(card);
      card.showPopover();
      b.setAttribute("aria-expanded", "true");
      const response = await load();
      if (!card.isConnected) return;
      if (!response.ok) {
        info.textContent = `Query failed: ${response.error?.kind}; page ${response.error?.page || "—"}. Earlier pages are not shown as complete results.`;
        return;
      }
      const counts = { open: 0, merged: 0, closed: 0 },
        repositories = {};
      for (const pr of response.items) {
        counts[pr.state]++;
        repositories[pr.repo] = (repositories[pr.repo] || 0) + 1;
      }
      info.textContent = `${response.items.length} PRs created in the last 7 days${response.incomplete ? " · incomplete results" : ""}${response.items.length ? "" : " · query succeeded, no activity"}`;
      const stats = node("div", "card-counts");
      for (const [state, label] of [
        ["open", "Open"],
        ["merged", "Merged"],
        ["closed", "Closed, not merged"],
      ]) {
        const stat = node("div");
        stat.append(node("strong", "", counts[state]), node("span", "", label));
        stats.append(stat);
      }
      const repoList = node("div", "card-repos");
      for (const [repository, count] of Object.entries(repositories).sort(
        (a, b) => b[1] - a[1],
      )) {
        const row = node("div", "repo-row");
        const name = node("span", "repo-name", repository);
        name.title = repository;
        row.append(name, node("span", "repo-count", count));
        repoList.append(row);
      }
      card.append(
        stats,
        node("h4", "", "Active repositories"),
        repoList,
        node("h4", "", "Original records"),
      );
      const records = node("div", "card-prs");
      for (const pr of response.items) {
        const link = node("a", "record", pr.title);
        link.href = pr.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const number = new URL(pr.url).pathname.split("/").pop();
        link.append(node("small", "", `${pr.repo} #${number} · ${pr.state}`));
        records.append(link);
      }
      const footer = node("div", "card-footer");
      const full = node("a", "full-report", "Open full report ↗");
      full.href = chrome.runtime.getURL(`popup.html?user=${encodeURIComponent(user)}`);
      full.target = "_blank";
      full.onclick = (event) => {
        event.preventDefault();
        send({ type: "openReport", user });
      };
      footer.append(node("span", "", "Original records. No scores."), full);
      card.append(records, footer);
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
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/);
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
        if (!initialHeader.querySelector(".cl-host")) make(initialAuthor, detailUser);
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
    const list = location.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pulls)\/?$/);
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
