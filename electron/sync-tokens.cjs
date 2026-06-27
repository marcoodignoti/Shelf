const crypto = require("node:crypto");

// URL-safe base64 random token of `byteLength` bytes (no padding).
function generateToken(byteLength) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

// SHA-256 hex hash of a token. Only the hash is ever stored in the database,
// never the plaintext token.
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// Constant-time comparison of a plaintext token against its stored hash, to
// avoid timing oracles on token validation.
function verifyToken(token, expectedHash) {
  if (typeof expectedHash !== "string" || expectedHash.length === 0) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { generateToken, hashToken, verifyToken };
