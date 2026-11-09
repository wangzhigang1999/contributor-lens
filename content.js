(() => {
  const send = (m) => chrome.runtime.sendMessage(m),
    isBot = globalThis.ContributorLensAuthors.isBot,
    valid = (u) => /^[a-z\d][a-z\d-]{0,38}(?:\[bot\])?$/i.test(u || "");
  let pageKey = "",
    auto = new Set(),
    queue = [],
    running = 0,
    limit = 4,
    detail = "",
    detailUser = "",
    excludedDetail = "",
    openCard,
    scanTimer;
  const hosts = new Set();
  function positionCard() {
    if (!openCard) return;
    const { card, trigger } = openCard;
    if (!card.matches(":popover-open")) {
      openCard = null;
      return;
    }
    const anchor = trigger.getBoundingClientRect();
    const { clientWidth: width, clientHeight: height } = document.scrollingElement;
    if (anchor.bottom <= 0 || anchor.top >= height) {
      card.hidePopover();
      return;
    }
    const gap = 8,
      edge = 12;
    const below = height - anchor.bottom - gap - edge;
    const above = anchor.top - gap - edge;
    const placeAbove = card.scrollHeight + 2 > below && above > below;
    const left = Math.max(edge, Math.min(anchor.left, width - card.offsetWidth - edge));
    card.style.left = `${left}px`;
    card.style.top = placeAbove ? "auto" : `${anchor.bottom + gap}px`;
    card.style.bottom = placeAbove ? `${height - anchor.top + gap}px` : "auto";
    card.style.maxHeight = `${Math.max(0, placeAbove ? above : below)}px`;
  }
  addEventListener("scroll", positionCard, true);
  addEventListener("resize", positionCard);
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
  function botAuthor(el, user) {
    return (
      isBot(user) ||
      el?.getAttribute("data-hovercard-type") === "bot" ||
      /\[bot\]\s*$/i.test(el?.textContent.trim() || "") ||
      /^\/apps\/[^/]+\/?$/.test(url(el?.getAttribute("href") || "")?.pathname || "")
    );
  }
  function make(anchor, user, detailEntry = false) {
    if (isBot(user)) return;
    const owner = detailEntry ? anchor : anchor.parentElement;
    if (owner?.querySelector(":scope > .cl-host")) {
      const old = owner.querySelector(":scope > .cl-host");
      if (old.dataset.user === user) return;
      old.remove();
    }
    const host = document.createElement("span");
    host.className = "cl-host";
    host.dataset.user = user;
    host.addEventListener("click", (e) => e.stopPropagation());
    host.dataset.placement = detailEntry ? "detail" : "inline";
    if (detailEntry) anchor.append(host);
    else anchor.after(host);
    hosts.add(host);
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { display: inline-block; margin-left: 6px; color: #20242c; font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      button { cursor: pointer; border: 1px solid #dce1e8; border-radius: 6px; background: #fff; color: #606976; padding: 2px 8px; font: inherit; transition: background 140ms, border-color 140ms; }
      button:hover { color: #2563eb; border-color: #afc5ed; background: #f4f7fc; }
      :host([data-placement="detail"]) { display: block; width: 100%; flex-shrink: 0; margin: 12px 0 0; max-width: 100%; }
      .detail-trigger { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 32px; padding: 6px 10px; border-color: var(--borderColor-default, #dce1e8); background: var(--bgColor-default, #fff); color: var(--fgColor-default, #20242c); text-align: left; }
      .detail-trigger .entry-label { font-weight: 500; }
      .detail-trigger .entry-summary { color: var(--fgColor-muted, #606976); font-variant-numeric: tabular-nums; }
      .detail-trigger .entry-window { color: var(--fgColor-muted, #727c89); font-size: 11px; border-left: 1px solid var(--borderColor-default, #dce1e8); padding-left: 10px; }
      .detail-trigger svg { width: 14px; height: 14px; stroke: var(--fgColor-muted, #606976); stroke-width: 1.5; flex-shrink: 0; }
      button:focus-visible, a:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
      button[aria-expanded=true] { color: #2563eb; border-color: #afc5ed; background: #f4f7fc; }
      section { position: fixed; inset: auto; margin: 0; width: min(392px, calc(100% - 24px)); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; background: #fff; color: #20242c; border: 1px solid #dce1e8; border-radius: 8px; box-shadow: 0 4px 20px #17233512; padding: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .card-header { position: sticky; top: 0; z-index: 1; padding: 12px 16px 4px; background: #fff; }
      h3 { margin: 0; font-size: 15px; line-height: 24px; font-weight: 600; color: #20242c; overflow-wrap: anywhere; }
      p { margin: 0; }
      .card-info { padding: 0 16px 8px; color: #606976; font-size: 12px; }
      .close { float: right; padding: 2px 6px; min-width: 24px; border: 0; background: transparent; color: #727c89; font-size: 18px; line-height: 20px; }
      .card-counts { display: grid; grid-template-columns: repeat(3, 1fr); padding: 0 16px 8px; border-bottom: 1px solid #e6e9ee; gap: 16px; }
      .card-counts strong { display: block; color: #20242c; font-size: 20px; font-weight: 600; line-height: 24px; font-variant-numeric: tabular-nums; }
      .card-counts span { display: block; color: #606976; font-size: 11px; line-height: 16px; margin-top: 2px; }
      .card-section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 8px 16px 4px; }
      h4 { margin: 0; font-size: 12px; font-weight: 600; }
      .preview-count { color: #727c89; font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .card-repos { padding: 0 16px 4px; }
      .repo-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; color: #606976; font-size: 12px; line-height: 20px; }
      .repo-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .repo-count { color: #727c89; font-family: ui-monospace, Consolas, monospace; }
      .card-prs { padding: 0 16px; }
      .record { display: block; padding: 4px 0; border-bottom: 1px solid #edf0f4; color: #20242c; text-decoration: none; font-size: 12px; line-height: 18px; }
      .record-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .record:last-child { border-bottom: 0; }
      .record:hover { color: #2563eb; }
      .record small { display: block; margin-top: 2px; color: #606976; font-size: 11px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .card-footer { position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 4px; padding: 8px 16px; border-top: 1px solid #e6e9ee; background: #fafbfc; }
      .card-footer span { color: #727c89; font-size: 11px; }
      .full-report { margin-left: auto; color: #2563eb; text-decoration: none; font-size: 12px; font-weight: 500; white-space: nowrap; }
      .full-report:hover { text-decoration: underline; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } }
    `;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Check activity";
    let summary = b;
    if (detailEntry) {
      b.className = "detail-trigger";
      const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      mark.setAttribute("viewBox", "0 0 16 16");
      mark.setAttribute("fill", "none");
      mark.setAttribute("aria-hidden", "true");
      mark.innerHTML =
        '<circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="3" r="1.5"/><path d="M4 4.5v7m8-7v3A3.5 3.5 0 0 1 8.5 11H4"/>';
      const label = document.createElement("span");
      label.className = "entry-label";
      label.textContent = "Author activity";
      summary = document.createElement("span");
      summary.className = "entry-summary";
      summary.textContent = "Check activity";
      const window = document.createElement("span");
      window.className = "entry-window";
      window.textContent = "Last 7 days";
      b.replaceChildren(mark, label, summary, window);
      b.title = `View @${user}'s pull requests created in the last 7 days`;
    }
    root.append(style, b);
    let result, pending;
    async function load() {
      if (pending) return pending;
      summary.textContent = "Checking…";
      pending = send({ type: "query", user, days: 7 })
        .then((r) => {
          result = r;
          summary.textContent = r.ok
            ? `${r.items.length} PR · ${r.items.filter((p) => p.state === "open").length} open${r.incomplete ? " · partial" : ""}`
            : "Retry activity";
          return r;
        })
        .catch(() => {
          result = { ok: false, error: { kind: "extension_unavailable" } };
          summary.textContent = "Retry activity";
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
    b.addEventListener("click", async (event) => {
      event.preventDefault();
      const existing = root.querySelector("section:popover-open");
      if (existing) {
        existing.hidePopover();
        return;
      }
      const card = node("section");
      // A popover stays above GitHub's clipping and transformed list containers.
      card.setAttribute("popover", "auto");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", `${user} activity`);
      card.addEventListener("toggle", () => {
        if (card.matches(":popover-open")) return;
        if (openCard?.card === card) openCard = null;
        if (b.popoverTargetElement === card) {
          b.popoverTargetElement = null;
          b.setAttribute("aria-expanded", "false");
        }
        card.remove();
      });
      const header = node("div", "card-header");
      const close = node("button", "close", "×");
      close.setAttribute("aria-label", "Close activity card");
      close.onclick = () => {
        card.hidePopover();
        b.focus();
      };
      header.append(close, node("h3", "", `@${user}`));
      const info = node("p", "card-info", "Loading last 7 days…");
      card.append(header, info);
      root.append(card);
      b.popoverTargetElement = card;
      card.showPopover({ source: b });
      b.setAttribute("aria-expanded", "true");
      openCard = { card, trigger: b };
      positionCard();
      const response = await load();
      if (!card.matches(":popover-open")) return;
      if (!response.ok) {
        info.textContent = `Query failed: ${response.error?.kind}; page ${response.error?.page || "—"}. Earlier pages are not shown as complete results.`;
        positionCard();
        return;
      }
      const hasRecords = response.items.length > 0;
      info.textContent = hasRecords
        ? `${response.items.length} PRs created in the last 7 days${response.incomplete ? " · incomplete results" : ""}`
        : response.incomplete
          ? "No matching pull requests returned · incomplete results."
          : "No pull requests created in the last 7 days.";
      if (hasRecords) {
        const counts = { open: 0, merged: 0, closed: 0 },
          repositories = {};
        for (const pr of response.items) {
          counts[pr.state]++;
          repositories[pr.repo] = (repositories[pr.repo] || 0) + 1;
        }
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
        const rankedRepos = Object.entries(repositories).sort((a, b) => b[1] - a[1]);
        for (const [repository, count] of rankedRepos.slice(0, 3)) {
          const row = node("div", "repo-row");
          const name = node("span", "repo-name", repository);
          name.title = repository;
          row.append(name, node("span", "repo-count", count));
          repoList.append(row);
        }
        const repoHeading = node("div", "card-section-heading");
        repoHeading.append(node("h4", "", "Active repositories"));
        if (rankedRepos.length > 3)
          repoHeading.append(
            node("span", "preview-count", `Top 3 of ${rankedRepos.length}`),
          );
        const recordHeading = node("div", "card-section-heading");
        recordHeading.append(
          node("h4", "", "Recent pull requests"),
          node(
            "span",
            "preview-count",
            `Showing ${Math.min(3, response.items.length)} of ${response.items.length}`,
          ),
        );
        card.append(stats, repoHeading, repoList, recordHeading);
        const records = node("div", "card-prs");
        const recent = [...response.items].sort(
          (a, b) => Date.parse(b.created) - Date.parse(a.created),
        );
        for (const pr of recent.slice(0, 3)) {
          const link = node("a", "record");
          link.append(node("span", "record-title", pr.title));
          link.title = pr.title;
          link.href = pr.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          const number = new URL(pr.url).pathname.split("/").pop();
          const metadata = node("small", "", `${pr.repo} #${number} · ${pr.state}`);
          metadata.title = metadata.textContent;
          link.append(metadata);
          records.append(link);
        }
        card.append(records);
      }
      const footer = node("div", "card-footer");
      const full = node("a", "full-report", "Open full report ↗");
      full.href = chrome.runtime.getURL(
        `popup.html?user=${encodeURIComponent(user)}&days=7`,
      );
      full.target = "_blank";
      full.onclick = (event) => {
        event.preventDefault();
        send({ type: "openReport", user });
      };
      footer.append(node("span", "", "Contributor Lens"));
      footer.append(full);
      card.append(footer);
      positionCard();
    });
    host._load = load;
    observer.observe(host);
  }
  function pump() {
    while (running < 2 && queue.length) {
      const h = queue.shift();
      if (!h.isConnected) continue;
      // A re-rendered entry for an already-budgeted author still needs its summary.
      if (!auto.has(h.dataset.user) && auto.size >= limit) continue;
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
      excludedDetail = "";
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
      if (excludedDetail === path) return;
      // Resolve a header that owns the title AND its author description.
      // TitleArea alone is not an author container and must never receive an entry.
      const heading = document.querySelector("main h1");
      const header =
        heading?.closest(
          '[data-component="PageHeader"], .gh-header, [data-testid="issue-header"]',
        ) ||
        document.querySelector(
          '.gh-header, [data-testid="issue-header"], #partial-discussion-header',
        );
      const description = header?.querySelector(
        '[data-component="PageHeader.Description"], .gh-header-meta',
      );
      const initialAuthor =
        description?.querySelector('a.author, a[data-hovercard-type="user"], a[href]') ||
        header?.querySelector("a.author");
      const initialUser = initialAuthor && author(initialAuthor);
      if (botAuthor(initialAuthor, initialUser)) {
        header?.querySelectorAll(".cl-host").forEach((h) => h.remove());
        detailUser = "";
        detail = path;
        excludedDetail = path;
        return;
      }
      if (!detailUser && initialUser) detailUser = initialUser;
      const mount = () => {
        if (!detailUser || !header) return;
        const target = description || header;
        const existing = header.querySelector(".cl-host");
        if (
          existing &&
          (existing.dataset.user !== detailUser || existing.parentElement !== target)
        )
          existing.remove();
        if (!target.querySelector(":scope > .cl-host")) make(target, detailUser, true);
      };
      mount();
      if (detail !== path) {
        detail = path;
        try {
          const response = await send({ type: "prAuthor", path });
          if (detail !== path) return;
          if (Object.hasOwn(response, "user")) {
            detailUser = response.user;
            if (!detailUser) {
              excludedDetail = path;
              header?.querySelectorAll(".cl-host").forEach((h) => h.remove());
            }
          }
          mount();
        } catch {
          detail = "";
        }
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
        '.opened-by a, .opened-by button[data-hovercard-url], a.author, [data-testid="author-filter-link"], a[href*="author"], a[data-hovercard-type="bot"], a[href^="/apps/"]',
      );
      const fallback = row.querySelectorAll(
        'a[data-hovercard-type="user"], button[data-hovercard-url], a[data-hovercard-url]',
      );
      for (const candidate of new Set([...primary, ...fallback])) {
        const user = author(candidate);
        if (botAuthor(candidate, user)) break;
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
      const user =
        detailUser ||
        (p &&
        valid(p[1]) &&
        document.querySelector("[itemprop=additionalName], .vcard-username")
          ? p[1]
          : null);
      const excluded = isBot(user) || !!excludedDetail;
      reply({ user: excluded ? null : user, excluded });
    }
  });
  scan();
})();
