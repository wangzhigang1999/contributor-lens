import { statistics, markdown } from "./core.js";
const $ = (id) => document.getElementById(id),
  send = (m) => chrome.runtime.sendMessage(m);
let result;
const errors = {
  token_rejected: "Token 被拒绝，请更新或清除 Token。",
  permission: "凭据权限不足。",
  account_unsearchable: "账号不可搜索：不存在或当前权限不可见。",
  rate_limit: "GitHub 限流，请稍后重试并查看 Request log。",
  http: "GitHub HTTP 错误；没有足够证据判定为限流。",
  network: "网络请求失败，请检查连接。",
  credentials_changed: "Token 已更改，请重新查询。",
  validation: "请输入有效用户名和 1–365 天。",
};
function records() {
  if (!result) return;
  const q = $("search").value.toLowerCase(),
    state = $("state").value;
  const ps = result.items.filter(
    (p) =>
      (state === "all" || p.state === state) &&
      (p.title + " " + p.repo).toLowerCase().includes(q),
  );
  $("prs").replaceChildren();
  $("match").textContent = `显示 ${ps.length} / ${result.items.length} 条`;
  for (const p of ps) {
    const row = document.createElement("article"),
      a = document.createElement("a"),
      small = document.createElement("small");
    a.href = p.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = p.title;
    small.textContent = `${p.repo} · ${p.state} · ${new Date(p.created).toLocaleString()}`;
    row.append(a, small);
    $("prs").append(row);
  }
}
function render(r) {
  const s = statistics(r);
  $("report").hidden = false;
  $("scope").textContent =
    `${r.user} · ${new Date(r.cutoff).toLocaleString()} 至 ${new Date(r.now).toLocaleString()}${r.cached ? " · 10 分钟内缓存" : ""}`;
  $("counts").replaceChildren();
  for (const text of [
    `${r.items.length} PR`,
    `${s.counts.open} open`,
    `${s.counts.merged} merged`,
    `${s.counts.closed} closed without merge`,
  ]) {
    const span = document.createElement("span");
    span.textContent = text;
    $("counts").append(span);
  }
  $("chart").replaceChildren();
  const max = Math.max(1, ...s.daily.map((x) => x[1]));
  for (const [date, n] of s.daily) {
    const bar = document.createElement("div");
    bar.style.height = `${Math.max(2, (n / max) * 95)}px`;
    bar.title = `${date}: ${n}`;
    bar.setAttribute("aria-label", bar.title);
    $("chart").append(bar);
  }
  $("metrics").textContent =
    `最活跃日 ${s.busiest?.[0]}（${s.busiest?.[1]} PR；并列取首日） · 连续 10 分钟峰值 ${s.peak10} · 相邻创建间隔 ≤60 秒 ${s.adjacent60} 次`;
  $("repos").textContent =
    s.repos.map(([r, n]) => `${r}: ${n}`).join(" · ") || "没有活动";
  records();
}
$("query").onsubmit = async (e) => {
  e.preventDefault();
  $("submit").disabled = true;
  $("status").textContent = "正在查询…";
  $("report").hidden = true;
  result = null;
  try {
    const r = await send({
      type: "query",
      user: $("user").value.trim(),
      days: Number($("days").value),
    });
    if (!r.ok) {
      $("status").textContent =
        `${errors[r.error?.kind] || "查询失败"}${r.error?.status ? " HTTP " + r.error.status : ""}${r.error?.page ? " · 失败页 " + r.error.page + "，未将前页作为完整报告。" : ""}`;
      return;
    }
    result = r;
    $("status").textContent = r.incomplete
      ? "结果不完整：API incomplete_results 或达到 1,000 条搜索上限。"
      : r.items.length
        ? "查询完成。"
        : "查询成功：此窗口没有 PR 活动。";
    render(r);
  } catch {
    $("status").textContent = "扩展连接失败，请重新打开。";
  } finally {
    $("submit").disabled = false;
  }
};
$("presets").onclick = (e) => {
  if (e.target.dataset.days) $("days").value = e.target.dataset.days;
};
$("state").onchange = records;
$("search").oninput = records;
async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "已复制";
  } catch {
    button.textContent = "复制失败，请重试";
  }
}
$("markdown").onclick = () => {
  if (result) copy(markdown(result), $("markdown"));
};
async function settings() {
  $("auth").textContent = (await send({ type: "settings" })).authenticated
    ? "已保存 Token"
    : "匿名模式";
}
async function token(value) {
  await send({ type: "token", token: value });
  $("token").value = "";
  result = null;
  $("report").hidden = true;
  $("status").textContent = "凭据已更新，旧缓存已清除。";
  await settings();
}
$("save").onclick = () => token($("token").value);
$("clear").onclick = () => token("");
async function logs() {
  const r = await send({ type: "logs" });
  $("logs").textContent = JSON.stringify(r.logs, null, 2);
  return r.logs;
}
$("refreshlog").onclick = logs;
$("logdetails").ontoggle = () => {
  if ($("logdetails").open) logs();
};
$("copylog").onclick = async () =>
  copy(JSON.stringify(await logs(), null, 2), $("copylog"));
await settings();
const preset = new URL(location.href).searchParams.get("user");
if (preset) $("user").value = preset;
else
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    // Messaging our own GitHub content script does not require reading tab URLs.
    const context = await chrome.tabs
      .sendMessage(tab.id, { type: "context" })
      .catch(() => null);
    if (context?.user) $("user").value = context.user;
    else if (tab.url) {
      const u = new URL(tab.url);
      const m =
        u.origin === "https://github.com" &&
        u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (m)
        $("user").value =
          (await send({ type: "prAuthor", path: m.slice(1).join("/") })).user ||
          "";
    }
  } catch {}
