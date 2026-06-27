const test = require("node:test");
const assert = require("node:assert");
const { createPairingController } = require("./sync-pairing.cjs");

function makeController() {
  return createPairingController({
    port: 43201,
    hostCandidates: ["192.168.1.5"],
    certFingerprint: "abc123",
  });
}

test("startPairing returns a QR payload + PIN; consume resolves a device token", () => {
  const c = makeController();
  const session = c.startPairing();
  assert.match(session.qrPayload, /^https:\/\/192\.168\.1\.5:43201\/pair\?token=/);
  assert.match(session.pin, /^\d{6}$/);
  const result = c.consumePairing({ token: session.pairingToken, name: "iPhone", platform: "ios" });
  assert.ok(result.deviceToken);
});

test("consumePairing rejects unknown token", () => {
  const c = makeController();
  assert.throws(() => c.consumePairing({ token: "nope", name: "X", platform: "ios" }), /invalid or expired/);
});

test("pairing token expires after TTL", async () => {
  const c = createPairingController({
    port: 43201,
    hostCandidates: ["192.168.1.5"],
    certFingerprint: "abc123",
    ttlMs: 1, // expires almost immediately
  });
  const session = c.startPairing();
  // Wait past the TTL so expiry is deterministic regardless of sub-ms scheduling.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.throws(() => c.consumePairing({ token: session.pairingToken, name: "X", platform: "ios" }), /expired/);
});

test("a pairing token can only be consumed once", () => {
  const c = makeController();
  const session = c.startPairing();
  c.consumePairing({ token: session.pairingToken, name: "A", platform: "ios" });
  assert.throws(() => c.consumePairing({ token: session.pairingToken, name: "B", platform: "ios" }), /invalid or expired/);
});

test("currentSession exposes the pending pairing for UI polling", () => {
  const c = makeController();
  assert.strictEqual(c.currentSession(), null);
  const session = c.startPairing();
  const current = c.currentSession();
  assert.ok(current);
  assert.strictEqual(current.pin, session.pin);
  assert.strictEqual(current.qrPayload, session.qrPayload);
});

test("cancel clears all pending sessions", () => {
  const c = makeController();
  c.startPairing();
  c.cancel();
  assert.strictEqual(c.currentSession(), null);
});
