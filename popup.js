import { statistics, markdown } from "./core.js";
const $ = (id) => document.getElementById(id),
  send = (m) => chrome.runtime.sendMessage(m);
const params = new URLSearchParams(location.search);
const isPopup = params.get("view") === "popup";
if (isPopup) {
  document.body.classList.add("toolbar-popup");
  $("home").href = "popup.html?view=popup";
  $("popup-tools").hidden = false;
}
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
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const stateLabel = { open: "Open", merged: "Merged", closed: "Closed without merge" };
function prIcon(state) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `pr-glyph ${state}`);
  svg.innerHTML =
    '<circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="3" r="1.5"/><path d="M4 4.5v7m8-7v3A3.5 3.5 0 0 1 8.5 11H4"/>';
  return svg;
}
function records() {
  if (!result) return;
  const query = $("search").value.toLowerCase();
  const state = $("state").value;
  const matches = result.items.filter(
    (pr) =>
      (state === "all" || pr.state === state) &&
      (pr.title + " " + pr.repo).toLowerCase().includes(query),
  );
  $("prs").replaceChildren();
  $("match").textContent = `${matches.length} of ${result.items.length} pull requests`;
  for (const pr of matches) {
    const row = element("article", "pr-row");
    const content = element("div", "pr-content");
    const link = element("a", "pr-title", pr.title);
    link.href = pr.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const metadata = element("p", "pr-meta");
    const number = new URL(pr.url).pathname.split("/").pop();
    const created = new Date(pr.created).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    metadata.append(
      element("span", "repo", `${pr.repo} #${number}`),
      document.createTextNode(` · ${created}`),
    );
    content.append(link, metadata);
    const badge = element(
      "span",
      `pr-state ${pr.state}`,
      pr.state === "closed" ? "Closed" : stateLabel[pr.state],
    );
    badge.title = stateLabel[pr.state];
    row.append(prIcon(pr.state), content, badge);
    $("prs").append(row);
  }
  if (!matches.length)
    $("prs").append(
      element(
        "p",
        "no-records",
        result.items.length
          ? "No pull requests match these filters"
          : "No pull requests created in this window",
      ),
    );
}
function drawChart(daily) {
  const ns = "http://www.w3.org/2000/svg";
  const node = (tag, attrs, text) => {
    const result = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const width = 620,
    height = 176,
    left = 28,
    top = 8,
    bottom = 28;
  const plotHeight = height - top - bottom,
    plotWidth = width - left - 8;
  const peak = Math.max(0, ...daily.map(([, count]) => count));
  const ceiling = Math.max(2, Math.ceil(peak / 2) * 2);
  const svg = node("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Daily PR creation, maximum ${peak} in one day`,
  });
  for (const value of [0, ceiling / 2, ceiling]) {
    const y = top + plotHeight * (1 - value / ceiling);
    svg.append(
      node("line", { x1: left, x2: width, y1: y, y2: y, class: "grid-line" }),
      node("text", { x: left - 8, y: y + 3, "text-anchor": "end" }, value),
    );
  }
  const step = plotWidth / daily.length;
  const labelEvery = Math.max(1, Math.ceil(daily.length / 6));
  daily.forEach(([date, count], index) => {
    const barHeight = count ? Math.max(2, (count / ceiling) * plotHeight) : 2;
    const x = left + step * index + Math.min(8, step * 0.18);
    const bar = node("rect", {
      x,
      y: top + plotHeight - barHeight,
      width: Math.max(0.5, step - Math.min(16, step * 0.36)),
      height: barHeight,
      rx: 2,
      class: `bar${count === peak && peak > 0 ? " peak" : ""}`,
      tabindex: "0",
    });
    bar.append(node("title", {}, `${date}: ${count} PRs`));
    svg.append(bar);
    if (index % labelEvery === 0 || index === daily.length - 1) {
      // Avoid overlapping the final label when two sampled dates are adjacent.
      if (index !== daily.length - 1 && daily.length - 1 - index < labelEvery / 2) return;
      const label = new Date(date + "T12:00:00").toLocaleDateString("en", {
        month: "short",
        day: "numeric",
      });
      svg.append(
        node(
          "text",
          { x: left + step * (index + 0.5), y: height - 6, "text-anchor": "middle" },
          label,
        ),
      );
    }
  });
  $("chart").replaceChildren(svg);
}
function render(report) {
  const stats = statistics(report);
  $("report").hidden = false;
  $("empty").hidden = true;
  $("identity").textContent = `@${report.user}`;
  const formatDate = (value) =>
    new Date(value).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const range = `${report.days} ${report.days === 1 ? "day" : "days"}${report.cached ? " · cached" : ""}`;
  $("scope").textContent = isPopup
    ? range
    : `${formatDate(report.cutoff)} – ${formatDate(report.now)} · ${range}`;
  $("scope").title =
    `${new Date(report.cutoff).toLocaleString()} to ${new Date(report.now).toLocaleString()}. ${report.cached ? "Cached within the last 10 minutes." : "Queried just now."}`;
  $("counts").replaceChildren();
  for (const [label, count, state] of [
    ["Created", report.items.length, ""],
    ["Open", stats.counts.open, "open"],
    ["Merged", stats.counts.merged, "merged"],
    ["Closed, not merged", stats.counts.closed, "closed"],
  ]) {
    const stat = element("div", "stat");
    const caption = element("span", "stat-label");
    if (state) caption.append(element("i", `state-dot ${state}`));
    if (isPopup && state === "closed") {
      caption.title = label;
      caption.append(document.createTextNode("Closed"));
    } else {
      caption.append(document.createTextNode(label));
    }
    stat.append(element("span", "stat-value", count.toLocaleString("en")), caption);
    $("counts").append(stat);
  }
  if (isPopup) {
    const query = new URLSearchParams({ user: report.user, days: report.days });
    $("full-report").href = `popup.html?${query}`;
    $("full-report").hidden = false;
    return;
  }
  drawChart(stats.daily);
  $("metrics").replaceChildren();
  const busiest = new Date(stats.busiest[0] + "T12:00:00").toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
  for (const [value, label, title] of [
    [
      busiest,
      `Busiest day · ${stats.busiest[1]} PRs`,
      "Earliest day shown when multiple days share the peak",
    ],
    [
      stats.peak10,
      "Peak in any 10 min",
      "Sliding ten-minute window, including its boundaries",
    ],
    [
      stats.adjacent60,
      "Adjacent ≤60 sec",
      "Number of adjacent PR creation timestamps at most 60 seconds apart",
    ],
  ]) {
    const metric = element("div", "metric");
    metric.title = title;
    metric.append(element("strong", "", value), element("span", "", label));
    $("metrics").append(metric);
  }
  $("repo-count").textContent = stats.repos.length.toLocaleString("en");
  $("repos").replaceChildren();
  for (const [repository, count] of stats.repos) {
    const row = element("div", "repo-row");
    const name = element("span", "repo-name");
    const [owner, repo] = repository.split("/");
    name.title = repository;
    name.append(element("span", "owner", `${owner}/`), document.createTextNode(repo));
    const track = element("div", "repo-track");
    const fill = element("span");
    fill.style.width = `${(count / Math.max(1, stats.repos[0][1])) * 100}%`;
    track.append(fill);
    row.append(name, element("span", "repo-value", count), track);
    $("repos").append(row);
  }
  if (!stats.repos.length)
    $("repos").append(element("p", "subtle", "No activity in this window"));
  records();
}
$("query").onsubmit = async (e) => {
  e.preventDefault();
  $("submit").disabled = true;
  $("status").textContent = "Checking activity…";
  $("status").dataset.state = "loading";
  $("empty").hidden = true;
  $("report").hidden = true;
  result = null;
  try {
    const r = await send({
      type: "query",
      user: $("user").value.trim(),
      days: Number($("days").value),
    });
    if (!r.ok) {
      $("status").dataset.state = "error";
      $("status").textContent =
        `${errors[r.error?.kind] || "Query failed"}${r.error?.status ? " HTTP " + r.error.status : ""}${r.error?.page ? " · Failed page " + r.error.page + ". Earlier pages are not shown as a complete report." : ""}`;
      return;
    }
    result = r;
    $("status").dataset.state = r.incomplete ? "partial" : "success";
    $("status").textContent = r.incomplete
      ? "Incomplete results: GitHub reported incomplete_results or the 1,000-result search limit was reached."
      : r.items.length
        ? "Query complete."
        : "Query succeeded: no PR activity in this window.";
    render(r);
  } catch {
    $("status").dataset.state = "error";
    $("status").textContent = "Could not connect to the extension. Reopen the popup.";
  } finally {
    $("submit").disabled = false;
  }
};
function syncRange() {
  for (const button of $("presets").querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.days === $("days").value));
}
$("presets").onclick = (event) => {
  if (event.target.dataset.days) {
    $("days").value = event.target.dataset.days;
    syncRange();
  }
};
$("days").oninput = syncRange;
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
  $(isPopup ? "popup-auth" : "auth").textContent = (await send({ type: "settings" }))
    .authenticated
    ? "Token saved"
    : "Anonymous mode";
}
async function token(value) {
  await send({ type: "token", token: value });
  $("token").value = "";
  result = null;
  $("report").hidden = true;
  $("empty").hidden = false;
  $("status").dataset.state = "success";
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
const preset = params.get("user");
if (preset) {
  $("user").value = preset;
  const days = Number(params.get("days"));
  if (!isPopup && Number.isInteger(days) && days >= 1 && days <= 365) {
    $("days").value = days;
    syncRange();
    $("query").requestSubmit();
  }
} else if (location.hash === "#token-details") {
  $("token-details").open = true;
  $("token-details").scrollIntoView();
} else {
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
}
await settings();
