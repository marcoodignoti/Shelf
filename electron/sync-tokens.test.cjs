const test = require("node:test");
const assert = require("node:assert");
const { generateToken, hashToken, verifyToken } = require("./sync-tokens.cjs");

test("generateToken returns url-safe base64 of the requested length", () => {
  const t = generateToken(32);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  // 32 bytes → ~43 chars base64url, no padding
  assert.ok(t.length >= 42 && t.length <= 44);
});

test("hashToken is stable and different from the token", () => {
  const t = generateToken(32);
  const h = hashToken(t);
  assert.ok(typeof h === "string" && h.length > 0);
  assert.notStrictEqual(h, t);
  assert.strictEqual(hashToken(t), h); // deterministic
});

test("verifyToken matches the hash and rejects others", () => {
  const t = generateToken(32);
  const h = hashToken(t);
  assert.strictEqual(verifyToken(t, h), true);
  assert.strictEqual(verifyToken(generateToken(32), h), false);
  assert.strictEqual(verifyToken(t, null), false);
});

test("two generated tokens are different (randomness)", () => {
  assert.notStrictEqual(generateToken(32), generateToken(32));
});
