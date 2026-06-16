const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isExcludedEntry,
  copyDirectoryFiltered,
  assertBundleClean,
} = require("./audit-release-bundle.cjs");

describe("isExcludedEntry", () => {
  it("excludes local dev directory names", () => {
    assert.equal(isExcludedEntry("/some/path/.shelf-dev"), true);
    assert.equal(isExcludedEntry("/some/path/.opennotion-dev"), true);
    assert.equal(isExcludedEntry("/some/path/.secrets"), true);
    assert.equal(isExcludedEntry("/some/path/.DS_Store"), true);
    assert.equal(isExcludedEntry("/some/path/.git"), true);
    assert.equal(isExcludedEntry("/some/path/node_modules"), true);
  });

  it("excludes SQLite database extensions", () => {
    assert.equal(isExcludedEntry("/some/path/data.db"), true);
    assert.equal(isExcludedEntry("/some/path/data.sqlite"), true);
    assert.equal(isExcludedEntry("/some/path/data.sqlite3"), true);
  });

  it("excludes local-only PEM files", () => {
    assert.equal(isExcludedEntry("/some/path/key.pem.local"), true);
  });

  it("does not exclude ordinary source or asset files", () => {
    assert.equal(isExcludedEntry("/some/path/index.js"), false);
    assert.equal(isExcludedEntry("/some/path/app-icon.png"), false);
    assert.equal(isExcludedEntry("/some/path/index.html"), false);
  });

  it("does not exclude files that only contain excluded words as substrings", () => {
    assert.equal(isExcludedEntry("/some/path/not-a-db-file.txt"), false);
    assert.equal(isExcludedEntry("/some/path/.shelf-dev-backup.json"), false);
  });
});

describe("copyDirectoryFiltered", () => {
  it("copies allowed files and skips excluded entries", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "audit-src-"));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "audit-dest-"));

    try {
      fs.mkdirSync(path.join(src, "allowed-dir"));
      fs.writeFileSync(path.join(src, "allowed-dir", "index.js"), "ok");
      fs.mkdirSync(path.join(src, ".shelf-dev"));
      fs.writeFileSync(path.join(src, ".shelf-dev", "secret.txt"), "secret");
      fs.writeFileSync(path.join(src, "notes.db"), "sqlite");

      copyDirectoryFiltered(src, dest);

      assert.equal(
        fs.readFileSync(path.join(dest, "allowed-dir", "index.js"), "utf8"),
        "ok"
      );
      assert.equal(fs.existsSync(path.join(dest, ".shelf-dev")), false);
      assert.equal(fs.existsSync(path.join(dest, "notes.db")), false);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe("assertBundleClean", () => {
  it("does not throw for a clean bundle", () => {
    const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "audit-clean-"));
    try {
      fs.writeFileSync(path.join(bundle, "index.js"), "ok");
      assert.doesNotThrow(() => assertBundleClean(bundle));
    } finally {
      fs.rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("throws when the bundle contains an excluded entry", () => {
    const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "audit-dirty-"));
    try {
      fs.writeFileSync(path.join(bundle, "notes.db"), "sqlite");
      assert.throws(
        () => assertBundleClean(bundle),
        /Bundle contains sensitive\/dev files/
      );
    } finally {
      fs.rmSync(bundle, { recursive: true, force: true });
    }
  });
});
