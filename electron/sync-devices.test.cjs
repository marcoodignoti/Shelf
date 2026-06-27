const test = require("node:test");
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { runSyncDeviceMigration, SYNC_DEVICE_TOKEN_BYTES } = require("./backend-helpers.cjs");
const { generateToken } = require("./sync-tokens.cjs");
const { createSyncDeviceStore } = require("./sync-devices.cjs");

function makeStore() {
  const db = new DatabaseSync(":memory:");
  runSyncDeviceMigration(db);
  return { db, store: createSyncDeviceStore(db) };
}

test("registerDevice stores the hashed token and returns a sanitized record", () => {
  const { db, store } = makeStore();
  const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
  const dev = store.registerDevice({ name: "Marco iPhone", platform: "ios", token });
  assert.strictEqual(dev.name, "Marco iPhone");
  assert.strictEqual(dev.platform, "ios");
  assert.strictEqual(dev.revoked, 0);
  assert.ok(dev.device_id);
  // token must NOT be stored in plaintext
  const row = db.prepare("SELECT token_hash, name FROM sync_devices WHERE device_id = ?").get(dev.device_id);
  assert.notStrictEqual(row.token_hash, token);
  assert.ok(row.token_hash.length > 0);
  // and must not leak through the returned record
  assert.ok(!JSON.stringify(dev).includes(token));
});

test("lookupByToken finds active devices, ignores revoked", () => {
  const { store } = makeStore();
  const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
  const dev = store.registerDevice({ name: "iPad", platform: "ios", token });
  assert.ok(store.lookupByToken(token));
  store.revokeDevice(dev.device_id);
  assert.strictEqual(store.lookupByToken(token), null);
});

test("listDevices returns active devices with last_seen", () => {
  const { store } = makeStore();
  store.registerDevice({ name: "A", platform: "ios", token: generateToken(SYNC_DEVICE_TOKEN_BYTES) });
  const list = store.listDevices();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, "A");
  assert.ok("last_seen" in list[0]);
});

test("touchLastSeen updates last_seen", () => {
  const { store } = makeStore();
  const dev = store.registerDevice({ name: "A", platform: "ios", token: generateToken(SYNC_DEVICE_TOKEN_BYTES) });
  const before = store.listDevices()[0].last_seen;
  // small delay to ensure the ISO timestamp differs
  const start = Date.now();
  while (Date.now() - start < 10) { /* spin briefly */ }
  store.touchLastSeen(dev.device_id);
  const after = store.listDevices()[0].last_seen;
  assert.notStrictEqual(after, before);
});

test("lookupByToken returns null for an unknown token", () => {
  const { store } = makeStore();
  assert.strictEqual(store.lookupByToken(generateToken(SYNC_DEVICE_TOKEN_BYTES)), null);
});
