import { chromium } from "playwright";
import fs from "node:fs/promises";
const ext = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const c = await chromium.launchPersistentContext(
  "/tmp/contributor-lens-toolbar-profile",
  {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/local/bin/chromium",
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      "--ignore-certificate-errors",
    ],
    ignoreHTTPSErrors: true,
  },
);
let evidence;
try {
  const p = await c.newPage();
  await p.goto(
    process.env.CONTEXT_URL ||
      "https://github.com/microsoft/vscode/pull/346472",
    {
      waitUntil: "domcontentloaded",
    },
  );
  await p
    .locator(process.env.CONTEXT_URL ? ".vcard-username" : ".cl-host")
    .waitFor();
  await p.bringToFront();
  const w = c.serviceWorkers()[0];
  await w.evaluate(() => chrome.storage.local.set({ cache: [] }));
  await w.evaluate(() => chrome.action.openPopup());
  await p.waitForTimeout(800);
  const cdp = await c.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets");
  const target = targetInfos.find((t) => t.url.endsWith("/popup.html"));
  if (!target) throw new Error("Popup target unavailable");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Popup query timeout")),
      90000,
    );
    cdp.on("Target.receivedMessageFromTarget", (e) => {
      const msg = JSON.parse(e.message);
      if (e.sessionId === sessionId && msg.id === 1) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
  await cdp.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(async()=>{await new Promise(r=>setTimeout(r,300));const prefill=document.querySelector('#user').value;document.querySelector('#user').value=prefill||'lszomoru';document.querySelector('#submit').click();while(document.querySelector('#submit').disabled)await new Promise(r=>setTimeout(r,100));return {prefill,status:document.querySelector('#status').textContent,counts:document.querySelector('#counts').textContent,firstLink:document.querySelector('#prs a')?.href};})()`,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  });
  const response = await reply;
  evidence = response.result?.result?.value || response;
  if (!evidence.status?.includes("查询完成"))
    throw new Error(JSON.stringify(evidence));
  console.log("TOOLBAR PASS", JSON.stringify(evidence));
} catch (e) {
  evidence = { failure: e.stack };
  console.log(evidence);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    ext +
      (process.env.CONTEXT_URL
        ? "/tests/toolbar-profile-evidence.json"
        : "/tests/toolbar-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await Promise.race([c.close(), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(process.exitCode || 0);
}
