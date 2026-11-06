import { chromium } from "playwright";
import fs from "node:fs/promises";
const profile = "/tmp/contributor-lens-live-profile",
  ext = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const opts = {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    "--ignore-certificate-errors",
  ],
  ignoreHTTPSErrors: true,
};
let c = await chromium.launchPersistentContext(profile, opts);
const p = await c.newPage();
const evidence = [];
p.on("pageerror", (e) => evidence.push({ pageerror: e.message }));
const w = c.serviceWorkers()[0] || (await c.waitForEvent("serviceworker"));
const id = new URL(w.url()).host;
try {
  await p.goto("https://github.com/microsoft/vscode/issues", {
    waitUntil: "domcontentloaded",
  });
  await p.locator(".cl-host").first().waitFor();
  evidence.push({
    page: p.url(),
    buttons: await p.locator(".cl-host").count(),
  });
  await p.waitForTimeout(4000);
  const inlineUser = await p.locator(".cl-host").first().getAttribute("data-user");
  await p.locator(".cl-host").first().locator("button").click();
  await p.waitForTimeout(7000);
  evidence.push({
    afterClickUrl: p.url(),
    inlineUser,
    inline: await p
      .locator('.cl-host[data-user="' + inlineUser + '"]')
      .first()
      .locator("section")
      .innerText({ timeout: 10000 }),
  });
  await p.goto("https://github.com/microsoft/vscode/pulls", {
    waitUntil: "domcontentloaded",
  });
  await p.locator(".cl-host").first().waitFor();
  evidence.push({
    page: p.url(),
    buttons: await p.locator(".cl-host").count(),
  });
  const link = await p
    .locator('a[href*="/microsoft/vscode/pull/"]')
    .filter({ hasText: /./ })
    .first()
    .getAttribute("href");
  console.log("pr", link);
  const prurl = new URL(link, "https://github.com").href;
  for (const suffix of ["", "/commits", "/files"]) {
    await p.goto(prurl + suffix, { waitUntil: "domcontentloaded" });
    await p.locator(".cl-host").first().waitFor({ timeout: 45000 });
    evidence.push({
      page: p.url(),
      buttons: await p.locator(".cl-host").count(),
      author: await p.locator(".cl-host").first().getAttribute("data-user"),
    });
  }
  const currentAuthor = await p.locator(".cl-host").first().getAttribute("data-user");
  const popup = await c.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#user").fill(currentAuthor);
  await popup.locator("#query").evaluate((f) => f.requestSubmit());
  await popup.waitForFunction(() => !document.querySelector("#submit").disabled, {
    timeout: 120000,
  });
  evidence.push({
    popupStatus: await popup.locator("#status").innerText(),
    counts: await popup.locator("#counts").innerText(),
    firstLink: await popup
      .locator("#prs a")
      .first()
      .getAttribute("href", { timeout: 1000 })
      .catch(() => null),
  });
  const href = await popup
    .locator("#prs a")
    .first()
    .getAttribute("href", { timeout: 1000 })
    .catch(() => null);
  if (href) {
    await p.goto(href, { waitUntil: "domcontentloaded" });
    evidence.push({ openedReportLink: p.url(), title: await p.title() });
  }
  await popup.locator("#logdetails").evaluate((el) => (el.open = true));
  await popup.waitForTimeout(500);
  await popup.locator("#copylog").click();
  evidence.push({
    copyLog: await popup.locator("#copylog").innerText(),
    logs: JSON.parse(await popup.locator("#logs").innerText()),
  });
  await popup.screenshot({
    path: ext + "/tests/live-report.png",
    fullPage: true,
  });
  const before = await w.evaluate(() => chrome.storage.local.get("logs"));
  await Promise.race([c.close(), new Promise((r) => setTimeout(r, 3000))]);
  c = await chromium.launchPersistentContext(profile, opts);
  const p2 = await c.newPage();
  await p2.goto(`chrome-extension://${id}/popup.html`);
  await p2.locator("#logdetails").evaluate((el) => (el.open = true));
  await p2.waitForTimeout(500);
  const after = JSON.parse(await p2.locator("#logs").innerText());
  evidence.push({
    browserRestartLogCount: after.length,
    persisted: JSON.stringify(before.logs) === JSON.stringify(after),
  });
} catch (e) {
  evidence.push({ failure: e.stack });
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    ext + "/tests/live-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
  await Promise.race([c.close(), new Promise((r) => setTimeout(r, 3000))]);
}

process.exit(process.exitCode || 0);
