const crypto = require("node:crypto");
const { hashToken, verifyToken } = require("./sync-tokens.cjs");

function nowIso() {
  return new Date().toISOString();
}

// CRUD over the sync_devices table. The store never holds the plaintext token:
// registerDevice hashes it before persisting, and lookups compare hashes via
// verifyToken (constant-time). Returned records never include the token hash.
function createSyncDeviceStore(db) {
  function registerDevice({ name, platform, token }) {
    const deviceId = "dev:" + crypto.randomUUID();
    const tokenHash = hashToken(token);
    const now = nowIso();
    db.prepare(
      `INSERT INTO sync_devices (device_id, name, platform, token_hash, paired_at, last_seen, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(deviceId, String(name), String(platform), tokenHash, now, now);
    return {
      device_id: deviceId,
      name: String(name),
      platform: String(platform),
      paired_at: now,
      last_seen: now,
      revoked: 0,
    };
  }

  function lookupByToken(token) {
    // Scan non-revoked rows and compare hashes in constant time. The device
    // count is small (paired phones), so a linear scan is fine.
    const rows = db
      .prepare("SELECT device_id, name, platform, paired_at, last_seen, token_hash FROM sync_devices WHERE revoked = 0")
      .all();
    for (const row of rows) {
      if (verifyToken(token, row.token_hash)) {
        const { token_hash, ...safe } = row;
        return safe;
      }
    }
    return null;
  }

  function listDevices() {
    return db
      .prepare(
        "SELECT device_id, name, platform, paired_at, last_seen, revoked FROM sync_devices WHERE revoked = 0 ORDER BY paired_at ASC",
      )
      .all();
  }

  function revokeDevice(deviceId) {
    db.prepare("UPDATE sync_devices SET revoked = 1 WHERE device_id = ?").run(deviceId);
  }

  function touchLastSeen(deviceId) {
    db.prepare("UPDATE sync_devices SET last_seen = ? WHERE device_id = ?").run(nowIso(), deviceId);
  }

  return { registerDevice, lookupByToken, listDevices, revokeDevice, touchLastSeen };
}

module.exports = { createSyncDeviceStore };
