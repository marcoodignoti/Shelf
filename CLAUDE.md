# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpenNotion is a local-first desktop workspace (Notion-style notes + a "Studio" mode for reading PDFs while writing linked notes). Frontend: React 19 + TypeScript + Vite + Tailwind 4 + BlockNote editor. Desktop shell: Electron. Storage: SQLite through Electron's Node runtime. There is no cloud backend or account system — contributions must preserve that (see CONTRIBUTING.md).

## Commands

```sh
npm run dev            # Vite renderer dev server on :1420 (used by electron:dev)
npm run electron:dev   # Full Electron app with Vite dev server
npm run electron       # Electron app against the built renderer
npm test               # All Vitest unit tests
npx vitest run src/lib/foo.test.ts   # A single unit test file
npm run e2e            # Browser e2e: vite build, then Playwright against `vite preview` on :1420 (run e2e:install once first)
npx playwright test tests/e2e/foo.e2e.ts   # A single e2e spec (requires a prior npm run build)
npm run build          # tsc + vite build (frontend only)
npm run check          # Full Electron gate: build + unit + smoke/runtime smokes + audit + package:dir + visual/parity/stability smokes
npm run perf           # Frontend perf suite (separate playwright.perf.config.ts; NOT part of check)
npm run perf:native    # macOS release-binary RSS + startup profiling (requires electron:package:dir first)
npm run release:package:macos       # Ad-hoc signed DMG (macOS only); verify with release:verify:macos
npm run release:package:windows     # Portable zip; release:package:windows:installer builds the NSIS installer
```

- Browser e2e specs install a deterministic mock of `window.openNotion` via `addInitScript` — they never touch a real SQLite DB. The packaged-app smokes (`electron/smoke.cjs`, `visual-smoke.cjs`, `parity-smoke.cjs`, `stability-smoke.cjs`) are what exercise the real bridge and database.
- Perf budgets/baselines are tracked in the repo (`perf/README.md` and constants like `STARTUP_BUDGET_MS` in `tests/e2e/perf.perf.e2e.ts`) — update them deliberately when a regression is intentional.
- A spec that fails when the whole e2e suite runs may be flaky under load — re-run it in isolation to confirm whether it's a real regression.
- If `npm run electron:dev` seems to hang or "won't open": check the Vite server on port 1420 and stale Electron/Vite processes from a previous run.

## Architecture

The app is a thin React UI over an Electron/SQLite backend. **All persistence goes through `window.openNotion` IPC** — the frontend never touches the DB directly.

- **`electron/backend.cjs`** — the Electron backend: SQLite setup, schema, command dispatch, backup import/export, Studio file handling, and update-artifact download/verification. The schema evolves via idempotent `CREATE TABLE IF NOT EXISTS` + best-effort `ALTER TABLE ADD COLUMN` blocks at startup (there is no migration framework — add new columns the same way). Tables: `pages`, `studio_documents`, `studio_projects`, `studio_document_page_links`, `app_metadata`. The DB is `opennotion.db` (WAL mode) in Electron's userData dir — `org.opennotion.desktop` under the platform appData dir, overridable with `OPENNOTION_USER_DATA_DIR`.

- **`electron/main.cjs` + `electron/preload.cjs` + `src/lib/desktop.ts`** — secure Electron IPC bridge. Renderer code calls typed wrappers, preload exposes `window.openNotion`, and main dispatches to `electron/backend.cjs`.

- **`src/lib/db.ts` + `src/lib/studio.ts`** — the data-access layer: thin typed wrappers around `invoke(...)` (page CRUD in `db.ts`; Studio documents/projects/page-links in `studio.ts`) plus the shared `Page`/`StudioDocument`/`StudioProject` types and `fileSrc` helpers. Nearly all `invoke` calls live here; the exceptions are a direct `invoke("show_character_palette")` in `PageEditor.tsx` and the update-manifest calls in `betaUpdates.ts`. Add new backend calls as a typed function here, not inline in a component.

- **`src/store/useAppStore.ts`** — the single Zustand store; it never calls `invoke` directly but composes the `db.ts`/`studio.ts` wrappers. Actions follow an **optimistic-update** pattern: mutate local state immediately, call the wrapper, and on error roll back to the saved previous state while setting `notice`/`error`. Match this pattern when adding actions.

- **`src/App.tsx` + `src/components/Layout.tsx`** — top-level routing is state-driven via `workspaceMode` (`'notes' | 'studio'`) and `currentPageId` / `currentStudioDocumentId` in the store (persisted to localStorage), not a router. Notes mode renders `HomeView` or `PageEditor`; Studio mode renders `StudioWorkspace` (split PDF/note view).

- **`src/lib/`** — pure, framework-free logic with co-located `*.test.ts` files (page tree/ordering, navigation, math/LaTeX normalization, tables, database schema, breadcrumbs, etc.). New non-trivial logic belongs here as a tested pure function, kept out of components. This is the bulk of the unit-test surface.

- **`src/components/PageEditor.tsx` + `src/lib/editorMath.tsx`** — the BlockNote editor and its formula handling. `editorMath` detects pasted LaTeX, normalizes split/bracketed display-math fences into single `formula` blocks, and prepares formulas for KaTeX. It is regex-heavy and well-covered by both unit tests and e2e tests in `tests/e2e/persistence.e2e.ts` — extend the tests when changing detection heuristics.

- **Beta updates** — `src/lib/betaUpdates.ts` + `BetaUpdateNotice.tsx` fetch an Ed25519-signed update manifest (public key in `electron/update-public-key.pem`); the backend verifies artifact SHA-256 on download. The Windows NSIS installer additionally auto-updates via `electron-updater`. Keypair/manifest tooling lives in `scripts/` (`release:update-keypair`, `release:update-manifest`); release process docs are in `docs/release/`.

## Data model notes

- A `page` is the universal unit: ordinary notes, subpages (via parent linkage + `sort_order`), templates (`is_template`), databases (`is_database` + `database_schema` + `properties`), and Studio notes are all rows in `pages` distinguished by columns / `page_kind`.
- A Studio document (`studio_documents`) links a copied-in PDF to one primary note page (`note_page_id`) and stores viewer state (zoom, page, panel layout). Additional pages can be linked through `studio_document_page_links`, optionally anchored to a `pdf_page`. Documents can be grouped into `studio_projects`, which nest via `parent_id`.
