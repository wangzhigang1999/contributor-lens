import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ext = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const temp = await fs.realpath(tmpdir());
const profile = await fs.mkdtemp(path.join(temp, "cl-fixtures-"));
const opts = {
  headless: true,
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    "--ignore-certificate-errors",
  ],
  ignoreHTTPSErrors: true,
};
let c = await chromium.launchPersistentContext(profile, opts);
let w = c.serviceWorkers()[0] || (await c.waitForEvent("serviceworker"));
const id = new URL(w.url()).host;
let mode = "zero",
  requests = 0,
  active = 0,
  peak = 0;
const evidence = [];
const authenticatedAuthors = new Set();
await c.route("https://api.github.com/**", async (route) => {
  requests++;
  active++;
  peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, 25));
  active--;
  const u = new URL(route.request().url()),
    page = Number(u.searchParams.get("page"));
  if (
    u.pathname === "/search/issues" &&
    route.request().headers().authorization === "Bearer fixture-secret"
  ) {
    const author = u.searchParams.get("q")?.match(/author:([^ ]+)/)?.[1];
    if (author) authenticatedAuthors.add(author);
  }
  let status = 200,
    data = { total_count: 0, items: [] },
    headers = {};
  if (u.pathname.endsWith("/pulls/900"))
    data = { user: { login: "custom-automation", type: "Bot" } };
  else if (u.pathname.includes("/pulls/")) data = { user: { login: "pr-owner" } };
  else if (mode === "rate") {
    if (page === 1)
      data = {
        total_count: 101,
        items: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          title: "Fixture",
          created_at: new Date(Date.now() - 60000).toISOString(),
          html_url: `https://github.com/o/r/pull/${i + 1}`,
          state: "open",
          pull_request: { merged_at: null },
        })),
      };
    else {
      status = 429;
      headers = { "retry-after": "60" };
    }
  } else if (mode === "403") status = 403;
  else if (mode === "incomplete")
    data = { total_count: 0, items: [], incomplete_results: true };
  else if (mode === "many")
    data = {
      total_count: 40,
      items: Array.from({ length: 40 }, (_, i) => ({
        id: i,
        title: `PR ${i + 1}: preserve credentials across authentication paths and redirects`,
        created_at: new Date(Date.now() - 60000).toISOString(),
        html_url: `https://github.com/o/repo${i % 12}/pull/${i + 1}`,
        state: "open",
        pull_request: { merged_at: null },
      })),
    };
  else if (mode === "records")
    data = {
      total_count: 3,
      items: ["open", "merged", "closed"].map((state, i) => ({
        id: i,
        title: i ? "Other PR" : "Needle",
        created_at: new Date(Date.now() - 60000).toISOString(),
        html_url: `https://github.com/o/repo${i}/pull/${i + 1}`,
        state: state === "open" ? "open" : "closed",
        pull_request: {
          merged_at: state === "merged" ? new Date().toISOString() : null,
        },
      })),
    };
  await route.fulfill({
    status,
    headers,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
});
let p = await c.newPage();
const popup = await c.newPage();
async function query(user) {
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#user").fill(user);
  await popup.locator("#submit").click();
  await popup.waitForFunction(() => !document.querySelector("#submit").disabled);
  return popup.locator("#status").innerText();
}
try {
  for (const [m, user, pattern] of [
    ["zero", "zero-user", /no PR activity/],
    ["403", "forbidden-user", /HTTP error/],
    ["incomplete", "partial-user", /Incomplete results/],
    ["rate", "rate-user", /Failed page 2/],
  ]) {
    mode = m;
    const status = await query(user);
    assert.match(status, pattern);
    evidence.push({ mode: m, status });
  }
  const logs = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  assert.deepEqual(
    logs.slice(-2).map((l) => l.status),
    [200, 429],
  );
  assert.deepEqual(
    logs.slice(-2).map((l) => l.page),
    [1, 2],
  );
  assert(peak <= 2);
  await popup.locator("#logdetails").evaluate((e) => (e.open = true));
  await popup.locator("#copylog").click();
  await popup.waitForFunction(
    () => document.querySelector("#copylog").textContent === "Copied",
  );
  assert.equal(await popup.locator("#copylog").innerText(), "Copied");
  evidence.push({ copyLog: "Copied", requests, peak });
  mode = "records";
  await query("record-user");
  assert.equal(await popup.locator("#prs a").count(), 3);
  assert.deepEqual(await popup.locator("#counts .stat-value").allTextContents(), [
    "3",
    "1",
    "1",
    "1",
  ]);
  assert.equal(await popup.locator("#chart svg[role=img]").count(), 1);
  assert.equal(
    await popup.locator("#chart .bar").count(),
    8,
    "The seven-day chart includes zero-activity dates",
  );
  assert.equal(await popup.locator("#repos .repo-row").count(), 3);
  assert.equal(await popup.locator("#prs .pr-glyph.merged").count(), 1);
  await popup.locator('[data-days="30"]').click();
  assert.equal(await popup.locator("#days").inputValue(), "30");
  assert.equal(
    await popup.locator('[data-days="30"]').getAttribute("aria-pressed"),
    "true",
  );
  await popup.locator("#days").fill("365");
  assert.equal(await popup.locator('#presets [aria-pressed="true"]').count(), 0);

  await popup.locator("#state").selectOption("merged");
  assert.equal(await popup.locator("#prs a").count(), 1);
  await popup.locator("#state").selectOption("all");
  await popup.locator("#search").fill("Needle");
  assert.equal(await popup.locator("#prs a").count(), 1);
  await popup.locator("#markdown").click();
  await popup.waitForFunction(
    () => document.querySelector("#markdown").textContent === "Copied",
  );
  assert.equal(await popup.locator("#markdown").innerText(), "Copied");
  evidence.push({ filters: true, markdown: true });

  const compact = await c.newPage();
  await compact.setViewportSize({ width: 350, height: 400 });
  const popupPath = await w.evaluate(
    () => chrome.runtime.getManifest().action.default_popup,
  );
  await compact.goto(`chrome-extension://${id}/${popupPath}`);
  const assertFits = async (state) => {
    const size = await compact.evaluate(() => {
      const root = document.scrollingElement;
      return { width: root.scrollWidth, height: root.scrollHeight };
    });
    assert(
      size.width <= 350 && size.height <= 400,
      `${state} toolbar popup overflowed: ${size.width}×${size.height}`,
    );
  };
  await compact.locator("#popup-tools").waitFor();
  await assertFits("Empty");
  assert.equal(await compact.locator("#empty").isVisible(), false);
  await compact.locator("#user").fill("record-user");
  await compact.locator("#days").fill("13");
  await compact.locator("#submit").click();
  await compact.locator("#full-report").waitFor();
  await assertFits("Summary");
  assert.equal(await compact.locator("#chart").isVisible(), false);
  assert.equal(await compact.locator("#counts .stat-value").first().innerText(), "3");
  const [full] = await Promise.all([
    c.waitForEvent("page"),
    compact.locator("#full-report").click(),
  ]);
  await full.locator("#prs a").first().waitFor();
  assert.equal(await full.locator("#user").inputValue(), "record-user");
  assert.equal(await full.locator("#days").inputValue(), "13");
  await full.close();
  mode = "403";
  await compact.locator("#user").fill("compact-error-user");
  await compact.locator("#submit").click();
  await compact.locator('#status[data-state="error"]').waitFor();
  await assertFits("Error");
  await compact.close();
  evidence.push({ compactPopupFits: true, fullReportOpensWithQuery: true });

  mode = "zero";
  const beforeManualBot = requests;
  for (const user of ["dependabot[bot]", "RENOVATE", "custom-app[bot]"])
    assert.match(await query(user), /Bot accounts are excluded/);
  assert.equal(requests, beforeManualBot);
  const botAuthors = [
    '<a href="/o/r/issues?q=author%3Adependabot%5Bbot%5D">dependabot[bot]</a>',
    '<a href="/dependabot">dependabot</a>',
    '<a href="/RENOVATE">RENOVATE</a>',
    '<a href="/github-actions">github-actions</a>',
    '<a href="/apps/custom-app">custom-app</a>',
    '<a data-hovercard-type="bot" href="/custom-worker">custom-worker</a>',
    '<a data-hovercard-url="/users/another-app[bot]/hovercard">another-app[bot]</a>',
    '<button data-hovercard-url="/users/button-app[bot]/hovercard">button-app[bot]</button>',
  ];
  const botRows = botAuthors
    .map(
      (author, i) =>
        `<div class="Box-row bot-row" style="height:35px"><a href="/o/r/pull/${100 + i}">Bot PR ${i}</a><span class="opened-by">${author}</span><a data-hovercard-type="user" href="/not-the-author">assignee</a></div>`,
    )
    .join("");
  const rows = Array.from(
    { length: 35 },
    (_, i) =>
      `<div class="Box-row" style="height:35px"><a href="${i % 2 ? "https://github.com" : ""}/o/r/issues/${i + 1}">Issue ${i}</a><a data-hovercard-type="user" href="/assignee">assignee</a><span class="opened-by">${i % 3 === 0 ? `<a href="/person${i}">person${i}</a>` : i % 3 === 1 ? `<a href="/o/r/issues?q=author%3Aperson${i}">person${i}</a>` : `<button data-hovercard-url="/users/person${i}/hovercard">person${i}</button>`}</span></div>`,
  ).join("");
  await c.route("https://github.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<main style="overflow:hidden;transform:translateZ(0)"><nav><a data-hovercard-type="user" href="/organization">organization</a></nav>${botRows}${r.request().url().includes("bots=only") ? "" : rows}<div class="Box-row" id="foreign"><a href="https://evil.test/o/r/issues/3">foreign</a><a class="author" href="/wrong">wrong</a></div><div class="Box-row" id="other"><a href="/else/repo/issues/3">other</a><a class="author" href="/wrong">wrong</a></div></main>`,
    }),
  );
  await w.evaluate(() => chrome.storage.local.set({ logs: [], cache: [] }));
  const beforeBotLists = requests;
  for (const list of ["issues", "pulls"]) {
    await p.goto(`https://github.com/o/r/${list}?bots=only`);
    await p.waitForTimeout(500);
    assert.equal(await p.locator(".cl-host").count(), 0);
  }
  assert.equal(requests, beforeBotLists);
  assert.deepEqual((await w.evaluate(() => chrome.storage.local.get("logs"))).logs, []);
  evidence.push({
    botOnlyLists: "zero requests and zero buttons",
    manualBotQueries: "blocked locally",
  });
  await p.goto("https://github.com/o/r/issues");
  await p.waitForTimeout(1600);
  assert.equal(await p.locator(".cl-host").count(), 35);
  assert.equal(await p.locator(".cl-host").first().getAttribute("data-user"), "person0");
  assert.equal(await p.locator(".bot-row .cl-host").count(), 0);
  assert.equal(await p.locator("#foreign .cl-host, #other .cl-host").count(), 0);
  let ls = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  assert.equal(ls.length, 4);
  await p.locator(".cl-host").last().scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  ls = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  assert.equal(ls.length, 4);
  const last = p.locator(".cl-host").last();
  const lastTrigger = last.locator("button").first();
  await lastTrigger.click();
  const visibleCard = last.locator("section");
  await visibleCard.getByText("No pull requests created in the last 7 days.").waitFor();
  assert.equal(await visibleCard.locator("h4, .card-counts").count(), 0);
  assert.equal(
    await visibleCard.getByRole("link", { name: /Open full report/ }).count(),
    1,
  );
  const cardBounds = await visibleCard.boundingBox();
  const triggerBounds = await lastTrigger.boundingBox();
  assert.equal(cardBounds.x, triggerBounds.x);
  assert.equal(cardBounds.y + cardBounds.height, triggerBounds.y - 8);
  // The close control still receives pointer input above the clipping ancestor.
  await visibleCard.getByRole("button", { name: "Close activity card" }).click();
  await visibleCard.waitFor({ state: "detached" });
  assert.equal(await lastTrigger.getAttribute("aria-expanded"), "false");

  await p.waitForTimeout(600);
  ls = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  assert.equal(ls.length, 5);
  await p.evaluate(() => scrollTo(0, 0));
  const first = p.locator(".cl-host").first();
  const firstTrigger = first.locator("button").first();
  await firstTrigger.click();
  const firstCard = first.locator("section");
  await firstCard.getByText("No pull requests created in the last 7 days.").waitFor();
  const firstTriggerBounds = await firstTrigger.boundingBox();
  assert.equal(
    (await firstCard.boundingBox()).y,
    firstTriggerBounds.y + firstTriggerBounds.height + 8,
  );
  const second = p.locator(".cl-host").nth(1);
  await second.evaluate((host) => (host.style.float = "right"));
  await second.locator("button").first().click();
  await firstCard.waitFor({ state: "detached" });
  const secondCard = second.locator("section");
  await secondCard.waitFor();
  const rightEdge = await p.evaluate(() => document.scrollingElement.clientWidth - 12);
  const secondBounds = await secondCard.boundingBox();
  assert.equal(secondBounds.x + secondBounds.width, rightEdge);
  await p.keyboard.press("Escape");
  await secondCard.waitFor({ state: "detached" });
  evidence.push({
    listRows: 35,
    anonymousAutoQueries: 4,
    manualOverBudget: true,
    cardAnchoredAboveAndBelow: true,
    compactZeroActivityCard: true,
    singleCardAndEscapeDismissal: true,
  });
  await p.evaluate(() => {
    const row = document.querySelector(".Box-row:not(.bot-row)");
    row.replaceWith(row.cloneNode(true));
    document.querySelectorAll(".cl-host").forEach((h) => {
      if (!h.shadowRoot) h.remove();
    });
  });
  await p.waitForTimeout(600);
  assert.equal(await p.locator(".cl-host").count(), 35);
  // Start the authenticated URL in a fresh tab so credential broadcasts cannot
  // schedule old-page requests into this page's quota measurement.
  await p.close();
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "token", token: "fixture-secret" }),
  );
  p = await c.newPage();
  await p.goto("https://github.com/o/r/issues?q=changed");
  await p.waitForTimeout(600);
  await p.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(600);
  await p.evaluate(() => scrollTo(0, 500));
  await p.waitForTimeout(1000);
  const authLogs = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  const authQueries = authLogs.length - 5;
  assert(
    authenticatedAuthors.size <= 24 && authenticatedAuthors.size > 4,
    `Expected 5–24 distinct authenticated authors; got ${authenticatedAuthors.size}`,
  );
  evidence.push({
    authenticatedAutomaticAuthors: authenticatedAuthors.size,
    authenticatedApiRequests: authQueries,
  });
  // Both GitHub headers keep the entry below the PR author, outside the title.
  await c.unroute("https://github.com/**");
  let modernHeader = false;
  await c.route("https://github.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: modernHeader
        ? '<main><div data-component="PageHeader"><div data-component="TitleArea"><h1>PR title</h1><span>#9</span></div><div data-component="PageHeader.Description"><a href="/pr-owner">PR owner</a> wants to merge</div><nav>Conversation · Commits · Files</nav></div><div class="timeline"><a class="author" href="/reviewer">reviewer</a></div></main>'
        : '<main><div class="gh-header"><h1>PR title <span>#9</span></h1><div class="gh-header-meta"><a class="author" href="/pr-owner">PR owner</a> wants to merge</div></div><div class="timeline"><a class="author" href="/reviewer">reviewer</a></div></main>',
    }),
  );
  for (const layout of ["legacy", "modern"]) {
    modernHeader = layout === "modern";
    for (const suffix of ["", "/commits", "/files"]) {
      await p.goto("https://github.com/o/r/pull/9" + suffix);
      const entry = p.locator('.cl-host[data-placement="detail"]');
      await entry.waitFor();
      assert.equal(await entry.count(), 1);
      assert.equal(await entry.getAttribute("data-user"), "pr-owner");
      assert.equal(
        await p.locator('h1 .cl-host, [data-component="TitleArea"] .cl-host').count(),
        0,
      );
      assert.equal(await entry.locator(".entry-label").innerText(), "Author activity");
      const title = await p.locator("h1").boundingBox();
      const author = await p.locator('a[href="/pr-owner"]').boundingBox();
      const bounds = await entry.boundingBox();
      assert(bounds.y >= title.y + title.height);
      assert(bounds.y >= author.y + author.height);
      // GitHub can replace an existing header without navigating.
      await entry.evaluate((host) => host.remove());
      await entry.waitFor();
      await p.waitForFunction(() =>
        document
          .querySelector('.cl-host[data-placement="detail"]')
          ?.shadowRoot?.querySelector(".entry-summary")
          ?.textContent.includes("PR"),
      );
      assert.equal(await entry.count(), 1);
    }
  }
  evidence.push({
    prIdentityAcrossTabs: true,
    legacyAndModernHeaders: true,
    titleUntouched: true,
    entryBelowAuthor: true,
    summaryRestoredAfterRerender: true,
  });
  await c.route("https://github.com/o/r/pull/90**", (route) => {
    const n = new URL(route.request().url()).pathname.split("/")[4];
    const author =
      n === "900"
        ? ""
        : n === "901"
          ? '<a class="author" href="/dependabot">dependabot[bot]</a>'
          : '<a href="/apps/custom-app">custom-app</a>';
    return route.fulfill({
      contentType: "text/html",
      body: `<main><div class="gh-header"><h1>Bot PR</h1><div class="gh-header-meta">${author}</div></div><a class="author" href="/reviewer">reviewer</a></main>`,
    });
  });
  for (const n of [901, 902, 900]) {
    for (const suffix of ["", "/commits", "/files"]) {
      const before = requests;
      await p.goto(`https://github.com/o/r/pull/${n}${suffix}`);
      await p.waitForTimeout(500);
      await p.locator("h1").evaluate((h) => h.after(document.createElement("span")));
      await p.waitForTimeout(200);
      assert.equal(await p.locator(".cl-host").count(), 0, `Bot PR ${n}${suffix}`);
      assert.equal(requests - before, n === 900 ? 1 : 0, `Bot PR requests ${n}${suffix}`);
      const context = await popup.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          const context = await chrome.tabs
            .sendMessage(tab.id, { type: "context" })
            .catch(() => null);
          if (context?.excluded) return context;
        }
      });
      assert.deepEqual(context, { user: null, excluded: true });
    }
  }
  await c.unroute("https://github.com/o/r/pull/90**");
  await p.goto("https://github.com/o/r/pull/9");
  await p.locator('.cl-host[data-placement="detail"]').waitFor();
  evidence.push({
    botPrDetailsAcrossTabs: "no buttons or searches",
    unmarkedApiBot: "one identity lookup, no activity query or remount",
  });
  mode = "many";
  await w.evaluate(() => chrome.storage.local.set({ cache: [] }));
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 430, height: 560 },
    { width: 720, height: 360 },
  ]) {
    await p.setViewportSize(viewport);
    await p.goto("https://github.com/o/r/pull/9");
    const entry = p.locator(".cl-host");
    await entry.locator("button").first().click();
    const card = entry.locator("section");
    await card.locator(".record").last().waitFor();
    assert.equal(await card.locator(".record").count(), 3);
    assert.equal(await card.locator(".repo-row").count(), 3);
    assert.equal(await card.locator(".card-counts strong").first().innerText(), "40");
    assert.equal(await card.getByText("Showing 3 of 40").count(), 1);
    assert.equal(await card.getByText("Top 3 of 12").count(), 1);
    const scrollers = await card.evaluate((card) =>
      [card, ...card.querySelectorAll("*")]
        .filter(
          (node) =>
            /^(auto|scroll)$/.test(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight,
        )
        .map((node) => node.tagName),
    );
    assert(
      scrollers.length === 0 || (scrollers.length === 1 && scrollers[0] === "SECTION"),
      "Only the card may scroll",
    );
    if (viewport.height === 800)
      assert.deepEqual(scrollers, [], "The compact preview fits a desktop viewport");
    const pageScroll = await p.evaluate(() => scrollY);
    await card.locator(".record").last().scrollIntoViewIfNeeded();
    if (viewport.height === 360)
      assert(await card.evaluate((card) => card.scrollTop > 0));
    assert.equal(await p.evaluate(() => scrollY), pageScroll);
    const bounds = await card.boundingBox();
    for (const selector of [".close", ".full-report", ".record:last-child"]) {
      const control = await card.locator(selector).boundingBox();
      assert(
        control.y >= bounds.y && control.y + control.height <= bounds.y + bounds.height,
      );
    }
    if (viewport.height === 800) {
      const [full] = await Promise.all([
        c.waitForEvent("page"),
        card.getByRole("link", { name: /Open full report/ }).click(),
      ]);
      await full.locator(".pr-row").last().waitFor();
      assert.equal(await full.locator(".pr-row").count(), 40);
      assert.equal(await full.locator(".repo-row:visible").count(), 5);
      await full.getByRole("button", { name: "Show all 12 repositories" }).click();
      assert.equal(await full.locator(".repo-row:visible").count(), 12);
      await full.getByRole("button", { name: "Show fewer repositories" }).click();
      assert.equal(await full.locator(".repo-row:visible").count(), 5);
      await full.close();
    }
    await card.getByRole("button", { name: "Close activity card" }).click();
    await card.waitFor({ state: "detached" });
  }
  evidence.push({
    compactPreviewKeepsFullCounts: true,
    fullReportIncludesAllRecords: true,
    singleCardScrollWithManyRecords: true,
    narrowAndShortViewports: true,
  });
  await popup.goto(`chrome-extension://${id}/popup.html#token-details`);
  await popup.locator("#settings-heading").waitFor();
  assert.equal(await popup.locator("#query").isVisible(), false);
  assert.equal(await popup.locator("#token-details").getAttribute("open"), "");
  await popup.locator("#clear").click();
  await popup
    .getByText("Credentials updated. Previous cached results were cleared.")
    .waitFor();
  assert.equal(await popup.locator("#auth").innerText(), "Anonymous mode");
  evidence.push({ dedicatedSettingsView: true });
  const stored = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  await Promise.race([c.close(), new Promise((r) => setTimeout(r, 3000))]);
  c = await chromium.launchPersistentContext(profile, opts);
  const re = await c.newPage();
  await re.goto(`chrome-extension://${id}/popup.html`);
  await re.locator("#logdetails").evaluate((e) => (e.open = true));
  await re.waitForTimeout(400);
  assert.deepEqual(JSON.parse(await re.locator("#logs").innerText()), stored);
  evidence.push({ browserRestartPersistence: true });
  console.log("Browser fixtures PASS", JSON.stringify(evidence, null, 2));
} catch (e) {
  console.log(e.stack);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    ext + "/tests/browser-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  await Promise.race([c.close(), new Promise((r) => setTimeout(r, 3000))]);
  const resolvedProfile = await fs.realpath(profile);
  if (path.dirname(resolvedProfile) === temp)
    await fs.rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
}

process.exit(process.exitCode || 0);
