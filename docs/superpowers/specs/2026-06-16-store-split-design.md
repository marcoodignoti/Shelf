# Store Decomposition — Design

Date: 2026-06-16
Status: approved in brainstorming, awaiting final document review

## Goal

Decompose the monolithic `src/store/useAppStore.ts` (785 lines) to improve maintainability and modularity. The store currently fuses three concerns with different lifecycles: UI preferences, domain data (pages / studio / profile), and cross-cutting notification/nav state.

This is the first half of a two-part refactor. The four god-components (`PageEditor`, `Sidebar`, `StudioWorkspace`, `DatabaseTableView`) are explicitly out of scope and are a follow-up effort.

## Scope

### Included

1. **New `useUIStore`** — fully isolated store for device preferences (theme, sidebar, locale, editor font/size, page width, title-enter behavior) with its own `localStorage` round-trip and no dependency on domain data.
2. **Slice-organized `useAppStore`** — same public API, internally composed from `sharedSlice` + `pagesSlice` + `studioSlice` + `profileSlice` via the standard Zustand slice pattern.
3. **Characterization tests** for the store's cross-slice optimistic-update flows, added before any code moves, as a permanent safety net.
4. **One bundled cleanup**: deduplicate `pageTreeIds` / `descendantPageIds` (byte-for-byte identical today).

### Excluded

- Any behavior change. This is a pure, behavior-preserving reorganization.
- Decomposition of the four god-components (follow-up effort).
- Migration framework, `error`/`notice` collapse, backend split — separate issues identified in the architecture analysis.

## Approach

**Safety-net-first, big-bang** (chosen over "extract-then-test-opportunistically" and "pure reorg"):

1. Add characterization tests pinning current behavior of the risky cross-slice flows.
2. Extract `useUIStore` in one move (clean isolation boundary).
3. Carve domain slices inside `useAppStore`, one slice per sub-step, re-running the gate between each.

Each step is independently shippable and revertible. The public `useAppStore` API never changes after step 1, so consumer files are edited only in step 2 (the UI-store extraction). Step numbering in "Execution Plan" below uses Step 0 for tests (it precedes the refactor proper) and Steps 1–2 to match the three numbered items here.

## Target Architecture

### The split

**`useUIStore`** (fully isolated — no domain refs, independent lifecycle):

- State: `isSidebarOpen`, `sidebarWidth`, `theme`, `localePreference`, `editorFont`, `editorFontSize`, `pageWidth`, `titleEnterBehavior`
- Actions: `toggleSidebar`, `setSidebarWidth`, `setTheme`, `setLocalePreference`, `setEditorFont`, `setEditorFontSize`, `setPageWidth`, `setTitleEnterBehavior`
- Helpers that move with it: `SIDEBAR_MIN/MAX/DEFAULT_WIDTH`, `clampSidebarWidth`, `getStoredSidebarWidth`, `isTheme`, `getStoredTheme`, `getStoredPreference`
- The `Theme` type (currently a local type alias at `useAppStore.ts:39`) moves here and is exported.

**`useAppStore`** (domain — kept as one store, slice-organized internally):

- `pagesSlice` — owns `pages[]`: `fetchPages`, `addPage`, `renamePageAction`, `removePage`, `movePageAction`, `reorderPagesAction`, `toggleFavoriteAction`, `toggleTemplateAction`, `addPageFromTemplate`, `duplicatePageAction`, `updatePageOptimistically`, `importPageAction`, `createProjectAction`, `removeProjectAction`, `exportProjectNotesMarkdown`, `exportProjectNotesJSON`. Helper: `pageTreeIds` (the deduplicated one). Projects (`createProjectAction`, `removeProjectAction`, `exportProjectNotes*`) live here because a project *is* a page with `page_kind='project'` — they read the same `pages[]` and `studioDocuments` collections via `get()`, not a separate collection.
- `studioSlice` — owns `studioDocuments[]`, `studioDocumentPageLinks[]`: `fetchStudioDocuments`, `importStudioPdfAction`, `replaceStudioPdfAction`, `updateStudioViewerAction`, `createMissingStudioNoteAction`, `renameStudioDocumentAction`, `deleteStudioDocumentAction`.
- `profileSlice` — owns `profile`: `fetchProfile`, `updateProfileAction`, `importProfileAvatarAction`.
- `sharedSlice` — cross-cutting concerns shared across slices (see below).

### `sharedSlice` — why cross-cutting concerns are not in a domain slice

State: `notice`, `error`, `isLoading`, `isCommandPaletteOpen`, `currentPageId`, `currentStudioDocumentId`.
Actions: `showSuccess`, `showError`, `showErrorKey`, `clearNotice`, `clearError`, `setError`, `openCommandPalette`, `closeCommandPalette`, `setCurrentPageId`, `setCurrentStudioDocumentId`.

Three reasons this is its own slice rather than "leftovers in the main file":

1. `notice`/`error` is the rollback channel written by every slice via `get().showError(...)` — an explicit name documents that role.
2. `setCurrentPageId` flips both `currentPageId` and `currentStudioDocumentId` together, so it belongs with nav state, not buried in `pagesSlice`.
3. Keeping it as a slice leaves `useAppStore.ts` a thin composition file rather than a grab-bag.

`isCommandPaletteOpen` stays here (opened by the keyboard handler in `App.tsx` and by actions — cross-cutting, not a pure UI pref).

### How cross-slice calls keep working

All slices are typed `StateCreator<AppState, ...>` against the **full** `AppState`, so `set`/`get` see everything. When `removePage` (pagesSlice) prunes `studioDocumentPageLinks` and calls `fetchStudioDocuments()`, it does so via `get()` exactly as today. No behavior change, no new abstraction.

```ts
// src/store/useAppStore.ts (final form)
export const useAppStore = create<AppState>()((...a) => ({
  ...createSharedSlice(...a),
  ...createPagesSlice(...a),
  ...createStudioSlice(...a),
  ...createProfileSlice(...a),
}));
```

### File layout

```
src/store/
  useAppStore.ts          # composed create(), imports slices, AppState interface
  useUIStore.ts           # isolated UI prefs
  useUIStore.test.ts      # pref round-trip tests (moved from characterization suite)
  useAppStore.test.ts     # cross-slice characterization tests
  slices/
    sharedSlice.ts        # notice/error/palette/nav-setters
    pagesSlice.ts
    studioSlice.ts
    profileSlice.ts
    helpers.ts            # pageTreeIds (dedup), logStoreError
```

### API stability

All consumers keep importing `useAppStore` and selecting the same fields. `useUIStore` is the only new import. The only consumer edits happen during the UI-store extraction (step 2): each moved selector changes from `useAppStore(s => s.theme)` → `useUIStore(s => s.theme)`. `tsc` (strict) makes a missed selector a compile error.

## Characterization Tests

### Goal

Lock down current store behavior before any code moves, so the split is provably behavior-preserving. Permanent tests — not throwaway.

### Test harness

The store calls real `db.ts`/`studio.ts` wrappers, which call `window.openNotion.invoke`. Existing `src/lib/*.test.ts` files run under `vitest` with `environment: node` — no `window`. The harness:

- **Mock `window.openNotion`** with an in-memory fake: a spy recording `(command, args)` calls, returning programmable responses. Set on `globalThis.window` in `beforeEach`.
- **Reset the store between tests**: Zustand stores are module singletons, so use `vi.resetModules()` + dynamic `import()` of the store per test to prevent state leakage.
- **Minimal `localStorage` shim** — enough for the store to initialize (init reads `getStoredPageId`, `getStoredTheme`, etc.).
- Assert against **observable store state** (`useAppStore.getState()`) and **the IPC calls made** (from the fake's call log) — not internals.

### Flows covered (the risky cross-slice behavior)

| Test | Pins down |
|---|---|
| `removePage` on a page with descendants + studio link | removes page subtree from `pages`, prunes `studioDocumentPageLinks`, recomputes `currentPageId`, calls `fetchStudioDocuments`, persists `localStorage` page id |
| `removePage` failure → rollback | restores `pages` + `studioDocumentPageLinks` to pre-call snapshot, surfaces `notice` error |
| `removeProjectAction` | cascades `parent_id` reset on orphaned pages, removes project, refetches links |
| `renameStudioDocumentAction` | updates the studio doc title **and** mirrors it onto the linked page (`${title} Notes`) |
| `renameStudioDocumentAction` failure → rollback | restores both `studioDocuments` and `pages` |
| `importStudioPdfAction` | prepends doc to `studioDocuments`, refreshes links + `pages`, sets `currentPageId`/`currentStudioDocumentId` correctly for the unified-vs-not path |
| `fetchStudioDocuments` | merges linked + "missing" studio notes into `pages`, dedups by id |
| `reorderPagesAction` / `movePageAction` optimistic update + rollback | state flips immediately, persists, rolls back on error |
| `addPage`/`duplicatePage`/`addPageFromTemplate` with `{select: false}` | does **not** change `currentPageId` (the one branchy behavior) |
| UI prefs (`setTheme`, `setSidebarWidth`, etc.) | round-trip through `localStorage` and clamp width |

### Location

`src/store/useAppStore.test.ts` (new). After the split, UI-pref assertions move to `useUIStore.test.ts`; cross-slice assertions stay in `useAppStore.test.ts`. Coverage never drops.

### Out of scope

- Re-testing pure `src/lib/` functions (already covered).
- e2e — the existing `tests/e2e/` suite is the final gate.

## Execution Plan

### Step 0 — Characterization tests

Add `src/store/useAppStore.test.ts` with the harness and the flows above. Gate: `npm test` green (new tests pass, existing unaffected).

### Step 1 — Extract `useUIStore`

- Create `src/store/useUIStore.ts` with the 8 state fields, 7 setters, moved helpers, exported `Theme` type.
- Remove them from `useAppStore.ts`.
- Migrate consumers: `App.tsx` (theme, locale), `Layout.tsx` (sidebar state), `SettingsModal.tsx` + `src/components/settings/*` (all prefs). Mechanical line edits; exhaustive grep confirms coverage.
- Move the UI-pref assertions from `useAppStore.test.ts` into a new `useUIStore.test.ts`.

Gate: `npm test` + `npm run build` (tsc strict catches missed consumers) + e2e (settings, sidebar).

### Step 2 — Carve domain slices

Extract in dependency order, gate between each:

1. **`sharedSlice`** first (everything else depends on it via `get()`).
2. **`profileSlice`** (smallest, fewest cross-calls).
3. **`studioSlice`**.
4. **`pagesSlice`** (largest, most cross-calls — `removePage`/`removeProjectAction` reach into studio).

After each sub-step `useAppStore.ts` imports one more slice; after step 2.4 it is just imports + the `create()` composition + the `AppState` interface.

**No consumer edits** in this phase — the public API is unchanged.

Gate per sub-step: `npm test` + `npm run build`. Final gate: `npm run check` (build + unit + smoke/runtime/visual/parity + audit) + e2e (`persistence`, `studio`, `sidebar-projects`, `subpage-order`).

## Error Handling

Unchanged. The optimistic-update-with-rollback pattern is preserved exactly; `sharedSlice.showError` remains the single rollback channel. No new error paths introduced.

## Testing

- **Unit**: characterization suite (step 0) + `useUIStore.test.ts` (step 1); these are the primary regression net.
- **Type system**: strict `tsc` enforces that every moved field's consumers are migrated and that slices compose into a complete `AppState`.
- **e2e**: unchanged existing suite, run as the final confidence gate.
- **Project gate**: `npm run check` — the real CI gate called out in `AGENTS.md`.

## Risks

- **Cross-slice optimistic-update regressions** — the riskiest behavior and the thing today's tests least cover. Mitigated by step 0's characterization suite added before any move.
- **Missed consumer during UI-store extraction** — mitigated by exhaustive grep + strict `tsc` (a missed selector is a compile error).
- **Slice typing complexity** — `StateCreator<AppState, ...>` against the full state is the standard Zustand pattern but verbose. Acceptable trade-off for preserving the `get()`-based cross-slice calls with zero behavior change.
- **Test-harness fragility** — mocking `window.openNotion` is new to this repo. Kept minimal and documented; if it proves flaky, the e2e suite remains the backstop.
