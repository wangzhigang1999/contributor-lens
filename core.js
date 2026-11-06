export const validUser = (u) =>
  typeof u === "string" && /^[a-z\d](?:[a-z\d-]{0,38})(?:\[bot\])?$/i.test(u);
export function validate(user, days) {
  if (!validUser(user) || !Number.isInteger(days) || days < 1 || days > 365)
    throw Object.assign(new Error("用户名或天数无效（1–365）"), {
      kind: "validation",
    });
}
export function classify(status, h, body = "") {
  if (status === 401) return "token_rejected";
  if (
    status === 429 ||
    (status === 403 &&
      (h.get("x-ratelimit-remaining") === "0" ||
        h.has("retry-after") ||
        /secondary rate limit|API rate limit exceeded|abuse detection/i.test(
          body,
        )))
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
          p.state === "open"
            ? "open"
            : p.pull_request.merged_at
              ? "merged"
              : "closed",
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
export function markdown(r) {
  const s = statistics(r);
  return `# Contributor Lens: ${r.user}\n\n${new Date(r.cutoff).toISOString()} – ${new Date(r.now).toISOString()}\n\n${r.incomplete ? "⚠ 不完整结果\n\n" : ""}${r.items.length} PR · ${s.counts.open} open · ${s.counts.merged} merged · ${s.counts.closed} closed without merge\n\n最活跃日：${s.busiest?.join(": ")} · 连续 10 分钟峰值：${s.peak10} · 相邻 ≤60 秒：${s.adjacent60}\n\n每日创建量（本地时区）\n\n| 日期 | PR |\n| --- | ---: |\n${s.daily.map(([date, n]) => `| ${date} | ${n} |`).join("\n")}\n\n活跃仓库\n\n${s.repos.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${r.items.map((p) => `- [${p.title.replace(/[\\\[\]]/g, "\\$&").replace(/\n/g, " ")}](${p.url}) — ${p.repo} · ${p.state} · ${p.created}`).join("\n")}\n\n仅展示窗口内创建的 PR，状态为查询时状态；不评价作者。`;
}
