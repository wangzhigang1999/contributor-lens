import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const base = `contributor-lens-${manifest.version}`;
const crx = await readFile(path.join(root, "dist", base + ".crx"));
const zip = await readFile(path.join(root, "dist", base + ".zip"));
const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "core.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
].sort();

// CRX3 protobuf fields used here are all length-delimited. Reject unknown wire types.
// Schema: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/crx_file/crx3.proto
function fields(bytes) {
  const output = new Map();
  let offset = 0;
  function varint() {
    let value = 0,
      shift = 0,
      next;
    do {
      assert(offset < bytes.length && shift < 35, "Invalid protobuf varint");
      next = bytes[offset++];
      value += (next & 127) * 2 ** shift;
      shift += 7;
    } while (next & 128);
    return value;
  }
  while (offset < bytes.length) {
    const tag = varint();
    assert.equal(tag & 7, 2, "Unexpected protobuf wire type");
    const size = varint();
    assert(offset + size <= bytes.length, "Truncated protobuf field");
    output.set(Math.floor(tag / 8), bytes.subarray(offset, offset + size));
    offset += size;
  }
  return output;
}
assert.equal(crx.toString("ascii", 0, 4), "Cr24");
assert.equal(crx.readUInt32LE(4), 3);
const headerEnd = 12 + crx.readUInt32LE(8);
assert(headerEnd < crx.length);
const header = fields(crx.subarray(12, headerEnd));
const proof = fields(header.get(2));
const publicKey = proof.get(1),
  signature = proof.get(2),
  signedHeader = header.get(10000);
const size = Buffer.alloc(4);
size.writeUInt32LE(signedHeader.length);
const payload = Buffer.concat([
  Buffer.from("CRX3 SignedData\0"),
  size,
  signedHeader,
  crx.subarray(headerEnd),
]);
const key = createPublicKey({ key: publicKey, format: "der", type: "spki" });
assert(verify("sha256", payload, key, signature), "Invalid CRX3 signature");
const tampered = Buffer.from(payload);
tampered[tampered.length - 1] ^= 1;
assert(
  !verify("sha256", tampered, key, signature),
  "Signature must reject altered payloads",
);
const identity = fields(signedHeader).get(1);
assert.deepEqual(
  identity,
  createHash("sha256").update(publicKey).digest().subarray(0, 16),
);
for (const archive of [zip, crx.subarray(headerEnd)]) {
  const entries = unzipSync(archive);
  // Chromium emits a directory entry when packing the icon files.
  if (entries["icons/"]) {
    assert.equal(entries["icons/"].length, 0);
    delete entries["icons/"];
  }
  assert.deepEqual(Object.keys(entries).sort(), files);
  for (const file of files)
    assert.deepEqual(Buffer.from(entries[file]), await readFile(path.join(root, file)));
}
const checksums = await readFile(path.join(root, "dist", "SHA256SUMS"), "utf8");
for (const [extension, bytes] of [
  ["crx", crx],
  ["zip", zip],
])
  assert(
    checksums.includes(
      `${createHash("sha256").update(bytes).digest("hex")}  ${base}.${extension}`,
    ),
  );
const extensionId = [...identity.toString("hex")]
  .map((n) => String.fromCharCode(97 + parseInt(n, 16)))
  .join("");
console.log(
  `Verified CRX3 signature, tamper rejection, extension ID ${extensionId}, runtime files, and SHA-256 checksums.`,
);
