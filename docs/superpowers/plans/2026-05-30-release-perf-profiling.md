# Release Perf Profiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable performance-profiling harness that measures OpenNotion against explicit budgets across the five pre-distribution dimensions the README calls out — memory, disk use, startup time, PDF import behavior, and long-session stability — on macOS and Windows.

**Architecture:** Three measurement surfaces, none of which block the main `npm run check` gate (perf numbers are environment-sensitive and would make CI flaky). (1) **Backend** — `#[ignore]`-gated Rust tests inside the crate that drive a *file-backed* SQLite pool (so disk growth is real, unlike the in-memory test pool) and assert timing + on-disk size against budget constants. (2) **Frontend** — a Playwright spec that reuses the existing `window.__TAURI_INTERNALS__` localStorage mock to measure dev-server startup-to-interactive and JS-heap growth under editing churn (a leak guard; React + BlockNote render for real, only persistence is mocked). (3) **Native shell** — a macOS shell script that launches the *built release binary* under `/usr/bin/time -l` to capture peak RSS and startup wall time, plus a manual runbook for PDF import and long-session soak and for the Windows equivalents. A single `perf/README.md` is the canonical budget table; an `npm run perf` script runs the automatable subset.

**Tech Stack:** Rust + `sqlx` (SQLite, already a dep) + `std::time::Instant` (no new crates); Playwright + Chrome DevTools Protocol (`Performance.getMetrics`, `HeapProfiler.collectGarbage`); macOS `/usr/bin/time -l`; Node script wiring via `package.json`.

---

## Design decisions (read before starting)

- **Perf is baseline-then-tighten, not red-green.** Unlike feature TDD, the first run of a perf check establishes the real number on the target machine. The workflow per metric is: (a) write the harness with a deliberately loose budget constant, (b) run it and read the printed metric, (c) set the budget to roughly the measured value × 1.3 (≈30% headroom), (d) commit. The "expected" outputs below are placeholders — **record the real first-run number in `perf/README.md` and use it to set the constant.** Steps say this explicitly where it applies.
- **No new Rust dependencies.** We do not add `criterion` or `tempfile`. Plain `#[test]` functions with `std::time::Instant` and a hand-rolled temp-dir helper keep `cargo clippy -- -D warnings` (part of the gate) happy and avoid dependency-audit surface.
- **Perf tests must not run in the default gate.** Backend perf tests carry `#[ignore]` so `cargo test` (inside `npm run check`) skips them; they run only via `cargo test -- --ignored` (wrapped by `npm run perf:backend`). The Playwright perf spec lives in `tests/e2e/` but is excluded from the default `npm run e2e` run via a `testIgnore` entry, and runs via `npm run perf:frontend`.
- **WAL note.** The app runs SQLite in WAL mode (`configure_sqlite_database`). Pages written in WAL mode live in the `-wal` sidecar until a checkpoint, so measuring the main `.db` file size before checkpointing under-reports. Every disk measurement runs `PRAGMA wal_checkpoint(TRUNCATE)` first.
- **Single subsystem.** This is one coherent subsystem (a perf harness). It does not need splitting into sub-plans.

## File structure

- Create: `perf/README.md` — canonical budget table, how to run each surface, where to record baselines.
- Create: `perf/profile-macos.sh` — launches the built release binary under `/usr/bin/time -l`, parses peak RSS + wall time, prints a pass/fail vs the documented budget.
- Create: `src-tauri/src/perf_tests.rs` — `#[cfg(test)]` child module; file-backed-pool perf tests. Reaches crate-private helpers (`run_migrations`, `configure_sqlite_database`, `create_page_record`, `update_page_content`) via `use crate::...` (child modules can access ancestor-private items).
- Modify: `src-tauri/src/lib.rs` — add the single line `#[cfg(test)] mod perf_tests;` near the existing `#[cfg(test)] mod tests` declaration.
- Create: `tests/e2e/perf.e2e.ts` — Playwright startup + heap-leak spec.
- Modify: `playwright.config.ts` — add `testIgnore` so `*.perf.e2e.ts` is excluded from the default run; the perf spec is named `perf.perf.e2e.ts`... (see Task 4 — we use a distinct suffix `*.perf.e2e.ts`).
- Modify: `package.json` — add `perf`, `perf:backend`, `perf:frontend`, `perf:native` scripts.

---

### Task 1: Perf directory + canonical budget table

**Files:**
- Create: `perf/README.md`

- [ ] **Step 1: Write the budget table and run instructions**

Create `perf/README.md`:

```markdown
# OpenNotion performance harness

Pre-distribution perf gate for the five dimensions in the root README:
memory, disk use, startup time, PDF import, long-session stability.

These checks are **not** part of `npm run check` — perf numbers are
machine-sensitive and would make the gate flaky. Run them deliberately
before tagging a release, on a quiet machine, on both macOS and Windows.

## Run

```sh
npm run perf            # automatable subset: backend + frontend
npm run perf:backend    # Rust file-backed-pool timing + disk-size tests
npm run perf:frontend   # Playwright startup + JS-heap leak guard
npm run perf:native     # macOS only: built-binary peak RSS + startup wall time
```

`npm run perf:native` requires a release build first: `npm run tauri build`.

## Budgets

Set each budget from the FIRST measured value on the reference machine
(measured × ~1.3 for headroom), then keep it stable across releases.
Record the machine in the baseline table below.

| Dimension          | Check                                | Budget          | Source constant                                  |
|--------------------|--------------------------------------|-----------------|--------------------------------------------------|
| Disk (cold insert) | 5,000 empty pages, main .db after checkpoint | <= 8 MB   | `perf_tests.rs` `DISK_BUDGET_BYTES`              |
| Throughput         | insert 5,000 pages                   | <= 5,000 ms     | `perf_tests.rs` `INSERT_BUDGET_MS`               |
| Long-session DB    | 2,000 content-update cycles + VACUUM | <= 12 MB        | `perf_tests.rs` `CHURN_DISK_BUDGET_BYTES`        |
| Startup            | dev server "/" to first render       | <= 3,000 ms     | `perf.perf.e2e.ts` `STARTUP_BUDGET_MS`           |
| Frontend leak      | heap delta over 200 edit cycles      | <= 15 MB        | `perf.perf.e2e.ts` `HEAP_DELTA_BUDGET_BYTES`     |
| Native RSS         | built binary peak resident set       | document only   | `profile-macos.sh` `RSS_BUDGET_MB`               |
| Native startup     | launch to window visible             | document only   | manual runbook                                   |
| PDF import         | import a ~50 MB PDF in-app           | document only   | manual runbook                                   |

## Baselines

| Date | Machine | Disk cold | Insert ms | Churn disk | Startup ms | Heap delta | Native RSS | PDF import |
|------|---------|-----------|-----------|------------|------------|------------|------------|------------|
| _fill on first run_ | | | | | | | | |

## Manual runbook (native shell + PDF import + soak)

PDF import and the full native shell cannot be exercised by the browser
mock or the in-process Rust tests — run these by hand in the built app:

1. **PDF import** — `npm run tauri build`, open the app, Studio mode, import a
   ~50 MB PDF. Time from file-picker confirmation to first page rendered.
   Watch peak RSS in Activity Monitor (macOS) / Task Manager (Windows).
   Record in Baselines. Repeat with a 5-page PDF as a fast-path reference.
2. **Long-session soak** — leave the app open with a Studio document for
   2+ hours, scrolling/editing periodically. Record RSS at start, 1h, 2h.
   A steadily climbing RSS that never plateaus indicates a leak.
3. **Native startup** — cold launch (after reboot or `killall` + first run)
   and warm launch; time to interactive window. On macOS see
   `profile-macos.sh`. On Windows, use `Measure-Command { Start-Process ... }`
   around the built `.exe` and read peak working set in Task Manager.
```

- [ ] **Step 2: Verify the file renders**

Run: `cat perf/README.md | head -20`
Expected: the title and intro print without error.

- [ ] **Step 3: Commit**

```bash
git add perf/README.md
git commit -m "perf: add canonical budget table and runbook"
```

---

### Task 2: Backend cold-insert throughput + disk-size test

**Files:**
- Create: `src-tauri/src/perf_tests.rs`
- Modify: `src-tauri/src/lib.rs` (add module declaration)

- [ ] **Step 1: Declare the module in lib.rs**

In `src-tauri/src/lib.rs`, immediately after the existing line `#[cfg(test)]\nmod tests {` block's declaration region — specifically just before `#[cfg(test)]\nmod tests {` (around line 2088) — add:

```rust
#[cfg(test)]
mod perf_tests;
```

(Place it on its own two lines above the `mod tests {` opening. It must be a sibling module declaration, not nested inside `mod tests`.)

- [ ] **Step 2: Write the file-backed-pool helper and the cold-insert test**

Create `src-tauri/src/perf_tests.rs`:

```rust
//! Performance budget tests. Ignored by default (`cargo test` in the gate
//! skips them); run with `cargo test -- --ignored` via `npm run perf:backend`.
//! Budgets are set from the first measured value on the reference machine
//! (see perf/README.md). Adjust the constants below after baselining.

use crate::{configure_sqlite_database, create_page_record, run_migrations, update_page_content};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::time::Instant;

const INSERT_COUNT: usize = 5_000;
const INSERT_BUDGET_MS: u128 = 5_000;
const DISK_BUDGET_BYTES: u64 = 8 * 1024 * 1024;

/// Unique temp file path for one perf run. Plain std, no `tempfile` dep.
fn temp_db_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!("opennotion-perf-{tag}-{nanos}.db"))
}

/// File-backed pool configured exactly like production (WAL + NORMAL).
async fn file_backed_pool(path: &PathBuf) -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let db = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("connect file-backed sqlite");
    run_migrations(&db).await.expect("run migrations");
    configure_sqlite_database(&db).await.expect("configure sqlite");
    db
}

/// Checkpoint WAL into the main file, then return main-file size in bytes.
async fn checkpointed_db_size(db: &SqlitePool, path: &PathBuf) -> u64 {
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(db)
        .await
        .expect("wal checkpoint");
    std::fs::metadata(path).expect("stat db file").len()
}

fn cleanup(path: &PathBuf) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
}

#[ignore = "perf budget test; run via npm run perf:backend"]
#[test]
fn cold_insert_throughput_and_disk_size() {
    // Matches the existing `mod tests` pattern in lib.rs: plain `#[test]`
    // driving an async body via tauri's runtime. There is NO `tokio` dev-dep,
    // so `#[tokio::test]` would not compile — do not use it.
    tauri::async_runtime::block_on(async {
        let path = temp_db_path("cold-insert");
        let db = file_backed_pool(&path).await;

        let start = Instant::now();
        for i in 0..INSERT_COUNT {
            let id = format!("perf-{i}");
            let title = format!("Perf page {i}");
            create_page_record(&db, &id, &title, None, "2026-01-01T00:00:00Z")
                .await
                .expect("insert page");
        }
        let elapsed_ms = start.elapsed().as_millis();

        let size_bytes = checkpointed_db_size(&db, &path).await;
        db.close().await;
        cleanup(&path);

        println!(
            "PERF cold-insert: {INSERT_COUNT} pages in {elapsed_ms} ms, db {size_bytes} bytes"
        );
        assert!(
            elapsed_ms <= INSERT_BUDGET_MS,
            "insert took {elapsed_ms} ms, budget {INSERT_BUDGET_MS} ms"
        );
        assert!(
            size_bytes <= DISK_BUDGET_BYTES,
            "db size {size_bytes} bytes, budget {DISK_BUDGET_BYTES} bytes"
        );
    });
}
```

Note: this mirrors the verified style at `src-tauri/src/lib.rs:2114+` — `#[test]` + `tauri::async_runtime::block_on(async { ... })`. The async helpers (`file_backed_pool`, `checkpointed_db_size`) stay `async fn` and are `.await`ed inside the block.

- [ ] **Step 3: Run the test to capture the baseline**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored cold_insert_throughput_and_disk_size --nocapture`
Expected: prints `PERF cold-insert: 5000 pages in <N> ms, db <M> bytes` and PASSES (budgets are loose). **Record `<N>` and `<M>` in `perf/README.md` Baselines.**

- [ ] **Step 4: Set the budgets from the baseline**

If the measured ms or bytes is within 30% of the constants, leave them. If the real number is far lower, tighten the constant to `measured × 1.3` (rounded) so the test catches future regressions. Edit `INSERT_BUDGET_MS` / `DISK_BUDGET_BYTES` accordingly.

- [ ] **Step 5: Confirm the gate still skips it**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cold_insert 2>&1 | tail -5`
Expected: shows `0 passed` / the test listed as ignored (the default run does NOT execute it).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/perf_tests.rs src-tauri/src/lib.rs perf/README.md
git commit -m "perf: backend cold-insert throughput and disk-size budget test"
```

---

### Task 3: Backend long-session write-churn + VACUUM disk test

**Files:**
- Modify: `src-tauri/src/perf_tests.rs`

- [ ] **Step 1: Add the churn constants and test**

Append to `src-tauri/src/perf_tests.rs`:

```rust
const CHURN_PAGES: usize = 50;
const CHURN_CYCLES: usize = 2_000;
const CHURN_DISK_BUDGET_BYTES: u64 = 12 * 1024 * 1024;

/// Simulates a long editing session: a small working set of pages whose
/// content is rewritten thousands of times. Without VACUUM, repeated
/// UPDATEs of large TEXT bloat the file via free pages; this asserts that
/// after a VACUUM the file stays bounded (long-session disk stability).
#[ignore = "perf budget test; run via npm run perf:backend"]
#[test]
fn long_session_churn_disk_stays_bounded() {
    tauri::async_runtime::block_on(async {
        let path = temp_db_path("churn");
        let db = file_backed_pool(&path).await;

        // A realistic-ish block-content payload (~4 KB) rewritten repeatedly.
        let body = "x".repeat(4_000);

        for i in 0..CHURN_PAGES {
            let id = format!("churn-{i}");
            create_page_record(&db, &id, "Churn page", None, "2026-01-01T00:00:00Z")
                .await
                .expect("seed page");
        }

        for cycle in 0..CHURN_CYCLES {
            let id = format!("churn-{}", cycle % CHURN_PAGES);
            let content = format!("{{\"v\":{cycle},\"body\":\"{body}\"}}");
            update_page_content(&db, &id, &content, &body, "2026-01-01T00:00:01Z")
                .await
                .expect("update content");
        }

        sqlx::query("VACUUM").execute(&db).await.expect("vacuum");
        let size_bytes = checkpointed_db_size(&db, &path).await;
        db.close().await;
        cleanup(&path);

        println!("PERF churn: {CHURN_CYCLES} updates, post-vacuum db {size_bytes} bytes");
        assert!(
            size_bytes <= CHURN_DISK_BUDGET_BYTES,
            "post-churn db {size_bytes} bytes, budget {CHURN_DISK_BUDGET_BYTES} bytes"
        );
    });
}
```

- [ ] **Step 2: Run to capture the baseline**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored long_session_churn_disk_stays_bounded --nocapture`
Expected: prints `PERF churn: 2000 updates, post-vacuum db <M> bytes` and PASSES. **Record `<M>` in `perf/README.md`.**

- [ ] **Step 3: Set the budget from the baseline**

Adjust `CHURN_DISK_BUDGET_BYTES` to `measured × 1.3` if the real number is far below 12 MB.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/perf_tests.rs perf/README.md
git commit -m "perf: long-session write-churn disk-stability budget test"
```

---

### Task 4: Frontend startup + JS-heap leak guard (Playwright)

**Files:**
- Create: `tests/e2e/perf.perf.e2e.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Exclude the perf suffix from the default e2e run**

In `playwright.config.ts`, inside the top-level `defineConfig({ ... })` object, add a `testIgnore` line next to `testMatch`:

```ts
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: "**/*.perf.e2e.ts",
```

This keeps `npm run e2e` (and the `npm run check` gate) from running the perf spec, while still allowing a targeted `npx playwright test tests/e2e/perf.perf.e2e.ts`.

- [ ] **Step 2: Write the perf spec using the existing localStorage Tauri mock**

Create `tests/e2e/perf.perf.e2e.ts`:

```ts
import { expect, test } from "@playwright/test";

// Budgets — set from the first measured run on the reference machine
// (measured * ~1.3). Record values in perf/README.md.
const STARTUP_BUDGET_MS = 3_000;
const HEAP_DELTA_BUDGET_BYTES = 15 * 1024 * 1024;
const EDIT_CYCLES = 200;

// Minimal Tauri IPC mock mirroring tests/e2e/persistence.e2e.ts: persistence
// is backed by localStorage so React + BlockNote render for real while the
// native backend is absent. This measures FRONTEND cost only.
async function installTauriMock(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const storageKey = "opennotion-perf-pages";
    type MockPage = Record<string, unknown> & { id: string };
    const load = (): MockPage[] =>
      JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    const save = (pages: MockPage[]) =>
      window.localStorage.setItem(storageKey, JSON.stringify(pages));
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem("opennotion-current-page-id");

    // @ts-expect-error injected global
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => cb,
      invoke: async (cmd: string, args: Record<string, any> = {}) => {
        const now = new Date().toISOString();
        if (cmd === "list_pages") return load();
        if (cmd === "create_page") {
          const page: MockPage = {
            id: args.id ?? `p-${Date.now()}-${Math.random()}`,
            title: args.title ?? "",
            parent_id: args.parentId ?? null,
            content: null,
            search_text: null,
            icon: null,
            cover_url: null,
            is_deleted: 0,
            is_favorite: 0,
            is_template: 0,
            is_database: 0,
            database_schema: null,
            properties: null,
            sort_order: 0,
            page_kind: "note",
            created_at: now,
            updated_at: now,
          };
          save([...load(), page]);
          return page;
        }
        if (cmd === "update_page") {
          const pages = load().map((p) =>
            p.id === args.id ? { ...p, ...args.updates, updated_at: now } : p,
          );
          save(pages);
          return null;
        }
        // Permissive default so unmodeled commands don't reject and skew timing.
        return null;
      },
    };
  });
}

async function jsHeapUsedBytes(
  page: import("@playwright/test").Page,
  client: import("@playwright/test").CDPSession,
): Promise<number> {
  // Force GC so the delta reflects retained (leaked) memory, not garbage.
  await client.send("HeapProfiler.collectGarbage");
  const { metrics } = await client.send("Performance.getMetrics");
  const heap = metrics.find((m) => m.name === "JSHeapUsedSize");
  return heap?.value ?? 0;
}

test("startup to first interactive render is within budget", async ({ page }) => {
  await installTauriMock(page);
  const start = Date.now();
  await page.goto("/");
  await page.getByText("Create first page").waitFor({ state: "visible" });
  const elapsed = Date.now() - start;
  console.log(`PERF startup: ${elapsed} ms`);
  expect(elapsed).toBeLessThanOrEqual(STARTUP_BUDGET_MS);
});

test("editing churn does not leak JS heap", async ({ page }) => {
  await installTauriMock(page);
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");

  await page.goto("/");
  await page.getByText("Create first page").click();
  const titleInput = page.locator("textarea[placeholder='Untitled']");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("Heap churn");
  await titleInput.press("Enter");
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeFocused();

  const before = await jsHeapUsedBytes(page, client);
  for (let i = 0; i < EDIT_CYCLES; i++) {
    await editor.pressSequentially(`line ${i} `, { delay: 0 });
    await editor.press("Enter");
  }
  const after = await jsHeapUsedBytes(page, client);

  const delta = after - before;
  console.log(`PERF heap delta: ${delta} bytes over ${EDIT_CYCLES} cycles`);
  expect(delta).toBeLessThanOrEqual(HEAP_DELTA_BUDGET_BYTES);
});
```

- [ ] **Step 3: Run the perf spec to capture the baseline**

Run: `npx playwright test tests/e2e/perf.perf.e2e.ts --reporter=list`
Expected: both tests PASS; the run logs `PERF startup: <N> ms` and `PERF heap delta: <M> bytes`. **Record `<N>` and `<M>` in `perf/README.md`.** (The `Create first page` CTA is confirmed at `src/components/Sidebar.tsx:1076` and is the same selector the passing `persistence.e2e.ts` uses.)

- [ ] **Step 4: Set budgets from the baseline**

Adjust `STARTUP_BUDGET_MS` and `HEAP_DELTA_BUDGET_BYTES` to `measured × 1.3`. Startup on a loaded CI box is noisy — leave generous headroom or keep this spec local-only.

- [ ] **Step 5: Confirm the default e2e run still ignores it**

Run: `npx playwright test --list 2>&1 | grep -c "perf.perf.e2e.ts"`
Expected: `0` (the perf spec is excluded by `testIgnore`).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/perf.perf.e2e.ts playwright.config.ts perf/README.md
git commit -m "perf: frontend startup and JS-heap leak-guard spec"
```

---

### Task 5: Native release-binary RSS + startup script (macOS)

**Files:**
- Create: `perf/profile-macos.sh`

- [ ] **Step 1: Write the profiling script**

Create `perf/profile-macos.sh`:

```bash
#!/usr/bin/env bash
# Measure peak resident set size (RSS) and startup wall time of the built
# release binary. macOS only (uses /usr/bin/time -l). Run after a release
# build: `npm run tauri build`. The binary is launched, held for a few
# seconds so it reaches steady state, then terminated.
set -euo pipefail

RSS_BUDGET_MB="${RSS_BUDGET_MB:-400}"   # documented budget; tune after baseline
HOLD_SECONDS="${HOLD_SECONDS:-8}"

BIN="$(find src-tauri/target/release/bundle/macos -maxdepth 3 -name 'OpenNotion' -type f 2>/dev/null | head -1)"
if [ -z "${BIN}" ]; then
  BIN="$(find src-tauri/target/release -maxdepth 1 -name 'opennotion' -type f 2>/dev/null | head -1)"
fi
if [ -z "${BIN}" ]; then
  echo "ERROR: no release binary found. Run 'npm run tauri build' first." >&2
  exit 1
fi
echo "Profiling: ${BIN}"

TIME_LOG="$(mktemp)"
START_NS="$(python3 -c 'import time; print(time.time_ns())')"

# Launch under time -l; kill after HOLD_SECONDS so the run terminates.
( /usr/bin/time -l "${BIN}" >/dev/null 2>"${TIME_LOG}" ) &
TIME_PID=$!
sleep "${HOLD_SECONDS}"
# Kill the app (and the time wrapper) so -l flushes its report.
pkill -f "${BIN}" 2>/dev/null || true
wait "${TIME_PID}" 2>/dev/null || true

END_NS="$(python3 -c 'import time; print(time.time_ns())')"
WALL_MS=$(( (END_NS - START_NS) / 1000000 - HOLD_SECONDS * 1000 ))

# `time -l` prints "  <bytes>  maximum resident set size" on macOS.
RSS_BYTES="$(grep 'maximum resident set size' "${TIME_LOG}" | awk '{print $1}')"
rm -f "${TIME_LOG}"
RSS_MB=$(( RSS_BYTES / 1024 / 1024 ))

echo "PERF native: peak RSS ${RSS_MB} MB, approx startup overhead ${WALL_MS} ms"
echo "Record both in perf/README.md Baselines."
if [ "${RSS_MB}" -gt "${RSS_BUDGET_MB}" ]; then
  echo "WARNING: RSS ${RSS_MB} MB exceeds budget ${RSS_BUDGET_MB} MB" >&2
  exit 1
fi
```

- [ ] **Step 2: Make it executable and shellcheck it**

Run: `chmod +x perf/profile-macos.sh && bash -n perf/profile-macos.sh && echo "syntax OK"`
Expected: prints `syntax OK` (no syntax errors). Functional run requires a built binary and is part of the release runbook, not this step.

- [ ] **Step 3: Commit**

```bash
git add perf/profile-macos.sh
git commit -m "perf: macOS release-binary RSS and startup profiling script"
```

---

### Task 6: Wire npm scripts and final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the perf scripts**

In `package.json` `"scripts"`, add (after the existing `"e2e"` entry):

```json
    "perf": "npm run perf:backend && npm run perf:frontend",
    "perf:backend": "cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture",
    "perf:frontend": "playwright test tests/e2e/perf.perf.e2e.ts --reporter=list",
    "perf:native": "bash perf/profile-macos.sh",
```

- [ ] **Step 2: Run the automatable perf subset end to end**

Run: `npm run perf`
Expected: backend prints `PERF cold-insert: ...` and `PERF churn: ...`, frontend prints `PERF startup: ...` and `PERF heap delta: ...`, and all assertions PASS with the budgets set from baselines.

- [ ] **Step 3: Verify the main gate is unchanged (perf excluded)**

Run: `npm run build && npm run test && npm run e2e 2>&1 | tail -15`
Expected: builds, unit tests pass, e2e passes, and the perf spec is NOT in the e2e run (no `perf.perf.e2e.ts` line). Confirms perf checks never block the release gate.

- [ ] **Step 4: Record all baselines in perf/README.md**

Fill the Baselines table row with the machine name (e.g. "M-series mac, 2026-05-30") and every measured value captured in Tasks 2–4. This row is the regression reference for future releases.

- [ ] **Step 5: Commit**

```bash
git add package.json perf/README.md
git commit -m "perf: wire perf npm scripts and record reference baselines"
```

---

## Self-review

**Spec coverage** (five README dimensions):
- **Memory** — frontend JS-heap leak guard (Task 4) + native peak RSS (Task 5) + manual soak (Task 1 runbook). ✓
- **Disk use** — cold-insert size + churn/VACUUM size (Tasks 2–3). ✓
- **Startup time** — frontend startup-to-interactive (Task 4) + native startup overhead (Task 5) + cold/warm runbook (Task 1). ✓
- **PDF import** — manual in-app runbook (Task 1), since import needs the real native file-copy path and a real PDF; not automatable via the browser mock or in-process DB tests. ✓ (documented limitation, not a gap)
- **Long-session stability** — backend churn/VACUUM (Task 3) + frontend heap delta (Task 4) + 2h soak runbook (Task 1). ✓

**Placeholder scan:** Budget *values* are intentionally provisional and every task says to baseline-then-set with the real number — this is correct perf practice, not a placeholder failure. All code steps contain complete, runnable code. Both potential ambiguities were resolved against source before finalizing: the Rust async-test pattern is `#[test]` + `tauri::async_runtime::block_on` (verified at `lib.rs:2114+`; there is no `tokio` dev-dep so `#[tokio::test]` is wrong), and the `Create first page` CTA is confirmed at `Sidebar.tsx:1076`.

**Type/name consistency:** Rust constants (`INSERT_BUDGET_MS`, `DISK_BUDGET_BYTES`, `CHURN_DISK_BUDGET_BYTES`) and helpers (`temp_db_path`, `file_backed_pool`, `checkpointed_db_size`, `cleanup`) are defined in Task 2 and reused unchanged in Task 3. TS budget constants (`STARTUP_BUDGET_MS`, `HEAP_DELTA_BUDGET_BYTES`) are defined and used within Task 4. Crate-private fns referenced (`run_migrations`, `configure_sqlite_database`, `create_page_record`, `update_page_content`) were verified to exist at `src-tauri/src/lib.rs:155/342/351/453` with the signatures used. npm script names (`perf:backend`, `perf:frontend`, `perf:native`) match their definitions and the `perf/README.md` table. Consistent.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-30-release-perf-profiling.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
