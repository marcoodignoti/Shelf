const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ensureSyncCert, fingerprintOf } = require("./sync-certs.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shelf-cert-"));
}

test("ensureSyncCert generates a cert+key pair on first call", async () => {
  const dir = tempDir();
  const { cert, key, fingerprint } = await ensureSyncCert(dir);
  assert.ok(cert.includes("BEGIN CERTIFICATE"));
  assert.ok(key.includes("PRIVATE KEY"));
  assert.match(fingerprint, /^[0-9a-f]{64}$/); // sha-256 hex of DER
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ensureSyncCert reloads the same cert on subsequent calls (stable fingerprint)", async () => {
  const dir = tempDir();
  const a = await ensureSyncCert(dir);
  const b = await ensureSyncCert(dir);
  assert.strictEqual(a.fingerprint, b.fingerprint);
  assert.strictEqual(a.cert, b.cert);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fingerprintOf matches the certificate's DER", async () => {
  const dir = tempDir();
  const { cert, fingerprint } = await ensureSyncCert(dir);
  const der = new crypto.X509Certificate(cert).raw;
  assert.strictEqual(crypto.createHash("sha256").update(der).digest("hex"), fingerprint);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ensureSyncCert writes files with restrictive permissions", async () => {
  const dir = tempDir();
  await ensureSyncCert(dir);
  const certPath = path.join(dir, "sync-server", "sync-cert.pem");
  const keyPath = path.join(dir, "sync-server", "sync-key.pem");
  assert.ok(fs.existsSync(certPath));
  assert.ok(fs.existsSync(keyPath));
  // Mode bits should not expose to group/other (0o600 target, but the umask
  // and platform may differ — assert the group/other write/exec bits are clear).
  const keyMode = fs.statSync(keyPath).mode & 0o077;
  assert.strictEqual(keyMode & 0o022, 0, "key file should not be writable by group/other");
  fs.rmSync(dir, { recursive: true, force: true });
});
