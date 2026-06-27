const test = require("node:test");
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { runSyncDeviceMigration } = require("./backend-helpers.cjs");

test("sync_devices migration is idempotent and creates expected columns", () => {
  const db = new DatabaseSync(":memory:");
  runSyncDeviceMigration(db);
  runSyncDeviceMigration(db); // idempotent — no error
  const cols = db
    .prepare("SELECT name FROM pragma_table_info('sync_devices')")
    .all()
    .map((r) => r.name);
  assert.ok(cols.includes("device_id"));
  assert.ok(cols.includes("token_hash"));
  assert.ok(cols.includes("revoked"));
  assert.ok(cols.includes("last_seen"));
  db.close();
});

test("sync_devices accepts a device row with all fields", () => {
  const db = new DatabaseSync(":memory:");
  runSyncDeviceMigration(db);
  db.prepare(
    `INSERT INTO sync_devices (device_id, name, platform, token_hash, paired_at, last_seen, revoked)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  ).run("dev:1", "iPhone", "ios", "hashabc", "2026-06-27T00:00:00Z", "2026-06-27T00:01:00Z");
  const row = db.prepare("SELECT * FROM sync_devices WHERE device_id = ?").get("dev:1");
  assert.strictEqual(row.name, "iPhone");
  assert.strictEqual(row.platform, "ios");
  assert.strictEqual(row.revoked, 0);
  db.close();
});
