import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "docs/screenshots");
const profile = await mkdtemp(path.join(tmpdir(), "contributor-lens-detail-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
const evidence = {
  capturedAt: new Date().toISOString(),
  source: "Live GitHub PR pages and REST API",
  tabs: [],
};
try {
  await mkdir(output, { recursive: true });
  const page = await context.newPage();
  const base = "https://github.com/microsoft/vscode/pull/346501";
  for (const suffix of ["", "/commits", "/files"]) {
    await page.goto(base + suffix, { waitUntil: "domcontentloaded" });
    const entry = page.locator('.cl-host[data-placement="detail"]');
    await entry.waitFor();
    await page.waitForTimeout(2000);
    await entry.locator("button").first().click();
    await entry.locator("section .card-counts").waitFor();
    await entry.locator('button[aria-label="Close activity card"]').click();
    assert.equal(await entry.count(), 1);
    assert.equal(
      await page.locator('h1 .cl-host, [data-component="TitleArea"] .cl-host').count(),
      0,
    );
    assert.equal(await entry.getAttribute("data-user"), "SimonSiefke");
    const bounds = await entry.boundingBox();
    const heading = await page.locator("main h1").first().boundingBox();
    console.log("Checking detail entry", suffix || "Conversation");
    const author = await page
      .locator(
        '[data-component="PageHeader.Description"] a[href="/SimonSiefke"], .gh-header a.author[href="/SimonSiefke"]',
      )
      .first()
      .boundingBox();
    assert(bounds.y >= author.y + author.height);
    assert(bounds.y >= heading.y + heading.height);
    evidence.tabs.push({
      page: page.url(),
      author: "SimonSiefke",
      text: await entry.locator("button").first().innerText(),
      entryBelowAuthor: true,
      titleUntouched: true,
    });
    if (!suffix) {
      await page.screenshot({ path: path.join(output, "github-pr-detail.png") });
      await entry.locator("button").first().click();
      await entry.locator("section .card-counts").waitFor();
      await page.screenshot({ path: path.join(output, "github-pr-detail-expanded.png") });
      await entry.locator('button[aria-label="Close activity card"]').click();
      await page.setViewportSize({ width: 430, height: 932 });
      await page.screenshot({ path: path.join(output, "github-pr-detail-narrow.png") });
      assert((await entry.boundingBox()).width <= 430);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }
  await writeFile(
    path.join(output, "detail-capture.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  const captureFile = path.join(output, "capture.json");
  const capture = JSON.parse(await readFile(captureFile, "utf8"));
  const detail = capture.screenshots.find((item) => item.file === "github-pr-detail.png");
  if (detail)
    Object.assign(detail, {
      capturedAt: evidence.capturedAt,
      entryPlacement: "Separate row below the PR author description",
    });
  await writeFile(captureFile, JSON.stringify(capture, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await Promise.race([
    context.close(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await rm(profile, { recursive: true, force: true });
}
process.exit(0);
