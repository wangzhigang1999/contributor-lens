import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
// An explicit allowlist keeps credentials, tests, dependencies, and CI out of packages.
export const extensionFiles = [
  "manifest.json",
  "background.js",
  "authors.js",
  "content.js",
  "core.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];
const temporary = await mkdtemp(path.join(tmpdir(), "contributor-lens-build-"));
try {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (
    process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME !== `v${manifest.version}`
  ) {
    throw new Error("Release tag must match the manifest version (v<version>).");
  }
  if (process.env.GITHUB_REF_TYPE === "tag" && !process.env.CRX_PRIVATE_KEY) {
    throw new Error("Tagged releases require the CRX_PRIVATE_KEY Actions secret.");
  }
  const signingKey =
    process.env.CRX_PRIVATE_KEY ||
    generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;
  if (!process.env.CRX_PRIVATE_KEY)
    console.log(
      "Using a temporary signing key; this build has a temporary extension ID.",
    );
  const stage = path.join(temporary, "extension");
  const keyFile = path.join(temporary, "signing.pem");
  await mkdir(path.join(stage, "icons"), { recursive: true });
  await writeFile(keyFile, signingKey, { mode: 0o600 });
  const entries = {};
  for (const file of extensionFiles) {
    await copyFile(path.join(root, file), path.join(stage, file));
    entries[file] = [
      new Uint8Array(await readFile(path.join(stage, file))),
      { mtime: new Date("2026-01-01T00:00:00Z") },
    ];
  }
  const packed = spawnSync(
    process.env.CHROMIUM_PATH || chromium.executablePath(),
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=${path.join(temporary, "profile")}`,
      `--pack-extension=${stage}`,
      `--pack-extension-key=${keyFile}`,
    ],
    { timeout: 30000, encoding: "utf8" },
  );
  // Never print Chromium's raw output: it may contain paths to signing material.
  if (packed.error || packed.status !== 0)
    throw new Error(
      `Chromium packaging failed (exit ${packed.error?.code ?? packed.status ?? "timeout"}).`,
    );
  const crx = await readFile(stage + ".crx");
  if (crx.toString("ascii", 0, 4) !== "Cr24" || crx.readUInt32LE(4) !== 3)
    throw new Error("Expected a CRX3 package.");
  await rm(output, { recursive: true, force: true });
  await mkdir(output);
  const basename = `contributor-lens-${manifest.version}`;
  const artifacts = {
    [`${basename}.crx`]: crx,
    [`${basename}.zip`]: Buffer.from(zipSync(entries, { level: 9 })),
  };
  const checksums = [];
  for (const [name, bytes] of Object.entries(artifacts)) {
    await writeFile(path.join(output, name), bytes);
    checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
  }
  await writeFile(path.join(output, "SHA256SUMS"), checksums.join("\n") + "\n");
  console.log(
    `Built CRX3, unpacked-install ZIP, and SHA256SUMS in dist/ (version ${manifest.version}).`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
