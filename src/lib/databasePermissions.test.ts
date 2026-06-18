import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// electron/backend.cjs is CommonJS and uses node:sqlite. Vitest's node
// environment can require it directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openDatabase } = require("../../electron/backend.cjs");

describe("openDatabase file permissions", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-perms-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("creates opennotion.db with mode 0o600", () => {
    const db = openDatabase(dataDir, "0.0.1-test");
    // A write forces WAL/SHM sidecar creation so their permissions are covered too.
    db.prepare("CREATE TABLE IF NOT EXISTS probe (x INTEGER)").run();
    db.prepare("INSERT INTO probe VALUES (1)").run();
    db.close();

    const dbPath = path.join(dataDir, "opennotion.db");
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);

    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      expect(fs.statSync(walPath).mode & 0o777).toBe(0o600);
    }
  });

  it("enables foreign keys and declares core Studio relationships on fresh databases", () => {
    const db = openDatabase(dataDir, "0.0.1-test");

    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(
      db
        .prepare("PRAGMA foreign_key_list('studio_document_page_links')")
        .all()
        .map((row: { table: string }) => row.table)
        .sort(),
    ).toEqual(["pages", "studio_documents"]);

    db.close();
  });
});
