const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const child_process = require("node:child_process");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

describe("notarizeApp", () => {
  it("is a no-op when Apple credentials are absent and never invokes xcrun", async () => {
    // Strip Apple creds from env so the fallback path is exercised.
    const saved = {
      SHELF_APPLE_ID: process.env.SHELF_APPLE_ID,
      SHELF_APPLE_APP_SPECIFIC_PASSWORD: process.env.SHELF_APPLE_APP_SPECIFIC_PASSWORD,
      SHELF_APPLE_TEAM_ID: process.env.SHELF_APPLE_TEAM_ID,
      SHELF_MAC_CODESIGN_IDENTITY: process.env.SHELF_MAC_CODESIGN_IDENTITY,
      OPENNOTION_MAC_CODESIGN_IDENTITY: process.env.OPENNOTION_MAC_CODESIGN_IDENTITY,
    };
    delete process.env.SHELF_APPLE_ID;
    delete process.env.SHELF_APPLE_APP_SPECIFIC_PASSWORD;
    delete process.env.SHELF_APPLE_TEAM_ID;
    delete process.env.SHELF_MAC_CODESIGN_IDENTITY;
    delete process.env.OPENNOTION_MAC_CODESIGN_IDENTITY;

    // Force a fresh require so env is read at module load.
    delete require.cache[require.resolve("./electron-notarize.cjs")];

    // Stub spawnSync to record any invocation of xcrun.
    const realSpawnSync = child_process.spawnSync;
    const calls = [];
    child_process.spawnSync = function stubbedSpawnSync(command, args, options) {
      if (command === "xcrun") calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };

    try {
      const { notarizeApp } = require("./electron-notarize.cjs");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-notarize-"));
      const appPath = path.join(tmpDir, "Shelf.app");
      const dmgPath = path.join(tmpDir, "Shelf.dmg");
      fs.mkdirSync(appPath, { recursive: true });
      fs.writeFileSync(dmgPath, Buffer.alloc(8));

      // notarizeApp is synchronous (it uses spawnSync, no real async work).
      const result = notarizeApp({ appPath, dmgPath });
      assert.equal(result.skipped, true);
      assert.equal(calls.length, 0, "xcrun must not be invoked when credentials are absent");
    } finally {
      child_process.spawnSync = realSpawnSync;
      Object.entries(saved).forEach(([key, value]) => {
        if (value !== undefined) process.env[key] = value;
      });
    }
  });
});
