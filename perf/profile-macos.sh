#!/usr/bin/env bash
# Measure peak resident set size (RSS) and startup wall time of the built
# Electron binary. macOS only (uses /usr/bin/time -l). Run after packaging:
# `npm run electron:package:dir`. The binary is launched, held for a few
# seconds so it reaches steady state, then terminated.
set -euo pipefail

RSS_BUDGET_MB="${RSS_BUDGET_MB:-400}"   # documented budget; tune after baseline
HOLD_SECONDS="${HOLD_SECONDS:-8}"

BIN="dist-electron/mac-arm64/Shelf.app/Contents/MacOS/Shelf"
if [ -z "${BIN}" ]; then
  echo "ERROR: no Electron binary configured." >&2
  exit 1
fi
if [ ! -x "${BIN}" ]; then
  echo "ERROR: no packaged Electron binary found. Run 'npm run electron:package:dir' first." >&2
  exit 1
fi
echo "Profiling: ${BIN}"

TIME_LOG="$(mktemp)"
# Clean up the temp log on all exit paths (including the early exit 1 below).
trap 'rm -f "${TIME_LOG}"' EXIT
START_NS="$(python3 -c 'import time; print(time.time_ns())')"

# Process-tree note: `( /usr/bin/time -l "$BIN" ) &` — the shell execs directly
# into /usr/bin/time, so TIME_PID IS the /usr/bin/time process.  The app binary
# is its direct child (found via `pgrep -P "${TIME_PID}"`).
# To get the RSS report we must let /usr/bin/time exit naturally after its child
# dies.  We therefore kill the APP (leaf), then wait on the time wrapper so it
# can call getrusage and write the -l report to TIME_LOG.
( /usr/bin/time -l "${BIN}" >/dev/null 2>"${TIME_LOG}" ) &
TIME_PID=$!
sleep "${HOLD_SECONDS}"

# Kill the app binary (direct child of /usr/bin/time) so /usr/bin/time -l can
# collect getrusage stats and write its report to TIME_LOG.  Killing the time
# wrapper itself would prevent the report from being written.
APP_PID="$(pgrep -P "${TIME_PID}" | head -1)"
if [ -n "${APP_PID}" ]; then
  kill "${APP_PID}" 2>/dev/null || true
else
  echo "WARNING: could not find child of time process (PID ${TIME_PID}); app may have exited early" >&2
fi
wait "${TIME_PID}" 2>/dev/null || true

END_NS="$(python3 -c 'import time; print(time.time_ns())')"
WALL_MS=$(( (END_NS - START_NS) / 1000000 - HOLD_SECONDS * 1000 ))

# `time -l` prints "  <bytes>  maximum resident set size" on macOS.
RSS_BYTES="$(grep 'maximum resident set size' "${TIME_LOG}" | awk '{print $1}')" || true
if [ -z "${RSS_BYTES}" ]; then
  echo "ERROR: /usr/bin/time -l RSS report not found in ${TIME_LOG}. Binary may have been killed too quickly, or this is not macOS /usr/bin/time." >&2
  exit 1
fi
RSS_MB=$(( RSS_BYTES / 1024 / 1024 ))

echo "PERF native: peak RSS ${RSS_MB} MB, approx startup overhead ${WALL_MS} ms"
echo "Record both in perf/README.md Baselines."
if [ "${RSS_MB}" -gt "${RSS_BUDGET_MB}" ]; then
  echo "WARNING: RSS ${RSS_MB} MB exceeds budget ${RSS_BUDGET_MB} MB" >&2
  exit 1
fi
