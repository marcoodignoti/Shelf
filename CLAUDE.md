# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Shelf is a local-first desktop workspace (Notion-style notes + a "Studio" mode for reading PDFs while writing linked notes). Frontend: React 19 + TypeScript + Vite + Tailwind 4 + BlockNote editor. Desktop shell: Electron. Storage: SQLite (`node:sqlite`) through Electron's Node runtime.

## Commands

```sh
npm run dev            # Vite renderer server for electron:dev
npm run electron:dev   # Full Electron app with Vite dev server (hot reload)
npm run electron       # Electron app against the built renderer
npm test               # All Vitest unit tests
npx vitest run src/lib/foo.test.ts   # A single unit test file
npm run test:scripts   # node --test for electron/*.test.cjs + scripts/*.test.cjs (backend)
npm run e2e            # build + Playwright e2e (run e2e:install once first)
npx playwright test tests/e2e/foo.e2e.ts   # A single e2e spec (does NOT rebuild)
npm run build          # tsc + vite build (frontend only)
npm run check          # Full Electron gate: build + unit + test:scripts + smoke/runtime + prod audit + package + visual/parity/stability smoke
npm run perf           # Frontend perf suite
npm run perf:native    # macOS release-binary RSS + startup profiling (perf/profile-macos.sh)
```

- **e2e runs against the built `dist/`**, served by `scripts/serve-dist.cjs` on :1420 (not the Vite dev server). After changing `src/`, run `npm run build` before `npx playwright test ...`, or you are testing stale code. Playwright reuses an already-running server on :1420.
- e2e uses a mocked `window.openNotion` (`tests/e2e/helpers/mockBridge.ts`) backed by localStorage; backend changes need matching mock changes and are covered by `test:scripts` instead.
- Running the whole e2e suite can produce flaky `page.goto("/")` timeouts under load — re-run a failing spec in isolation before treating it as a regression.
- Visual baselines live in `tests/e2e/visual.e2e.ts-snapshots/`; after an intentional UI change, `npx playwright test tests/e2e/visual.e2e.ts --update-snapshots`. 1–2 pixel diffs are pre-existing noise.
- Electron smoke tests fail on **any** renderer console warning at first launch (e.g. library deprecation warnings), not just errors.
- `check` audits production dependencies only (`npm audit --omit=dev`); the remaining dev advisories are in electron-builder's build toolchain.
- Perf specs use a separate `playwright.perf.config.ts`. Reference baselines/budgets are tracked in the repo — update them deliberately when a regression is intentional.
- If `npm run electron:dev` seems to hang or "won't open": check port 1420 and stale Electron/Vite processes from a previous run.

## Architecture

The app is a thin React UI over an Electron/SQLite backend. **All persistence goes through `window.openNotion` IPC** — the frontend never touches the DB directly.

- **`electron/backend.cjs`** — `ShelfBackend`: opens SQLite and composes feature modules, each a `create*Backend(context)` factory mixed into the instance: `backend-pages.cjs` (pages, trash, version history), `backend-studio-{documents,projects,links,unification}.cjs`, `backend-assets.cjs`, `backend-backup.cjs` (+ `portable-backup-archive.cjs` for `.shelf` archives), `backend-profile.cjs`, `backend-updates.cjs`. `backend-command-registry.cjs` maps IPC command names to methods; `backend-helpers.cjs` holds schema setup, column lists, validators (PDF/image/video magic bytes) and shared helpers.
- **Schema** evolves via idempotent `CREATE TABLE IF NOT EXISTS` + best-effort `ALTER TABLE ADD COLUMN` at startup in `backend-helpers.cjs` (no migration framework — add new columns the same way). Tables: `pages`, `page_versions`, `studio_documents`, `studio_projects`, `studio_document_page_links`, `trash_project_memberships`, `app_metadata`. DB path: `~/Library/Application Support/org.opennotion.desktop/opennotion.db`.
- **`electron/main.cjs` + `electron/preload.cjs` + `src/lib/desktop.ts`** — secure IPC bridge (`contextIsolation`, `sandbox`, CSP set as a response header in `main.cjs`, not in `index.html`). Managed assets are served via the `opennotion-app://asset/` protocol. Untrusted input (imported files, backups) must go through the validators in `backend-helpers.cjs`.
- **`src/lib/db.ts`, `studio.ts`, `profile.ts`, `betaUpdates.ts`, `desktop.ts`** — the data-access layer: thin typed wrappers around `invoke(...)` plus shared types (`Page`, `StudioDocument`, …). Add new backend calls as a typed function here, not inline in a component.
- **`src/store/useAppStore.ts`** — the Zustand store, split into `src/store/slices/` (pages, studio, profile, split, shared); UI-only state is in `useUIStore.ts`. Stores never call `invoke` directly. Actions follow an **optimistic-update** pattern: mutate local state, call the wrapper, on error roll back and set `notice`/`error`. Match this pattern when adding actions.
- **`src/App.tsx` + `src/components/Layout.tsx`** — routing is state-driven via `workspaceMode` (`'notes' | 'studio'`) and `currentPageId` / `currentStudioDocumentId`, not a router. Notes mode renders `HomeView` or `PageEditor` (optionally two pages in split view); Studio mode renders `StudioWorkspace` (split PDF/note view).
- **`src/lib/`** — pure, framework-free logic with co-located `*.test.ts` files. New non-trivial logic belongs here as a tested pure function, kept out of components. This is the bulk of the unit-test surface.
- **Autosave** — `src/components/useEditorAutosave.ts` debounces saves (300 ms), mirrors pending edits to localStorage (`src/lib/pendingPageSaves.ts`) for crash recovery, retries failed writes with backoff, and flushes to the backend on unmount.

## BlockNote editor

- `src/components/PageEditor.tsx` + `src/lib/editorMath.tsx` (formula blocks, LaTeX paste detection/normalization for KaTeX; regex-heavy, covered by unit tests and `tests/e2e/persistence.e2e.ts` — extend tests when changing heuristics), `editorLinks.tsx` (inline page links), `editorSlashMenu.tsx`. `PageEditor.tsx` holds `Editor`/`EditorSurface` (state, editor creation, page header JSX); its UI pieces live in `src/components/editor/`: `EditorToolbars.tsx` (side menu, formatting toolbar, block-type select), `PageEditorTopBar.tsx`, `PageHeadingRail.tsx`, `SubpageCreateMenu.tsx`, and hooks `useHeadingScrollSpy`, `useSlashMenuScrollLock`, `useEditorContentSync`.
- `tsc` checks the **real** BlockNote types (there are no local type shims). Pinned in `package.json`: `@blocknote/*` exact versions, and `overrides` for every `@tiptap/*` package and `prosemirror-model` — these keep a single tiptap/prosemirror instance and must be bumped together with BlockNote.
- Since 0.56: never pass `null` as a `portalElement`/`portalElements` target (it mounts into a detached node → invisible menus; omit it to use the editor container). Popovers we portal to `document.body` from editor UI must be registered with `editor.registerPortalElement` (see `FloatingPopover`'s `editor` prop), or focusing them counts as leaving the editor and hides the toolbar.
- When upgrading BlockNote, run the full e2e suite: most regressions only show up there.

## Data model notes

- A `page` is the universal unit: notes, subpages (`parent_id` + `sort_order`), templates (`is_template`), databases (`is_database` + `database_schema` + `properties`), Studio notes and project pages (`page_kind`: `note` | `studio_note` | `project`) are all rows in `pages`.
- Deletion is soft: pages/documents/projects move to the trash (`is_deleted`/`deleted_at`, grouped by `trash_root_id`) and are purged after 30 days (`TRASH_RETENTION_DAYS`) on backend startup. Page snapshots live in `page_versions` (max 50 per page, 5-minute cooldown).
- A Studio document (`studio_documents`) holds a copied-in PDF and viewer state; its primary note is `note_page_id`, and further linked notes (optionally pinned to a PDF page) are in `studio_document_page_links`. Documents are grouped into `studio_projects`, which can nest.

## Local-only files

`exports/`, `scripts/export-fisica2.test.ts`, `vitest.export.config.ts` and the `export:fisica2` script / `latex.css` devDependency in the working-tree `package.json` are the owner's personal course-export tooling: keep them out of commits (stage `package.json`/`package-lock.json` without those lines).
