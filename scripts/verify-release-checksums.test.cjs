const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

describe("verify-release-checksums", () => {
  it("exits 0 when a file matches a provided 64-hex sha256", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-verify-"));
    const file = path.join(dir, "artifact.dmg");
    fs.writeFileSync(file, Buffer.from("hello"));
    const hash = crypto.createHash("sha256").update("hello").digest("hex");

    const { verifyFileAgainstHash } = require("./verify-release-checksums.cjs");
    const ok = verifyFileAgainstHash(file, hash);
    assert.equal(ok, true);
  });

  it("returns false when a file does not match (tampered)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-verify-"));
    const file = path.join(dir, "artifact.dmg");
    fs.writeFileSync(file, Buffer.from("tampered"));
    const hash = crypto.createHash("sha256").update("original").digest("hex");

    const { verifyFileAgainstHash } = require("./verify-release-checksums.cjs");
    const ok = verifyFileAgainstHash(file, hash);
    assert.equal(ok, false);
  });

  it("looks up a file by basename inside a SHA256SUMS buffer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-verify-"));
    const file = path.join(dir, "Shelf_1.0.0.dmg");
    fs.writeFileSync(file, Buffer.from("payload"));
    const hash = sha256OfFile(file);
    const sums = `${hash}  Shelf_1.0.0.dmg\notherhash  Shelf_other.zip\n`;

    const { findHashInSums } = require("./verify-release-checksums.cjs");
    const found = findHashInSums(path.basename(file), sums);
    assert.equal(found, hash);
  });
});
