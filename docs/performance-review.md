# Shelf Performance Review

Date: 2026-06-18

## System Role Prompts

```text
Act as a senior performance reviewer for a local-first React/Electron/SQLite desktop app. Identify runtime bottlenecks, memory pressure, disk and IPC overhead, algorithmic inefficiencies, and caching/indexing gaps. Prefer conservative changes that preserve local-first behavior, typed IPC boundaries, and existing tests.
```

```text
Act as a complexity optimizer for a TypeScript/React/Electron codebase. Search for repeated scans, avoidable O(n^2) behavior, expensive rendering loops, large payload transfer, and missing indexes. Recommend specific optimizations with measured validation steps.
```

## Executive Summary

Shelf's largest performance risks were concentrated in four areas:

1. Studio PDF continuous mode rendered too many pages at once.
2. page and sidebar data paths repeatedly scanned arrays.
3. page listing loaded full editor content even when only metadata was needed.
4. search used broad `LIKE` scans over large note bodies.

The current pass addressed those hotspots with PDF viewport virtualization, map-backed lookups, metadata-first page loading, lower-copy media import, and an FTS-backed search index with fallback.
It also optimized page-tree export traversal to avoid repeated full-tree scans.

## Measurements

| Check | Result | Budget / Baseline | Status |
| --- | ---: | ---: | --- |
| Frontend startup | 309 ms | <= 700 ms | Pass |
| Editing heap delta | 4,773,612 bytes | <= 7 MB | Pass |
| Small PDF profile | 10 pages, 32 MB heap, 4/5 live canvases | informational | Pass |
| Medium PDF profile | 120 pages, 32 MB heap, 2/5 live canvases | informational | Pass |
| Large PDF profile | 800 pages, 36 MB heap, 2/5 live canvases | informational | Pass |
| Native peak RSS | 190 MB | 400 MB warning threshold | Pass |
| Native startup overhead | 218 ms | informational | Pass |

## Frontend Rendering

### Bottleneck

Studio continuous PDF mode previously built a visible page list from the entire PDF page count. Large PDFs could produce excessive canvas work, memory pressure, and slow scroll/zoom updates.

### Optimization Applied

`StudioWorkspace` now calculates a bounded continuous page window and renders only visible PDF pages plus spacer elements. The perf profile for an 800-page fixture reports only `2/5` live canvases and 36 MB heap.

### Recommendations

- Keep continuous PDF rendering virtualized.
- Add a perf assertion for maximum live canvases in the PDF profile if regressions become common.
- Consider a small canvas reuse pool only if future profiles show frequent canvas allocation churn during fast scrolling.

## State And Sidebar Data Flow

### Bottleneck

Several UI paths repeatedly used `Array.find` or `Array.filter` over all pages for lookups, child grouping, and current-page resolution. This is acceptable for tiny workspaces but grows poorly with large local page trees.

### Optimization Applied

The app now builds `Map` indexes for page lookup and sidebar child grouping. Sidebar project sections avoid filter-per-project behavior, reducing repeated O(projects * pages) scans.

### Recommendations

- Keep derived page maps memoized at the boundary where page arrays enter complex UI.
- Prefer pure helper functions in `src/lib/` for future page-tree transforms so complexity is testable.
- Add a synthetic large-page-tree unit benchmark if page-tree regressions become hard to spot in review.

## Persistence And IPC Payloads

### Bottleneck

`list_pages` returned full editor JSON content for every page. This made initial page loads and refetches scale with total note body size rather than visible metadata.

### Optimization Applied

Page listing now returns metadata-only rows with `content_loaded = 0`. Opening an editor hydrates the selected page with `get_page`, and store merges preserve already-loaded content across metadata refetches.

### Recommendations

- Keep full content loading behind explicit `get_page` / `list_all_pages` calls.
- Audit any new IPC command that returns pages and decide whether it needs metadata or full content.
- Add an integration test for opening a page after a metadata refetch to guard hydration behavior.

## Export Paths

### Bottleneck

Page-tree export previously collected descendants by repeatedly scanning the full `pages` array until no more descendants were found. Markdown export also filtered all pages at each recursive node to find children. Deep or broad trees could therefore turn export into repeated O(n) passes.

### Optimization Applied

`exportPages` now builds parent-to-children maps once and uses queue/recursive traversal over those maps. Export behavior is unchanged, but descendant collection and Markdown tree generation avoid repeated full-array scans.

### Recommendations

- Keep future export transforms map-backed when walking page trees.
- Consider streaming large JSON/Markdown exports later if memory profiles show full export materialization becoming expensive.

## Search And Caching

### Bottleneck

Search used `lower(coalesce(search_text, '')) LIKE ?`, which can scan large note bodies and bypass useful indexing as the workspace grows.

### Optimization Applied

SQLite FTS5 search now backs page search via `page_search_fts`. The index is versioned, rebuilt only when the index version changes, and incrementally synced on page create, update, import, duplicate, template creation, and delete. Search falls back to the previous `LIKE` query if FTS is unavailable.

### Recommendations

- Keep the FTS index versioned; bump `PAGE_SEARCH_INDEX_VERSION` only when indexed columns or tokenization behavior changes.
- Consider adding title weighting if search relevance becomes a UX complaint.
- Add a repair command that rebuilds FTS manually if future diagnostics detect index drift.

## Resource Utilization

### Memory

Media import now passes `Uint8Array` payloads instead of expanding files into `number[]`, reducing transient JS heap overhead for image and video import.

### Disk

The FTS index duplicates searchable title/body text. This is an intentional disk-for-query-speed tradeoff for a local-first app. It should be monitored for very large workspaces.

### CPU

Search, sidebar rendering, and current-page lookup now avoid several repeated linear scans. PDF continuous mode avoids unnecessary canvas rendering work.

## Algorithmic Efficiency

| Area | Previous Pattern | Current Pattern | Impact |
| --- | --- | --- | --- |
| Sidebar project children | repeated `filter` per project | grouped `Map` by parent id | avoids O(projects * pages) |
| Current page lookup | repeated `find` | memoized `Map` | O(1) lookup |
| PDF continuous pages | render range from full page count | viewport window | bounded render work |
| Search | broad body `LIKE` scan | FTS index lookup | indexed query path |
| Media import | `Uint8Array` to `number[]` copy | direct `Uint8Array` | lower transient heap |
| Page export | repeated full-tree scans | parent-child maps | linear tree traversal |

## Remaining Bottlenecks

1. Editor bundle size remains large because BlockNote and editor dependencies dominate the built chunks.
2. `list_all_pages` still intentionally loads full content for export/backup paths.
3. Native RSS should continue to be monitored after long Studio sessions with real PDFs.
4. FTS increases disk usage for content-heavy workspaces.

## Next Optimization Plan

1. Profile editor route loading and consider deferring non-critical editor-only menus or export helpers.
2. Add a long-session Studio soak test or manual runbook entry with RSS checkpoints.
3. Add FTS drift repair diagnostics if users report stale search results.
4. Review backup/export flows for streaming opportunities where full workspace materialization is not required.

## Verification Commands

```sh
node --test electron/backend-pages.test.cjs electron/backend-assets.test.cjs electron/backend-studio-links.test.cjs
npx vitest run src/store/useAppStore.test.ts src/lib/db.test.ts src/lib/studio.test.ts src/lib/sidebarProjects.test.ts src/lib/pageTree.test.ts
npx vitest run src/lib/exportPages.test.ts src/store/useAppStore.test.ts src/lib/db.test.ts src/lib/studio.test.ts src/lib/sidebarProjects.test.ts src/lib/pageTree.test.ts
npm run build
npm run perf
npm run perf:native
```
