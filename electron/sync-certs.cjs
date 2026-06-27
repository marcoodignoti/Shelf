const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ensurePrivateDirectory, SYNC_CERT_VALIDITY_YEARS } = require("./backend-helpers.cjs");

const CERT_FILE = "sync-cert.pem";
const KEY_FILE = "sync-key.pem";
const CN = "Shelf Sync";

// OIDs.
const OID_ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";
const OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1";
const OID_P256 = "1.2.840.10045.3.1.7";
const OID_COMMON_NAME = "2.5.4.3";

// --- Minimal ASN.1 DER encoder ----------------------------------------------

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  if (length < 0x10000) return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
  throw new Error(`derLength: unsupported length ${length}`);
}

function derWrap(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSeq(...items) {
  return derWrap(0x30, Buffer.concat(items));
}
function derSet(...items) {
  return derWrap(0x31, Buffer.concat(items));
}
function derNull() {
  return Buffer.from([0x05, 0x00]);
}
function derOid(oid) {
  const parts = oid.split(".").map(Number);
  const body = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let value = parts[i];
    const chunk = [value & 0x7f];
    value >>= 7;
    while (value > 0) {
      chunk.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    body.push(...chunk);
  }
  return derWrap(0x06, Buffer.from(body));
}
function derInt(value) {
  let bytes = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  // Ensure the integer is interpreted as positive: prepend 0x00 if the high bit is set.
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  return derWrap(0x02, bytes);
}
function derBitString(content) {
  return derWrap(0x03, Buffer.concat([Buffer.from([0x00]), content]));
}
function derUtf8String(value) {
  return derWrap(0x0c, Buffer.from(value, "utf8"));
}
function derUtcTime(value) {
  return derWrap(0x17, Buffer.from(value, "ascii"));
}

function algorithmIdentifier(oid) {
  return derSeq(derOid(oid), derNull());
}

function nameSequence(commonName) {
  return derSeq(derSet(derSeq(derOid(OID_COMMON_NAME), derUtf8String(commonName))));
}

function validitySequence(notBefore, notAfter) {
  return derSeq(derUtcTime(notBefore), derUtcTime(notAfter));
}

function toUtcTime(date) {
  // YYMMDDhhmmssZ
  const pad = (n) => String(n).padStart(2, "0");
  return (
    String(date.getUTCFullYear()).slice(-2) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

// --- Self-signed X.509 v1 ECDSA P-256 cert minting ---------------------------

function generatePair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });

  // Serial: random positive integer.
  const serialBytes = crypto.randomBytes(16);
  serialBytes[0] &= 0x7f;

  const now = new Date();
  const notAfter = new Date(now.getTime() + SYNC_CERT_VALIDITY_YEARS * 365 * 24 * 60 * 60 * 1000);

  // Exported SPKI DER is already a valid SubjectPublicKeyInfo SEQUENCE.
  const spkiDer = publicKey.export({ type: "spki", format: "der" });

  const tbs = derSeq(
    derInt(serialBytes),
    algorithmIdentifier(OID_ECDSA_WITH_SHA256),
    nameSequence(CN),
    validitySequence(toUtcTime(now), toUtcTime(notAfter)),
    nameSequence(CN),
    spkiDer,
  );

  // crypto.sign returns the DER-encoded ECDSA signature SEQUENCE { r, s } already.
  const signatureDer = crypto.sign(null, tbs, privateKey);

  const certificateDer = derSeq(
    tbs,
    algorithmIdentifier(OID_ECDSA_WITH_SHA256),
    derBitString(signatureDer),
  );

  const certPem = [
    "-----BEGIN CERTIFICATE-----",
    certificateDer.toString("base64").match(/.{1,64}/g).join("\n"),
    "-----END CERTIFICATE-----",
    "",
  ].join("\n");
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });

  return { cert: certPem, key: keyPem };
}

// --- Persistence -------------------------------------------------------------

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

function ensureSyncCert(appConfigDir) {
  const dir = directoryFor(appConfigDir);
  const existing = readPair(dir);
  if (existing) return { ...existing, fingerprint: fingerprintOf(existing.cert) };
  const pair = generatePair();
  writePair(dir, pair);
  return { ...pair, fingerprint: fingerprintOf(pair.cert) };
}

module.exports = { ensureSyncCert, fingerprintOf, generatePair };