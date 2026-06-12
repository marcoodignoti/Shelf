# Shelf performance harness

Pre-distribution perf gate for the five dimensions in the root README:
memory, disk use, startup time, PDF import, long-session stability.

These checks are **not** part of `npm run check` — perf numbers are
machine-sensitive and would make the gate flaky. Run them deliberately
before tagging a release, on a quiet machine, on both macOS and Windows.

## Run

```sh
npm run perf            # automatable subset: frontend
npm run perf:frontend   # Playwright startup + JS-heap leak guard
npm run perf:native     # macOS only: built-binary peak RSS + startup wall time
```

`npm run perf:native` requires a packaged Electron app first: `npm run electron:package:dir`.

## Budgets

Set each budget from the FIRST measured value on the reference machine
(measured × ~1.3 for headroom), then keep it stable across releases.
Record the machine in the baseline table below.

| Dimension          | Check                                | Budget          | Source constant                                  |
|--------------------|--------------------------------------|-----------------|--------------------------------------------------|
| Startup            | dev server "/" to first render       | <= 700 ms       | `perf.perf.e2e.ts` `STARTUP_BUDGET_MS`           |
| Frontend leak      | heap delta over 200 edit cycles      | <= 7 MB         | `perf.perf.e2e.ts` `HEAP_DELTA_BUDGET_BYTES`     |
| Native RSS         | built binary peak resident set       | document only   | `profile-macos.sh` `RSS_BUDGET_MB`               |
| Native startup     | launch to window visible             | document only   | manual runbook                                   |
| PDF import         | import a ~50 MB PDF in-app           | document only   | manual runbook                                   |

> **Startup timing note:** the `<= 700 ms` startup budget is a coarse
> Playwright-side `Date.now()` measure (includes Playwright IPC overhead,
> navigation, and poll latency) — it is **not** a pure browser
> `navigationStart → DCL` timing. It is used as a manual pre-release signal
> only; it is not part of the CI gate.

## Baselines

| Date | Machine | Disk cold | Insert ms | Churn disk | Startup ms | Heap delta | Native RSS | PDF import |
|------|---------|-----------|-----------|------------|------------|------------|------------|------------|
| 2026-05-30 | macOS (Darwin 25.5.0, M-series) | 892928 bytes (~872 KB) | 1655 ms | 471040 bytes (~460 KB) | 428 ms | 4752888 bytes (~4.5 MB) | _pending_ | _pending_ |

## Manual runbook (native shell + PDF import + soak)

PDF import and long-session soak should be checked by hand in the built app:

1. **PDF import** — `npm run electron:package:dir`, open the app, Studio mode, import a
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
