import { chromium } from "playwright";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "docs/screenshots");
const profile = await mkdtemp(path.join(tmpdir(), "contributor-lens-screenshots-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
const evidence = {
  capturedAt: new Date().toISOString(),
  source: "Live GitHub pages and GitHub REST API",
  screenshots: [],
};
try {
  await mkdir(output, { recursive: true });
  const worker =
    context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto("https://github.com/microsoft/vscode/pulls", {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".cl-host").first().waitFor();
  await page.waitForTimeout(3500);
  // The current PR author is guaranteed to have a recent record on this list.
  const row = page.locator(".cl-host").first();
  const username = await row.getAttribute("data-user");
  await row.locator("button").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cl-host")].some((host) =>
      host.shadowRoot?.querySelector("section p")?.textContent.includes("PRs created"),
    ),
  );
  await row.locator("section").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(output, "github-pr-list.png") });
  evidence.screenshots.push({ file: "github-pr-list.png", page: page.url(), username });
  const report = await context.newPage();
  await report.goto(
    `chrome-extension://${extensionId}/popup.html?user=${encodeURIComponent(username)}`,
  );
  await report.locator("#submit").click();
  await report.waitForFunction(
    () => document.querySelector("#status").textContent === "Query complete.",
  );
  await report.mouse.move(0, 0);
  await report.screenshot({ path: path.join(output, "activity-report.png") });
  evidence.screenshots.push({
    file: "activity-report.png",
    username,
    counts: await report.locator("#counts").innerText(),
  });
  const prUrl = await report.locator("#prs a").first().getAttribute("href");
  await page.goto(prUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".cl-host").first().waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(output, "github-pr-detail.png") });
  evidence.screenshots.push({
    file: "github-pr-detail.png",
    page: page.url(),
    username: await page.locator(".cl-host").first().getAttribute("data-user"),
  });
  await writeFile(
    path.join(output, "capture.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await Promise.race([
    context.close(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await rm(profile, { recursive: true, force: true });
}
process.exit(0);
