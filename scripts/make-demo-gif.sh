#!/usr/bin/env bash
# scripts/make-demo-gif.sh
#
# Produces docs/assets/shelf-demo.gif — a 10-15s loop of the Studio workflow
# (import PDF -> page through -> write linked note) for use in the README and
# on the landing page.
#
# Usage:
#   1. Open Shelf, switch to Studio, open a PDF with a linked note.
#   2. Start a screen recording of the Studio region (QuickTime -> File -> New Screen Recording),
#      then perform: scroll/paginate the PDF a couple of times, click into the note, type a
#      short line, scroll back to the PDF. Aim for ~15-20s of footage.
#   3. Save the recording as docs/assets/demo-source.mov (default input; override with $1).
#   4. Run this script. It needs ffmpeg (brew install ffmpeg).
#
# Output: docs/assets/shelf-demo.gif
set -euo pipefail

INPUT="${1:-docs/assets/demo-source.mov}"
OUTPUT="docs/assets/shelf-demo.gif"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install with: brew install ffmpeg" >&2
  exit 1
fi
if [[ ! -f "$INPUT" ]]; then
  echo "Input recording not found: $INPUT" >&2
  echo "Record Studio for ~15-20s and save it there, then re-run." >&2
  exit 1
fi

mkdir -p docs/assets

# Two-pass GIF: generate a palette first for clean colors, then quantize.
PALETTE="$(mktemp -t shelf_palette).png"
trap 'rm -f "$PALETTE"' EXIT

# Downscale to width 900, 15 fps, take up to the first 15s.
FILTER_COMMON="fps=15,scale=900:-1:flags=lanczos"
FILTER_PALETTE="$FILTER_COMMON,palettegen=stats_mode=diff"
FILTER_GIF="$FILTER_COMMON[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"

echo "Generating palette..."
ffmpeg -y -i "$INPUT" -t 15 -vf "$FILTER_PALETTE" "$PALETTE" -loglevel error

echo "Encoding GIF -> $OUTPUT"
ffmpeg -y -i "$INPUT" -t 15 -i "$PALETTE" \
  -lavfi "$FILTER_GIF" \
  "$OUTPUT" -loglevel error

echo "Done."
ls -lh "$OUTPUT"
