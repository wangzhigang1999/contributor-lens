import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const ext = new URL("../", import.meta.url).pathname.replace(/\/$/, ""),
  profile = "/tmp/contributor-lens-fixture-profile";
await fs.rm(profile, { recursive: true, force: true });
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
  if (u.pathname.includes("/pulls/")) data = { user: { login: "pr-owner" } };
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
  mode = "zero";
  const rows = Array.from(
    { length: 35 },
    (_, i) =>
      `<div class="Box-row" style="height:35px"><a href="${i % 2 ? "https://github.com" : ""}/o/r/issues/${i + 1}">Issue ${i}</a><a data-hovercard-type="user" href="/assignee">assignee</a><span class="opened-by">${i % 3 === 0 ? `<a href="/person${i}">person${i}</a>` : i % 3 === 1 ? `<a href="/o/r/issues?q=author%3Aperson${i}">person${i}</a>` : `<button data-hovercard-url="/users/person${i}/hovercard">person${i}</button>`}</span></div>`,
  ).join("");
  await c.route("https://github.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<main style="overflow:hidden;transform:translateZ(0)"><nav><a data-hovercard-type="user" href="/organization">organization</a></nav>${rows}<div class="Box-row" id="foreign"><a href="https://evil.test/o/r/issues/3">foreign</a><a class="author" href="/wrong">wrong</a></div><div class="Box-row" id="other"><a href="/else/repo/issues/3">other</a><a class="author" href="/wrong">wrong</a></div></main>`,
    }),
  );
  await w.evaluate(() => chrome.storage.local.set({ logs: [], cache: [] }));
  await p.goto("https://github.com/o/r/issues");
  await p.waitForTimeout(1600);
  assert.equal(await p.locator(".cl-host").count(), 35);
  assert.equal(await p.locator(".cl-host").first().getAttribute("data-user"), "person0");
  assert.equal(await p.locator("#foreign .cl-host, #other .cl-host").count(), 0);
  let ls = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  assert.equal(ls.length, 4);
  await p.locator(".cl-host").last().scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  ls = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  assert.equal(ls.length, 4);
  await p.locator(".cl-host").last().locator("button").click();
  const visibleCard = p.locator(".cl-host").last().locator("section");
  await visibleCard.waitFor({ state: "visible" });
  const cardBounds = await visibleCard.boundingBox();
  assert.equal(
    cardBounds.y,
    80,
    "The card must escape the transformed, clipping list ancestor",
  );
  assert.equal(
    cardBounds.x + cardBounds.width,
    p.viewportSize().width - 20,
    "The card stays 20px from the viewport edge",
  );

  await p.waitForTimeout(600);
  ls = (await w.evaluate(() => chrome.storage.local.get("logs"))).logs;
  assert.equal(ls.length, 5);
  evidence.push({
    listRows: 35,
    anonymousAutoQueries: 4,
    manualOverBudget: true,
  });
  await p.evaluate(() => {
    const row = document.querySelector(".Box-row");
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
}

process.exit(process.exitCode || 0);
