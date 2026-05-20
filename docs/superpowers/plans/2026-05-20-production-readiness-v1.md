# Production Readiness V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OpenNotion from local beta toward production-grade desktop release by adding automated gates, release verification, data-safety hardening, and user-safe failure handling.

**Architecture:** Keep the existing Tauri + React + SQLite architecture. Add production guardrails around it: GitHub CI, macOS package verification scripts, transactional import behavior, safer runtime error UI, and documented release gates. Signing and notarization require external Apple Developer credentials, so this plan adds deterministic verification and documents the required secrets without pretending local code can create them.

**Tech Stack:** Tauri 2, React 19, TypeScript, Vite, Vitest, Rust, sqlx SQLite, GitHub Actions, macOS codesign/spctl.

---

## File Structure

- Create `.github/workflows/ci.yml`
  - PR and main branch gate for frontend build/tests/audit, Rust fmt/clippy/tests, and unsigned Tauri bundle build on macOS.
- Create `scripts/verify-macos-release.sh`
  - Local release gate that rejects ad-hoc signed bundles, missing Team ID, invalid signatures, and failed Gatekeeper assessment.
- Create `docs/release/macos.md`
  - Human release checklist for Apple Developer ID signing, notarization, stapling, and verification.
- Modify `package.json`
  - Add `release:verify:macos` script for the macOS gate.
- Modify `src-tauri/src/lib.rs`
  - Make backup imports transactional and add regression test for rollback on duplicate IDs.
- Modify `src/components/ErrorBoundary.tsx`
  - Hide raw stack traces from production UI while keeping developer diagnostics in dev builds.

## Task 1: CI Gate

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add GitHub Actions workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: Build, test, audit
    runs-on: macos-14
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - name: Cache Rust build
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target

      - name: Install dependencies
        run: npm ci

      - name: Frontend build
        run: npm run build

      - name: Frontend tests
        run: npm run test

      - name: Dependency audit
        run: npm audit --audit-level=moderate

      - name: Rust format
        run: cargo fmt --check --manifest-path src-tauri/Cargo.toml

      - name: Rust clippy
        run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

      - name: Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml

      - name: Build Tauri bundle
        run: npm run tauri build
```

- [ ] **Step 2: Run local equivalent**

Run:

```bash
npm run check
```

Expected: build passes, Vitest passes, npm audit has 0 moderate+ issues, Rust fmt/clippy/test pass.

## Task 2: macOS Release Verification

**Files:**
- Create: `scripts/verify-macos-release.sh`
- Create: `docs/release/macos.md`
- Modify: `package.json`

- [ ] **Step 1: Add verification script**

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-src-tauri/target/release/bundle/macos/OpenNotion.app}"
DMG_PATH="${2:-src-tauri/target/release/bundle/dmg/OpenNotion_0.1.0_aarch64.dmg}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing app bundle: $APP_PATH" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

SIGNING_INFO="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)"
echo "$SIGNING_INFO"

if echo "$SIGNING_INFO" | grep -q "Signature=adhoc"; then
  echo "Release gate failed: app is ad-hoc signed." >&2
  exit 1
fi

if echo "$SIGNING_INFO" | grep -q "TeamIdentifier=not set"; then
  echo "Release gate failed: app has no TeamIdentifier." >&2
  exit 1
fi

spctl --assess --type execute --verbose=4 "$APP_PATH"

if [[ -f "$DMG_PATH" ]]; then
  spctl --assess --type open --verbose=4 "$DMG_PATH"
else
  echo "DMG not found, skipping DMG assessment: $DMG_PATH" >&2
fi
```

- [ ] **Step 2: Add package script**

```json
"release:verify:macos": "scripts/verify-macos-release.sh"
```

- [ ] **Step 3: Add release checklist**

Document these exact gates:

```bash
npm ci
npm run check
npm run tauri build
npm run release:verify:macos
```

Document required external inputs:

```text
Apple Developer ID Application certificate
Apple Developer ID Installer certificate if packaging installer formats
notarytool keychain profile or App Store Connect API credentials
Tauri signing/notarization configuration
```

## Task 3: Transactional Backup Import

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust regression test**

Add test after `import_page_records_inserts_pages`:

```rust
#[test]
fn import_page_records_rolls_back_when_any_page_fails() {
    tauri::async_runtime::block_on(async {
        let db = test_db().await;
        create_page_record(
            &db,
            "duplicate",
            "Existing",
            None,
            "2026-05-18T00:00:00.000Z",
        )
        .await
        .expect("create existing page");

        let pages = vec![
            ImportedPage {
                id: "new-good".to_string(),
                title: "New Good".to_string(),
                parent_id: None,
                content: None,
                search_text: None,
                icon: None,
                cover_url: None,
                is_deleted: 0,
                is_favorite: 0,
                is_template: Some(0),
                is_database: Some(0),
                database_schema: None,
                properties: None,
                sort_order: Some(0),
                created_at: "2026-05-18T00:01:00.000Z".to_string(),
                updated_at: "2026-05-18T00:01:00.000Z".to_string(),
            },
            ImportedPage {
                id: "duplicate".to_string(),
                title: "Duplicate".to_string(),
                parent_id: None,
                content: None,
                search_text: None,
                icon: None,
                cover_url: None,
                is_deleted: 0,
                is_favorite: 0,
                is_template: Some(0),
                is_database: Some(0),
                database_schema: None,
                properties: None,
                sort_order: Some(1),
                created_at: "2026-05-18T00:02:00.000Z".to_string(),
                updated_at: "2026-05-18T00:02:00.000Z".to_string(),
            },
        ];

        import_page_records(&db, &pages)
            .await
            .expect_err("duplicate id aborts import");

        assert!(get_page_record(&db, "new-good")
            .await
            .expect("fetch new page")
            .is_none());
    });
}
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml import_page_records_rolls_back_when_any_page_fails
```

Expected before implementation: FAIL because `new-good` remains inserted after duplicate ID error.

- [ ] **Step 3: Wrap import in transaction**

Change `import_page_records` to begin a transaction, execute every insert against it, and commit only after all inserts succeed.

- [ ] **Step 4: Run focused and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml import_page_records_rolls_back_when_any_page_fails
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both pass.

## Task 4: Production Error Boundary

**Files:**
- Modify: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Hide stack traces outside dev**

Use:

```ts
const isDev = import.meta.env.DEV;
```

Production UI should show:

```text
Something went wrong.
OpenNotion hit an unexpected error. Your local data is still stored on this device.
```

Development UI may still show error message and stack.

- [ ] **Step 2: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: build passes.

## Task 5: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run complete local gate**

Run:

```bash
npm run check
npm run tauri build
npm run release:verify:macos
```

Expected:
- `npm run check`: pass.
- `npm run tauri build`: pass.
- `npm run release:verify:macos`: fail until real Developer ID signing/notarization is configured. Failure must explicitly say ad-hoc signing or missing TeamIdentifier, not crash with missing file.

- [ ] **Step 2: Optional CodeRabbit review**

Run:

```bash
coderabbit review --agent -t uncommitted
```

Expected: CodeRabbit returns issues or 0 issues. If CLI/auth missing, report exact blocker.

## Acceptance Gates

- CI workflow exists and mirrors local production checks.
- macOS release verification rejects current unsigned/ad-hoc artifact.
- Backup import is all-or-nothing.
- Production ErrorBoundary does not show raw stack traces.
- `npm run check` passes locally.
- Remaining production blockers are explicit external release credentials, deeper E2E tests, updater, and final manual QA.
