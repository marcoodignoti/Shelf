# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

Shelf is a local-first desktop workspace (Notion-style notes + a "Studio" mode for reading PDFs while writing linked notes). Frontend: React 19 + TypeScript + Vite + Tailwind 4 + BlockNote editor. Desktop shell: Electron. Storage: SQLite through Electron's Node runtime.

## Commands

```sh
npm run dev            # Vite renderer server for electron:dev and mocked browser e2e
npm run electron:dev   # Full Electron app with Vite dev server
npm run electron       # Electron app against the built renderer
npm test               # All Vitest unit tests
npx vitest run src/lib/foo.test.ts   # A single unit test file
npm run e2e            # Playwright e2e (auto-starts Vite on :1420; run e2e:install once first)
npx playwright test tests/e2e/foo.e2e.ts   # A single e2e spec
npm run build          # tsc + vite build (frontend only)
npm run check          # Full Electron gate: build + unit + smoke/runtime/visual/parity + audit
npm run perf           # Frontend perf suite
npm run perf:native    # macOS release-binary RSS + startup profiling (perf/profile-macos.sh)
```

- Perf specs use a separate `playwright.perf.config.ts`. Reference baselines/budgets are tracked in the repo — update them deliberately when a regression is intentional.

- e2e specs share a single Vite dev server. Running the whole suite at once can produce flaky `page.goto("/")` load timeouts under load — re-run a failing spec in isolation to confirm whether it's a real regression.
- If `npm run electron:dev` seems to hang or "won't open": check the Vite server on port 1420 and stale Electron/Vite processes from a previous run.

## Architecture

The app is a thin React UI over an Electron/SQLite backend. **All persistence goes through `window.openNotion` IPC** — the frontend never touches the DB directly.

- **`electron/backend.cjs`** — the Electron backend. It holds SQLite setup, schema, command dispatch, backup import/export, and Studio file handling. The schema evolves via idempotent `CREATE TABLE IF NOT EXISTS` + best-effort `ALTER TABLE ADD COLUMN` blocks at startup (there is no migration framework — add new columns the same way). Tables: `pages`, `studio_documents`, `studio_projects`, `app_metadata`. DB path: `~/Library/Application Support/org.opennotion.desktop/opennotion.db`.

- **`electron/main.cjs` + `electron/preload.cjs` + `src/lib/desktop.ts`** — secure Electron IPC bridge. Renderer code calls typed wrappers, preload exposes `window.openNotion`, and main dispatches to `electron/backend.cjs`.

- **`src/lib/db.ts` + `src/lib/studio.ts`** — the data-access layer: thin typed wrappers around `invoke(...)` (page CRUD in `db.ts`; Studio documents/projects in `studio.ts`) plus the shared `Page`/`StudioDocument`/`StudioProject` types and `fileSrc` helpers. Nearly all `invoke` calls live here; the lone exception is a direct `invoke("show_character_palette")` in `PageEditor.tsx`. Add new backend calls as a typed function here, not inline in a component.

- **`src/store/useAppStore.ts`** — the single Zustand store; it never calls `invoke` directly but composes the `db.ts`/`studio.ts` wrappers. Actions follow an **optimistic-update** pattern: mutate local state immediately, call the wrapper, and on error roll back to the saved previous state while setting `notice`/`error`. Match this pattern when adding actions.

- **`src/App.tsx` + `src/components/Layout.tsx`** — top-level routing is state-driven via `workspaceMode` (`'notes' | 'studio'`) and `currentPageId` / `currentStudioDocumentId` in the store, not a router. Notes mode renders `HomeView` or `PageEditor`; Studio mode renders `StudioWorkspace` (split PDF/note view).

- **`src/lib/`** — pure, framework-free logic with co-located `*.test.ts` files (page tree/ordering, navigation, math/LaTeX normalization, tables, database schema, breadcrumbs, etc.). New non-trivial logic belongs here as a tested pure function, kept out of components. This is the bulk of the unit-test surface.

- **`src/components/PageEditor.tsx` + `src/lib/editorMath.tsx`** — the BlockNote editor and its formula handling. `editorMath` detects pasted LaTeX, normalizes split/bracketed display-math fences into single `formula` blocks, and prepares formulas for KaTeX. It is regex-heavy and well-covered by both unit tests and e2e tests in `tests/e2e/persistence.e2e.ts` — extend the tests when changing detection heuristics.

## Data model notes

- A `page` is the universal unit: ordinary notes, subpages (via parent linkage + `sort_order`), templates (`is_template`), databases (`is_database` + `database_schema` + `properties`), and Studio notes are all rows in `pages` distinguished by columns / `page_kind`.
- A Studio document (`studio_documents`) links a copied-in PDF to exactly one note page (`note_page_id`) and stores viewer state (zoom, page, panel layout). Documents can be grouped into `studio_projects` (which can themselves nest via `parent`).
