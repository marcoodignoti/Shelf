# Security Hardening Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the five findings (M1, L2, L1, M2, L3) from the 2026-06-16 security review, in that order, with each step independently testable and revertable.

**Architecture:** M1 adds release-only scripts and CI wiring (no app runtime change). L2 fixes DB file permissions inside `openDatabase`. L1 locks KaTeX's safe config with a regression test. M2 drops an unnecessary macOS entitlement. L3 narrows a wildcard port in the CSP via a runtime-injected header.

**Tech Stack:** Node `child_process.spawnSync` (no shell), Node `crypto`, Node `node:sqlite`, Node `node:test` for script tests, Vitest for `src/` tests, electron-builder config in `package.json`, GitHub Actions YAML.

**Reference spec:** `docs/superpowers/specs/2026-06-16-security-hardening-design.md`

**Testing conventions in this repo (important context):**
- `npm test` runs **Vitest** over `src/**/*.test.{ts,tsx}` only (see `vitest.config.ts`).
- `scripts/*.test.cjs` use **`node:test` + `node:assert`** and are run with `node --test scripts/*.test.cjs`. They are currently NOT wired into `npm test` or `check:electron`. This plan wires new script tests into `check:electron` so they run in CI (see Task 1.6).
- Backend (`electron/backend.cjs`) is CommonJS and uses `node:sqlite`. Vitest's `environment: "node"` can `require` it directly.

---

## Task 1: M1 — Notarization tooling (dormant) + checksums + verify script

> **✅ ALREADY IMPLEMENTED:** Tasks 1.1–1.5 and Steps 16–17 of Task 1.6 were completed in a prior session. The scripts, tests, and `package.json` wiring all exist. Only Step 18 (CI workflow) and Task 1.7 (SECURITY.md update) remain.

**Files:**
- Create: `scripts/electron-notarize.cjs`
- Create: `scripts/electron-notarize.test.cjs`
- Create: `scripts/write-release-checksums.cjs`
- Create: `scripts/verify-release-checksums.cjs`
- Create: `scripts/verify-release-checksums.test.cjs`
- Modify: `scripts/electron-package-dmg.cjs` (call `notarizeApp` after DMG verify)
- Modify: `package.json` (add `release:checksums` + `test:scripts` scripts)
- Modify: `.github/workflows/publish-release-assets.yml` (generate + upload SHA256SUMS)
- Modify: `SECURITY.md` (document verify command + dormant notarize path)

### Task 1.1: Notarization module — no-op fallback test (RED)

- [x] **Step 1: Write the failing test**

Create `scripts/electron-notarize.test.cjs`:

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test scripts/electron-notarize.test.cjs`
Expected: FAIL — `Cannot find module './electron-notarize.cjs'`

### Task 1.2: Notarization module — minimal implementation (GREEN)

- [x] **Step 3: Write minimal implementation**

Create `scripts/electron-notarize.cjs`:

```js
const { spawnSync } = require("node:child_process");

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function hasAppleCredentials() {
  return Boolean(
    env("SHELF_APPLE_ID") &&
    env("SHELF_APPLE_APP_SPECIFIC_PASSWORD") &&
    env("SHELF_APPLE_TEAM_ID")
  );
}

function hasDeveloperIdIdentity() {
  const identity = env("SHELF_MAC_CODESIGN_IDENTITY", env("OPENNOTION_MAC_CODESIGN_IDENTITY"));
  return Boolean(identity) && identity !== "-";
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

// Notarization is dormant by default: it only runs when an Apple ID, app-specific
// password, team id, AND a real (non ad-hoc) codesign identity are present. With
// none of those, this returns { skipped: true } and touches nothing. The day a
// Developer ID is configured, notarization + stapling activate with no code change.
//
// Synchronous on purpose: it only uses spawnSync (no real async work), so the
// caller in electron-package-dmg.cjs can treat it like the other run() steps.
function notarizeApp({ appPath, dmgPath }) {
  if (!hasAppleCredentials() || !hasDeveloperIdIdentity()) {
    console.log("Skipping notarization (no Apple credentials or Developer ID).");
    return { skipped: true };
  }

  const appleId = env("SHELF_APPLE_ID");
  const password = env("SHELF_APPLE_APP_SPECIFIC_PASSWORD");
  const teamId = env("SHELF_APPLE_TEAM_ID");

  // Pass secrets as explicit args, never via a shell. spawnSync with an arg
  // array does not invoke /bin/sh, so the password is not visible in a shell
  // process list.
  run("xcrun", [
    "notarytool", "submit", dmgPath,
    "--apple-id", appleId,
    "--team-id", teamId,
    "--password", password,
    "--wait",
  ]);
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "staple", appPath]);

  console.log(`Notarized and stapled ${dmgPath} and ${appPath}`);
  return { skipped: false };
}

module.exports = { notarizeApp, hasAppleCredentials, hasDeveloperIdIdentity };
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test scripts/electron-notarize.test.cjs`
Expected: PASS (1 test, 0 failures)

- [x] **Step 5: Commit**

```bash
git add scripts/electron-notarize.cjs scripts/electron-notarize.test.cjs
git commit -m "feat(release): add dormant macOS notarization module (M1)"
```

### Task 1.3: Wire notarizeApp into the DMG packager

- [x] **Step 6: Wire the call into electron-package-dmg.cjs**

Modify `scripts/electron-package-dmg.cjs`. The script is fully synchronous and `notarizeApp` is synchronous too (it only uses `spawnSync`), so the call drops in exactly like the other `run(...)` steps. After the `run("hdiutil", ["verify", dmgPath]);` line (line 89), add a require at the top of the file (with the other requires, lines 1-4) is not needed since it's only used once — require it inline. Replace the tail:

```js
run("hdiutil", ["verify", dmgPath]);

console.log(`Packaged ${dmgPath}`);
```

with:

```js
run("hdiutil", ["verify", dmgPath]);

const { notarizeApp } = require("./electron-notarize.cjs");
notarizeApp({ appPath, dmgPath });

console.log(`Packaged ${dmgPath}`);
```

A notarization failure (when active) throws from `run()` inside `notarizeApp`, which propagates as an uncaught error and sets the Node process exit code to 1 — matching how the existing `run("hdiutil", ...)` failures are already handled. In the dormant no-op case it logs and returns without error.

- [x] **Step 7: Verify the packager still parses**

Run: `node -c scripts/electron-package-dmg.cjs`
Expected: no output (syntax OK). (We cannot fully run it here without a packaged app; the CI macOS job exercises it.)

- [x] **Step 8: Commit**

```bash
git add scripts/electron-package-dmg.cjs
git commit -m "feat(release): invoke dormant notarization from DMG packager (M1)"
```

### Task 1.4: Checksum writer + verifier (RED)

- [x] **Step 9: Write the failing test for the verifier**

Create `scripts/verify-release-checksums.test.cjs`:

```js
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

describe("verify-release-checksums", () => {
  it("exits 0 when a file matches a provided 64-hex sha256", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-verify-"));
    const file = path.join(dir, "artifact.dmg");
    fs.writeFileSync(file, Buffer.from("hello"));
    const hash = crypto.createHash("sha256").update("hello").digest("hex");

    const { verifyFileAgainstHash } = require("./verify-release-checksums.cjs");
    const ok = verifyFileAgainstHash(file, hash);
    assert.equal(ok, true);
  });

  it("returns false when a file does not match (tampered)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-verify-"));
    const file = path.join(dir, "artifact.dmg");
    fs.writeFileSync(file, Buffer.from("tampered"));
    const hash = crypto.createHash("sha256").update("original").digest("hex");

    const { verifyFileAgainstHash } = require("./verify-release-checksums.cjs");
    const ok = verifyFileAgainstHash(file, hash);
    assert.equal(ok, false);
  });

  it("looks up a file by basename inside a SHA256SUMS buffer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-verify-"));
    const file = path.join(dir, "Shelf_1.0.0.dmg");
    fs.writeFileSync(file, Buffer.from("payload"));
    const hash = sha256OfFile(file);
    const sums = `${hash}  Shelf_1.0.0.dmg\notherhash  Shelf_other.zip\n`;

    const { findHashInSums } = require("./verify-release-checksums.cjs");
    const found = findHashInSums(path.basename(file), sums);
    assert.equal(found, hash);
  });
});
```

- [x] **Step 10: Run test to verify it fails**

Run: `node --test scripts/verify-release-checksums.test.cjs`
Expected: FAIL — `Cannot find module './verify-release-checksums.cjs'`

### Task 1.5: Checksum writer + verifier (GREEN)

- [x] **Step 11: Implement the verifier**

Create `scripts/verify-release-checksums.cjs`:

```js
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Look up the expected hash for `basename` inside a SHA256SUMS file's contents.
// Format: "<64-hex>  <filename>\n" per line. Returns null if not found.
function findHashInSums(basename, sumsContents) {
  for (const line of String(sumsContents).split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === basename) return match[1].toLowerCase();
  }
  return null;
}

// Returns true iff the file at filePath hashes to expectedHash (64-hex).
function verifyFileAgainstHash(filePath, expectedHash) {
  const expected = String(expectedHash ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(expected)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  return sha256OfFile(filePath).toLowerCase() === expected;
}

// CLI: node scripts/verify-release-checksums.cjs <file> [sha256-or-SHA256SUMS-path]
function main() {
  const [, , filePath, hashArg] = process.argv;
  if (!filePath || !hashArg) {
    console.error("Usage: node scripts/verify-release-checksums.cjs <file> <sha256 | SHA256SUMS-path>");
    process.exit(2);
  }

  let expectedHash;
  const trimmed = String(hashArg).trim();
  if (SHA256_PATTERN.test(trimmed)) {
    expectedHash = trimmed;
  } else if (fs.existsSync(trimmed)) {
    expectedHash = findHashInSums(path.basename(filePath), fs.readFileSync(trimmed, "utf8"));
    if (!expectedHash) {
      console.error(`No checksum for ${path.basename(filePath)} in ${trimmed}`);
      process.exit(1);
    }
  } else {
    console.error(`Second argument is not a 64-hex SHA-256 or an existing SHA256SUMS file: ${trimmed}`);
    process.exit(2);
  }

  if (verifyFileAgainstHash(filePath, expectedHash)) {
    console.log(`OK  ${path.basename(filePath)} matches ${expectedHash}`);
    process.exit(0);
  }
  console.error(`FAIL  ${path.basename(filePath)} does NOT match ${expectedHash}`);
  process.exit(1);
}

module.exports = { sha256OfFile, findHashInSums, verifyFileAgainstHash, main };

if (require.main === module) main();
```

- [x] **Step 12: Implement the checksum writer**

Create `scripts/write-release-checksums.cjs`:

```js
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist-electron");

// Matches the release artifacts produced by the packaging scripts.
const ARTIFACT_GLOBS = ["Shelf_*.dmg", "Shelf_*.zip", "Shelf_*_setup_*.exe"];

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listArtifacts() {
  if (!fs.existsSync(distDir)) return [];
  const entries = fs.readdirSync(distDir).filter((name) => {
    const lower = name.toLowerCase();
    return (
      (lower.endsWith(".dmg") || lower.endsWith(".zip") || lower.endsWith(".exe")) &&
      /^shelf_/i.test(name)
    );
  });
  return entries.sort();
}

function writeChecksums() {
  const artifacts = listArtifacts();
  if (artifacts.length === 0) {
    throw new Error(`No release artifacts found in ${distDir}`);
  }
  const lines = artifacts.map((name) => {
    const hash = sha256OfFile(path.join(distDir, name));
    return `${hash}  ${name}`;
  });
  const outPath = path.join(distDir, "SHA256SUMS");
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
  console.log(`Wrote ${outPath} (${artifacts.length} entries)`);
  return { outPath, count: artifacts.length };
}

module.exports = { writeChecksums, listArtifacts, sha256OfFile };

if (require.main === module) writeChecksums();
```

- [x] **Step 13: Run the verifier test to verify it passes**

Run: `node --test scripts/verify-release-checksums.test.cjs`
Expected: PASS (3 tests)

- [x] **Step 14: Smoke-test the writer + verifier end-to-end**

Run:
```bash
mkdir -p dist-electron && printf 'fake mac' > dist-electron/Shelf_9.9.9_arm64.dmg && printf 'fake win' > dist-electron/Shelf_9.9.9_win-x64.zip && node scripts/write-release-checksums.cjs && cat dist-electron/SHA256SUMS && node scripts/verify-release-checksums.cjs dist-electron/Shelf_9.9.9_arm64.dmg dist-electron/SHA256SUMS; echo "exit=$?"; node scripts/verify-release-checksums.cjs dist-electron/Shelf_9.9.9_arm64.dmg "$(grep dmg dist-electron/SHA256SUMS | awk '{print $1}')"; echo "exit=$?"; printf 'tampered' > dist-electron/Shelf_9.9.9_arm64.dmg && node scripts/verify-release-checksums.cjs dist-electron/Shelf_9.9.9_arm64.dmg dist-electron/SHA256SUMS; echo "mismatch-exit=$?"; rm -f dist-electron/Shelf_9.9.9_* dist-electron/SHA256SUMS
```
Expected: writer logs `Wrote ... (2 entries)`; `cat` shows two lines; the matching lookups exit `0`; the tampered case exits `1`.

- [x] **Step 15: Commit**

```bash
git add scripts/write-release-checksums.cjs scripts/verify-release-checksums.cjs scripts/verify-release-checksums.test.cjs
git commit -m "feat(release): add SHA256SUMS writer + verifier for release artifacts (M1)"
```

### Task 1.6: Wire checksums into npm scripts and CI

- [x] **Step 16: Add npm scripts**

In `package.json`, in the `"scripts"` object, add (next to the other `release:*` scripts):

```json
    "release:checksums": "node scripts/write-release-checksums.cjs",
    "test:scripts": "node --test scripts/*.test.cjs",
```

Then insert `test:scripts` into the `check:electron` chain so script tests run in CI. Change the `check:electron` line from:

```
"check:electron": "npm run build && npm run test && npm run electron:smoke && ...
```
to:
```
"check:electron": "npm run build && npm run test && npm run test:scripts && npm run electron:smoke && ...
```

- [x] **Step 17: Verify the new scripts run**

Run: `npm run test:scripts`
Expected: PASS — both `electron-notarize.test.cjs` and `verify-release-checksums.test.cjs` (and the existing `audit-release-bundle.test.cjs`) pass.

- [ ] **Step 18: Wire SHA256SUMS into the publish workflow**

In `.github/workflows/publish-release-assets.yml`, add a step after "Download CI artifacts" (and before/after "Build signed beta update manifest"):

```yaml
      - name: Write release checksums
        run: |
          set -euo pipefail
          mkdir -p dist-electron
          cp artifacts/Shelf_macos-arm64/Shelf_*_arm64.dmg dist-electron/
          cp artifacts/Shelf_win-x64/Shelf_*_win-x64.zip dist-electron/
          cp artifacts/Shelf_win-x64_installer/Shelf_*_setup_win-x64.exe dist-electron/
          node scripts/write-release-checksums.cjs
```

And add `dist-electron/SHA256SUMS` to the `assets` array in the "Upload assets" step:

```yaml
          assets=(
              artifacts/Shelf_macos-arm64/Shelf_*_arm64.dmg \
              artifacts/Shelf_win-x64/Shelf_*_win-x64.zip \
              artifacts/Shelf_win-x64_installer/Shelf_*_setup_win-x64.exe \
              artifacts/Shelf_win-x64_installer/Shelf_*_setup_win-x64.exe.blockmap \
              dist-electron/SHA256SUMS
            )
```

- [ ] **Step 19: Commit**

```bash
git add package.json .github/workflows/publish-release-assets.yml
git commit -m "ci: publish SHA256SUMS with releases + run script tests in check:electron (M1)"
```

### Task 1.7: Document the verify command + dormant notarize path

- [ ] **Step 20: Update SECURITY.md**

In `SECURITY.md`, replace the "Current Distribution Caveats" section with an expanded version that adds checksum verification instructions and notes the dormant notarization path. Replace:

```markdown
## Current Distribution Caveats

- macOS builds are unsigned/ad-hoc and not notarized.
- Windows builds are unsigned portable zips.
- OS trust warnings are expected until Developer ID signing, notarization, and
  Windows code signing are implemented.
```

with:

```markdown
## Verifying a release artifact

Each release publishes a `SHA256SUMS` file alongside the artifacts. Verify a
download before opening it:

```sh
# With the SHA256SUMS file in the current directory:
node scripts/verify-release-checksums.cjs Shelf_<version>_arm64.dmg SHA256SUMS

# Or with a single 64-hex hash:
node scripts/verify-release-checksums.cjs Shelf_<version>_arm64.dmg <sha256>
```

The script exits `0` on match and `1` on mismatch.

## Current Distribution Caveats

- macOS builds are ad-hoc signed and **not notarized**. Notarization tooling is
  present but dormant (`scripts/electron-notarize.cjs`): it activates
  automatically once `SHELF_APPLE_ID`, `SHELF_APPLE_APP_SPECIFIC_PASSWORD`,
  `SHELF_APPLE_TEAM_ID`, and a real `SHELF_MAC_CODESIGN_IDENTITY` are provided
  at packaging time. No code change is required when an Apple Developer ID is
  obtained.
- Windows builds are unsigned portable zips.
- OS trust warnings are expected until Developer ID signing, notarization, and
  Windows code signing are implemented. Until then, verify artifacts with
  `SHA256SUMS` as described above.
```

- [ ] **Step 21: Commit**

```bash
git add SECURITY.md
git commit -m "docs: document release checksum verification + dormant notarization (M1)"
```

---

## Task 2: L2 — Restrict DB file permissions to 0o600

**Files:**
- Modify: `electron/backend.cjs` (add `restrictDatabaseFilePermissions`, call in `openDatabase`)
- Create: `src/lib/databasePermissions.test.ts` (Vitest)

### Task 2.1: Failing test for DB file permissions (RED)

- [ ] **Step 1: Write the failing test**

Create `src/lib/databasePermissions.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/databasePermissions.test.ts`
Expected: FAIL — assertion `(mode & 0o777) === 0o600` fails because the file is `0o644`.

### Task 2.2: Implement permission restriction (GREEN)

- [ ] **Step 3: Add the helper and call it in openDatabase**

In `electron/backend.cjs`, add a helper near `ensurePrivateDirectory` (after line 79):

```js
function restrictDatabaseFilePermissions(dbPath) {
  if (process.platform === "win32") return;
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(candidate)) fs.chmodSync(candidate, 0o600);
    } catch {
      // A missing sidecar on a fresh DB, or a chmod race, must not fail startup.
    }
  }
}
```

Then in `openDatabase`, call it twice: once right after `PRAGMA journal_mode = WAL` (line 286) and once at the end of the function (just before `return db;` on line 323). Concretely, after line 287 (`db.exec("PRAGMA synchronous = NORMAL");`) add:

```js
  restrictDatabaseFilePermissions(dbPath);
```

And replace the final `return db;` (line 323) with:

```js
  restrictDatabaseFilePermissions(dbPath);
  return db;
```

Also export `restrictDatabaseFilePermissions` from `module.exports` at the bottom of the file:

```js
module.exports = {
  ShelfBackend,
  openDatabase,
  runMigrations,
  ensurePrivateDirectory,
  restrictDatabaseFilePermissions,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/databasePermissions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/backend.cjs src/lib/databasePermissions.test.ts
git commit -m "fix(backend): restrict opennotion.db and WAL sidecars to 0o600 (L2)"
```

---

## Task 3: L1 — KaTeX XSS regression guard

**Files:**
- Modify: `src/lib/editorMath.tsx` (comment at `renderFormulaHtml`)
- Modify: `src/lib/editorMath.test.ts` (add adversarial-output test)

### Task 3.1: Regression-lock test for adversarial KaTeX output (LOCK)

- [ ] **Step 1: Add the adversarial test**

Append to `src/lib/editorMath.test.ts` (it already imports `renderFormulaHtml`). Add this `describe` block at the end of the file:

```ts
describe("renderFormulaHtml XSS regression guard", () => {
  // SECURITY INVARIANT: KaTeX output is rendered via dangerouslySetInnerHTML
  // in editorMath.tsx. The `trust: false` setting in renderFormulaHtml is the
  // security boundary that prevents \href{javascript:...}, \url{data:...}, etc.
  // from emitting executable markup. If anyone flips `trust: true`, this test
  // fails. Do not weaken these assertions.
  const forbidden = ["javascript:", "<script", "onerror=", "<img"];

  const adversarialFormulas = [
    "\\href{javascript:alert(1)}{click}",
    "\\url{data:text/html,<script>alert(1)</script>}",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "\\includegraphics{data:image/svg+xml,<svg onload=alert(1)>}",
  ];

  for (const formula of adversarialFormulas) {
    it(`produces no executable markup for: ${formula}`, () => {
      const html = renderFormulaHtml(formula);
      const lower = html.toLowerCase();
      for (const marker of forbidden) {
        expect(lower, `formula ${formula} produced forbidden marker ${marker}`).not.toContain(marker);
      }
    });
  }
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `npx vitest run src/lib/editorMath.test.ts`
Expected: PASS — current `trust: false` config already keeps output clean. This is a regression lock (not a TDD "red" step), so it should pass immediately. If any case fails, investigate before proceeding — that would indicate the current config is less safe than assumed.

If all pass, the guard is locked. Proceed to add the code comment.

### Task 3.2: Add the security-boundary comment

- [ ] **Step 3: Add the comment to renderFormulaHtml**

In `src/lib/editorMath.tsx`, at the top of `renderFormulaHtml` (line 1271), add a comment above the function body. Change:

```tsx
export function renderFormulaHtml(formula: string, displayMode = false): string {
  const normalizedFormula = normalizeFormulaForKatex(formula || "\\?");
```

to:

```tsx
export function renderFormulaHtml(formula: string, displayMode = false): string {
  // SECURITY: The returned HTML is injected via dangerouslySetInnerHTML in
  // KatexRenderer. The `trust: false` option below is the security boundary —
  // it prevents \href, \url, \includegraphics, etc. from emitting javascript:,
  // data:, or other executable markup. NEVER change to `trust: true` without
  // sanitizing the output with a sanitizer first. The adversarial test in
  // editorMath.test.ts ("renderFormulaHtml XSS regression guard") locks this.
  const normalizedFormula = normalizeFormulaForKatex(formula || "\\?");
```

- [ ] **Step 4: Re-run the test to confirm green**

Run: `npx vitest run src/lib/editorMath.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editorMath.tsx src/lib/editorMath.test.ts
git commit -m "test(editor): lock KaTeX trust:false against XSS regression (L1)"
```

---

## Task 4: M2 — Drop disable-library-validation entitlement

**Files:**
- Modify: `packaging/entitlements.mac.plist`

### Task 4.1: Pre-check + remove the entitlement

- [ ] **Step 1: Pre-check for native modules**

Run:
```bash
grep -rn "\.node'" src/ electron/ 2>/dev/null; grep -rn "require(.*\.node" src/ electron/ 2>/dev/null; find node_modules -name "*.node" -not -path "*/electron/*" 2>/dev/null | head
```
Expected: no output (no `.node` native modules are required by app code). Record the result. If output is non-empty, STOP and report — `disable-library-validation` may be required.

- [ ] **Step 2: Remove the entitlement**

In `packaging/entitlements.mac.plist`, remove the `disable-library-validation` key pair. Change:

```xml
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
```

to:

```xml
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
</dict>
```

(Rationale comment for the next reader, placed above `<dict>` is optional; the spec already documents it.)

- [ ] **Step 3: Verify the package + codesign still pass**

Run: `npm run electron:package:dir`
Expected: packaging succeeds and `codesign --verify` (run inside the script) passes. The change is cosmetic under ad-hoc signing but must not break the codesign step.

- [ ] **Step 4: Commit**

```bash
git add packaging/entitlements.mac.plist
git commit -m "fix(packaging): drop unnecessary disable-library-validation entitlement (M2)"
```

---

## Task 5: L3 — Tighten CSP connect-src to the bound port

**Files:**
- Modify: `index.html` (narrow the static fallback CSP)
- Modify: `electron/main.cjs` (inject runtime CSP header with the bound port)

> **Risk note (from spec):** L3 is the highest-runtime-risk step. Test the Studio PDF viewer in a packaged build after this change. If anything is fragile, the static meta tag is already narrowed so the fallback is strictly safer than today.

### Task 5.1: Narrow the static fallback CSP in index.html

- [ ] **Step 1: Narrow the wildcard port in the meta CSP**

In `index.html`, replace the `connect-src` portion of the CSP meta tag. Change:

```html
connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*;
```

to:

```html
connect-src 'self';
```

(The runtime header injected by `main.cjs` in the next step adds the specific `127.0.0.1:<port>` for the packaged app. The dev server injects its own CSP via Vite. Keeping the meta tag without the loopback wildcard means the worst case — the runtime header not applying — is a broken PDF viewer, not an exfiltration hole, which is strictly safer than today. The runtime header restores correct behavior for the packaged app.)

### Task 5.2: Inject a runtime CSP header with the bound port

- [ ] **Step 2: Add CSP header injection in the app protocol handler**

In `electron/main.cjs`, the `fileResponse` function (around line 378) currently does:

```js
async function fileResponse(filePath) {
  return await net.fetch(pathToFileURL(filePath).toString());
}
```

Add a CSP header to HTML responses served over the renderer host. Replace `fileResponse` with:

```js
function studioPdfConnectSrc() {
  // Include the actual bound port of the Studio PDF server instead of a
  // wildcard, so a compromised renderer cannot exfiltrate to an arbitrary
  // local process. ws:// is included because pdf.js worker fetches may
  // upgrade; both are loopback-only.
  return studioPdfServerOrigin
    ? `http://127.0.0.1:${studioPdfPort} ws://127.0.0.1:${studioPdfPort}`
    : "";
}
```

This requires capturing the port. Update `startStudioPdfServer` so the port is stored separately. Add a module-level variable near the other server vars (line 33):

```js
let studioPdfPort = null;
```

In `startStudioPdfServer`, after `studioPdfServerOrigin = \`http://127.0.0.1:${address.port}\`;` (line 313), add:

```js
      studioPdfPort = address.port;
```

In `app.on("before-quit", ...)` (line 772), reset it:

```js
  studioPdfServer = null;
  studioPdfServerOrigin = null;
  studioPdfPort = null;
```

Now modify `handleAppProtocolRequest` to attach a CSP header to HTML responses from the renderer host. The current renderer-host branch is:

```js
  if (parsed.hostname === APP_RENDERER_HOST) {
    const filePath = resolveFileUnderRoot(path.join(__dirname, "..", "dist"), parsed.pathname);
    return filePath ? await fileResponse(filePath) : plainTextResponse(404, "Not found");
  }
```

Change it to compute a CSP and pass it for HTML files:

```js
  if (parsed.hostname === APP_RENDERER_HOST) {
    const filePath = resolveFileUnderRoot(path.join(__dirname, "..", "dist"), parsed.pathname);
    if (!filePath) return plainTextResponse(404, "Not found");
    const loopback = studioPdfConnectSrc();
    // SYNC: Keep these directives in sync with the fallback <meta> CSP in
    // index.html. If you add a directive here, update the meta tag too.
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: opennotion-app: blob:",
      "media-src 'self' opennotion-app: blob:",
      loopback ? `connect-src 'self' ${loopback}` : "connect-src 'self'",
      "worker-src 'self' blob:",
    ].join("; ");
    return await fileResponse(filePath, filePath.endsWith(".html") ? csp : undefined);
  }
```

And update `fileResponse` to accept and set the header:

```js
async function fileResponse(filePath, contentSecurityPolicy) {
  const response = await net.fetch(pathToFileURL(filePath).toString());
  if (!contentSecurityPolicy) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
```

- [ ] **Step 3: Verify syntax**

Run: `node -c electron/main.cjs`
Expected: no output (syntax OK).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Smoke-test the packaged CSP with a Studio PDF**

Run a packaged build and open a Studio document:
```bash
npm run electron:package:dir
npm run electron:smoke
```
Expected: smoke passes. Then **manually** launch the packaged app (`dist-electron/mac-arm64/Shelf.app`), import a PDF into Studio, and confirm the PDF renders. (Automated coverage for the CSP+PDF path is limited; this manual check is the spec-mandated L3 verification.)

- [ ] **Step 6: Commit**

```bash
git add index.html electron/main.cjs
git commit -m "fix(security): scope CSP connect-src to the bound Studio PDF port (L3)"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full unit test suite**

Run: `npm test`
Expected: PASS (includes the new L1 and L2 tests).

- [ ] **Step 2: Script tests**

Run: `npm run test:scripts`
Expected: PASS (M1 notarize + verifier tests, plus existing audit test).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success (TypeScript clean, Vite build succeeds; index.html/main.cjs CSP changes compile).

- [ ] **Step 4: Electron smoke**

Run: `npm run electron:smoke`
Expected: PASS (DB permissions change in L2 did not break backend; L3 CSP did not break load).

- [ ] **Step 5: Manual L3 PDF check**

Open a Studio PDF document in the packaged app and confirm it renders.

- [ ] **Step 6: Audit (unchanged gate)**

Run: `npm audit --audit-level=moderate`
Expected: 0 vulnerabilities (unchanged).

---

## Self-review notes (for the executor)

- **Spec coverage:** M1 → Tasks 1.1–1.7. L2 → Task 2. L1 → Task 3. M2 → Task 4. L3 → Task 5. Final gate → Task 6. All spec sections covered.
- **Type/name consistency:** `notarizeApp({ appPath, dmgPath })` defined in 1.2 and used in 1.3 with the same signature. `verifyFileAgainstHash` / `findHashInSums` defined in 1.5 and tested in 1.4 with matching names. `restrictDatabaseFilePermissions(dbPath)` defined in 2.2 and exported. `studioPdfPort` introduced in 5.2 and used consistently.
- **No placeholders.** Every code step contains the actual code.
