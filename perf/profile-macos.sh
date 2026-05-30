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
