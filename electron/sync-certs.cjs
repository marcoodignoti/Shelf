const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const selfsigned = require("selfsigned");
const { ensurePrivateDirectory, SYNC_CERT_VALIDITY_YEARS } = require("./backend-helpers.cjs");

const CERT_FILE = "sync-cert.pem";
const KEY_FILE = "sync-key.pem";
const CN = "Shelf Sync";

function directoryFor(appConfigDir) {
  return path.join(appConfigDir, "sync-server");
}

function readPair(dir) {
  const certPath = path.join(dir, CERT_FILE);
  const keyPath = path.join(dir, KEY_FILE);
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
  return {
    cert: fs.readFileSync(certPath, "utf8"),
    key: fs.readFileSync(keyPath, "utf8"),
  };
}

function writePair(dir, pair) {
  ensurePrivateDirectory(dir);
  fs.writeFileSync(path.join(dir, CERT_FILE), pair.cert, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, KEY_FILE), pair.key, { mode: 0o600 });
}

function fingerprintOf(certPem) {
  const der = new crypto.X509Certificate(certPem).raw;
  return crypto.createHash("sha256").update(der).digest("hex");
}

// selfsigned v5 is async and returns { private, public, cert, fingerprint }.
// RSA-2048 is used because selfsigned does not support EC key generation well;
// RSA-2048 is acceptable for local-network TLS.
async function generatePair() {
  const attrs = [{ name: "commonName", value: CN }];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    days: SYNC_CERT_VALIDITY_YEARS * 365,
  });
  return { cert: pems.cert, key: pems.private };
}

async function ensureSyncCert(appConfigDir) {
  const dir = directoryFor(appConfigDir);
  const existing = readPair(dir);
  if (existing) return { ...existing, fingerprint: fingerprintOf(existing.cert) };
  const pair = await generatePair();
  writePair(dir, pair);
  return { ...pair, fingerprint: fingerprintOf(pair.cert) };
}

module.exports = { ensureSyncCert, fingerprintOf };
