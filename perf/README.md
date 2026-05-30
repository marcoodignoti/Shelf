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
| Disk (cold insert) | 5,000 empty pages, main .db after checkpoint | <= 1.2 MB | `perf_tests.rs` `DISK_BUDGET_BYTES`              |
| Throughput         | insert 5,000 pages                   | <= 2,200 ms     | `perf_tests.rs` `INSERT_BUDGET_MS`               |
| Long-session DB    | 2,000 content-update cycles + VACUUM | <= 640 KB       | `perf_tests.rs` `CHURN_DISK_BUDGET_BYTES`        |
| Startup            | dev server "/" to first render       | <= 1,000 ms     | `perf.perf.e2e.ts` `STARTUP_BUDGET_MS`           |
| Frontend leak      | heap delta over 200 edit cycles      | <= 7 MB         | `perf.perf.e2e.ts` `HEAP_DELTA_BUDGET_BYTES`     |
| Native RSS         | built binary peak resident set       | document only   | `profile-macos.sh` `RSS_BUDGET_MB`               |
| Native startup     | launch to window visible             | document only   | manual runbook                                   |
| PDF import         | import a ~50 MB PDF in-app           | document only   | manual runbook                                   |

## Baselines

| Date | Machine | Disk cold | Insert ms | Churn disk | Startup ms | Heap delta | Native RSS | PDF import |
|------|---------|-----------|-----------|------------|------------|------------|------------|------------|
| 2026-05-30 | macOS (Darwin 25.5.0, M-series) | 892928 bytes (~872 KB) | 1655 ms | 471040 bytes (~460 KB) | 428 ms | 4752888 bytes (~4.5 MB) | _pending_ | _pending_ |

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
