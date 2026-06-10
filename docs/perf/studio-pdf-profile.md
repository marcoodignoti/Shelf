# Studio PDF profiling notes

Profiling session for issue #49 (large PDF behavior). Reproducible via:

```sh
npx playwright test --config playwright.perf.config.ts pdf-profile
```

## Setup

- Machine: Apple M4, 16 GB RAM, macOS 26.5.1
- App: renderer served by the Vite dev server, headless Chromium
  (Playwright), mocked `window.openNotion` bridge — measures the pdf.js +
  viewer pipeline, not Electron file IO
- Fixtures: synthetic text PDFs, 42 Helvetica lines per page (real text
  layout and glyph rasterization work). Scanned/image-heavy PDFs render
  slower per page than these baselines.
- App version: 0.1.9 + PDF viewer fixes (#63)

## Measurements (2026-06-10)

| Metric | small (10 p, 43 KB) | medium (120 p, 513 KB) | large (800 p, 3.4 MB) |
|---|---|---|---|
| Import → page count known | 863 ms | 847 ms | 853 ms |
| Import → first page rendered | 866 ms | 852 ms | 860 ms |
| Page turn (single mode, avg of 5) | 101 ms | 101 ms | 99 ms |
| Zoom step → re-rendered | 43 ms | 45 ms | 49 ms |
| Live canvas bitmaps after full scroll-through (continuous) | 5/10 | 5/120 | 5/800 |
| JS heap after scroll-through | 33 MB | 40 MB | 40 MB |

## Findings

1. **Open time is size-independent** (~850 ms flat): pdf.js parses lazily
   from the xref, so page count and first render do not scale with page
   count. Most of the ~850 ms is app flow (import action, document state
   round trip), not parsing.
2. **Memory is bounded by design**: off-screen pages release their canvas
   bitmaps (IntersectionObserver release, v0.1.7), so live bitmaps stay at
   ~5 regardless of document length and the JS heap stays flat at ~40 MB.
   Before v0.1.7 this grew ~7–8 MB per page ever scrolled past.
3. **Page navigation does not re-parse the document** since #63 (the
   reload-per-page-change fix); page turns are ~100 ms wall time including
   test-driver round trips, with no blank flash (offscreen blit, #61).
4. **Disk growth** is the imported copy itself: Studio copies the PDF 1:1
   into the app data directory at import (no transcoding), so disk cost
   equals source file size. The importer caps documents at
   `MAX_STUDIO_PDF_PAGES = 1000` pages (`src/lib/studio.ts`).

## Pass/fail thresholds (proposed)

Set from these baselines × ~1.5 headroom; re-measure on the same class of
machine before tightening. The sanity assertion shipped in the spec is the
bounded-bitmap check (live canvases < pages/2 for 120+ page documents).

| Check | Threshold |
|---|---|
| Import → first render (text PDF, any size ≤ 1000 p) | ≤ 1.5 s |
| Page turn in single mode | ≤ 250 ms |
| Zoom step re-render | ≤ 200 ms |
| Live canvas bitmaps after scroll-through (≥ 120 p) | < pages / 2 (asserted) |
| JS heap after scroll-through | ≤ 100 MB |

## Follow-ups

- Image-heavy/scanned PDF fixture for a worst-case render baseline (text
  fixtures undersell per-page raster cost).
- Native-side measurement (Electron RSS with a large PDF open) via
  `perf/profile-macos.sh` once it grows a Studio scenario; canvas bitmaps
  live outside the JS heap, so heap alone understates total memory.
- Windows run of the same spec for a second platform datapoint.
