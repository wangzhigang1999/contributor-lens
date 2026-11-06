import { statistics, markdown } from "./core.js";
const $ = (id) => document.getElementById(id),
  send = (m) => chrome.runtime.sendMessage(m);
let result;
const errors = {
  token_rejected: "Token rejected. Update or clear your token.",
  permission: "Your credentials do not have the required permissions.",
  account_unsearchable:
    "Account is not searchable: it does not exist or is not visible to your credentials.",
  rate_limit: "GitHub rate limit reached. Try again later and check the request log.",
  http: "GitHub HTTP error without evidence of rate limiting.",
  network: "Network request failed. Check your connection.",
  credentials_changed: "Your token changed. Run the query again.",
  validation: "Enter a valid username and a day range from 1 to 365.",
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
  $("match").textContent = `Showing ${ps.length} of ${result.items.length} PRs`;
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
    `${r.user} · ${new Date(r.cutoff).toLocaleString()} to ${new Date(r.now).toLocaleString()}${r.cached ? " · cached within the last 10 minutes" : ""}`;
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
    `Busiest day: ${s.busiest?.[0]} (${s.busiest?.[1]} PRs; earliest day wins ties) · Peak in any 10 minutes: ${s.peak10} · Adjacent creations ≤60 seconds apart: ${s.adjacent60}`;
  $("repos").textContent =
    s.repos.map(([r, n]) => `${r}: ${n}`).join(" · ") || "No activity";
  records();
}
$("query").onsubmit = async (e) => {
  e.preventDefault();
  $("submit").disabled = true;
  $("status").textContent = "Checking activity…";
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
        `${errors[r.error?.kind] || "Query failed"}${r.error?.status ? " HTTP " + r.error.status : ""}${r.error?.page ? " · Failed page " + r.error.page + ". Earlier pages are not shown as a complete report." : ""}`;
      return;
    }
    result = r;
    $("status").textContent = r.incomplete
      ? "Incomplete results: GitHub reported incomplete_results or the 1,000-result search limit was reached."
      : r.items.length
        ? "Query complete."
        : "Query succeeded: no PR activity in this window.";
    render(r);
  } catch {
    $("status").textContent = "Could not connect to the extension. Reopen the popup.";
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
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed. Try again.";
  }
}
$("markdown").onclick = () => {
  if (result) copy(markdown(result), $("markdown"));
};
async function settings() {
  $("auth").textContent = (await send({ type: "settings" })).authenticated
    ? "Token saved"
    : "Anonymous mode";
}
async function token(value) {
  await send({ type: "token", token: value });
  $("token").value = "";
  result = null;
  $("report").hidden = true;
  $("status").textContent = "Credentials updated. Previous cached results were cleared.";
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
          (await send({ type: "prAuthor", path: m.slice(1).join("/") })).user || "";
    }
  } catch {}
