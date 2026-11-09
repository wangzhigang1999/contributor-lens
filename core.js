import "./authors.js";
export const isBot = globalThis.ContributorLensAuthors.isBot;
export const validUser = (u) =>
  typeof u === "string" && /^[a-z\d](?:[a-z\d-]{0,38})(?:\[bot\])?$/i.test(u);
export function validate(user, days) {
  if (!validUser(user) || !Number.isInteger(days) || days < 1 || days > 365)
    throw Object.assign(
      new Error("Enter a valid username and a day range from 1 to 365."),
      {
        kind: "validation",
      },
    );
  if (isBot(user))
    throw Object.assign(new Error("Bot accounts are excluded from activity queries."), {
      kind: "bot_excluded",
    });
}
export function classify(status, h, body = "") {
  if (status === 401) return "token_rejected";
  if (
    status === 429 ||
    (status === 403 &&
      (h.get("x-ratelimit-remaining") === "0" ||
        h.has("retry-after") ||
        /secondary rate limit|API rate limit exceeded|abuse detection/i.test(body)))
  )
    return "rate_limit";
  if (status === 422) return "account_unsearchable";
  if (
    status === 403 &&
    /resource not accessible|insufficient permission|requires authentication|SAML|IP allow list/i.test(
      body,
    )
  )
    return "permission";
  return "http";
}
export async function search({ user, days, token, request, now = Date.now() }) {
  validate(user, days);
  const cutoff = now - days * 864e5;
  const items = new Map();
  let incomplete = false,
    total = 0;
  for (let page = 1; page <= 10; page++) {
    let data;
    try {
      data = await request(
        `/search/issues?q=${encodeURIComponent(`author:${user} is:pr created:>=${new Date(cutoff).toISOString().slice(0, 10)}`)}&sort=created&order=desc&per_page=100&page=${page}`,
        { token, page, operation: "search_prs" },
      );
    } catch (e) {
      return {
        ok: false,
        error: { kind: e.kind || "network", status: e.status || null, page },
        partial: items.size,
      };
    }
    total = data.total_count;
    incomplete ||= !!data.incomplete_results || total >= 1000;
    for (const p of data.items || []) {
      const t = Date.parse(p.created_at);
      if (t < cutoff || t > now || !p.pull_request) continue;
      const url = new URL(p.html_url);
      if (
        url.origin !== "https://github.com" ||
        !/^\/[^/]+\/[^/]+\/pull\/\d+$/.test(url.pathname)
      )
        continue;
      items.set(p.id, {
        id: p.id,
        title: p.title,
        url: url.href,
        repo: url.pathname.split("/").slice(1, 3).join("/"),
        created: p.created_at,
        state:
          p.state === "open" ? "open" : p.pull_request.merged_at ? "merged" : "closed",
      });
    }
    if ((data.items || []).length < 100 || page * 100 >= total) break;
  }
  return {
    ok: true,
    user,
    days,
    now,
    cutoff,
    incomplete,
    items: [...items.values()],
  };
}
export function statistics(r) {
  const counts = { open: 0, merged: 0, closed: 0 },
    repos = {},
    daily = {};
  const key = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const d = new Date(r.cutoff);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= r.now) {
    daily[key(d)] = 0;
    d.setDate(d.getDate() + 1);
  }
  const times = r.items
    .map((p) => {
      counts[p.state]++;
      repos[p.repo] = (repos[p.repo] || 0) + 1;
      daily[key(p.created)]++;
      return Date.parse(p.created);
    })
    .sort((a, b) => a - b);
  let peak10 = 0,
    adjacent60 = 0,
    left = 0;
  times.forEach((t, i) => {
    while (t - times[left] > 600000) left++;
    peak10 = Math.max(peak10, i - left + 1);
    if (i && t - times[i - 1] <= 60000) adjacent60++;
  });
  const busiest = Object.entries(daily).sort((a, b) => b[1] - a[1])[0];
  return {
    counts,
    repos: Object.entries(repos).sort((a, b) => b[1] - a[1]),
    daily: Object.entries(daily),
    busiest,
    peak10,
    adjacent60,
  };
}
export function markdown(report) {
  const stats = statistics(report);
  const escapeTitle = (title) => title.replace(/[\\\[\]]/g, "\\$&").replace(/\n/g, " ");
  const records = report.items.map(
    (pr) =>
      `- [${escapeTitle(pr.title)}](${pr.url}) — ${pr.repo} · ${pr.state} · ${pr.created}`,
  );
  return (
    [
      `# Contributor Lens: ${report.user}`,
      `${new Date(report.cutoff).toISOString()} – ${new Date(report.now).toISOString()}`,
      ...(report.incomplete ? ["Warning: incomplete results."] : []),
      `${report.items.length} PRs · ${stats.counts.open} open · ${stats.counts.merged} merged · ${stats.counts.closed} closed without merge`,
      `Busiest day: ${stats.busiest?.join(": ")} · Peak in any 10 minutes: ${stats.peak10} · Adjacent creations ≤60 seconds apart: ${stats.adjacent60}`,
      "## Daily PR creation (local time)",
      [
        "| Date | PRs |",
        "| --- | ---: |",
        ...stats.daily.map(([date, count]) => `| ${date} | ${count} |`),
      ].join("\n"),
      "## Active repositories",
      stats.repos.map(([repository, count]) => `- ${repository}: ${count}`).join("\n") ||
        "No activity.",
      "## Original PR records",
      records.join("\n") || "No activity.",
      "Only PRs created within the window are counted, using their state at query time. No contributor scores.",
    ].join("\n\n") + "\n"
  );
}
