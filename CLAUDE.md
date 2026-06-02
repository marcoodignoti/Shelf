# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpenNotion is a local-first desktop workspace (Notion-style notes + a "Studio" mode for reading PDFs while writing linked notes). Frontend: React 19 + TypeScript + Vite + Tailwind 4 + BlockNote editor. Desktop shell: Tauri 2. Storage: SQLite via Rust `sqlx`.

## Commands

```sh
npm run dev            # Vite dev server only (browser, no native shell)
npm run tauri dev      # Full desktop app (Vite + Rust). First compile is slow (~10 min); later runs are seconds.
npm test               # All Vitest unit tests
npx vitest run src/lib/foo.test.ts   # A single unit test file
npm run e2e            # Playwright e2e (auto-starts Vite on :1420; run e2e:install once first)
npx playwright test tests/e2e/foo.e2e.ts   # A single e2e spec
npm run build          # tsc + vite build (frontend only)
npm run check          # Full gate (alias check:tauri): build + unit + e2e + npm audit + cargo fmt/clippy/test
npm run perf           # Perf suite: perf:backend (cargo --ignored tests) + perf:frontend (Playwright)
npm run perf:native    # macOS release-binary RSS + startup profiling (perf/profile-macos.sh)
```

- Perf specs use a separate `playwright.perf.config.ts`; backend perf cases are `#[ignore]`d cargo tests run with `-- --ignored`. Reference baselines/budgets are tracked in the repo — update them deliberately when a regression is intentional.

- e2e specs share a single Vite dev server. Running the whole suite at once can produce flaky `page.goto("/")` load timeouts under load — re-run a failing spec in isolation to confirm whether it's a real regression.
- If `npm run tauri dev` seems to hang or "won't open": it is usually the slow first Rust compile, or stale `tauri dev`/`vite`/`cargo run` processes holding port 1420 from a previous run. Kill them and free :1420.

## Architecture

The app is a thin React UI over a Rust/SQLite backend. **All persistence goes through Tauri commands** — the frontend never touches the DB directly.

- **`src-tauri/src/lib.rs` (+ `src-tauri/src/ai.rs`)** — the Rust backend. `lib.rs` holds SQLite setup, schema, and most `#[tauri::command]`s; `ai.rs` holds the AI/OpenRouter integration and its commands (registered from `lib.rs`). The schema evolves via idempotent `CREATE TABLE IF NOT EXISTS` + best-effort `ALTER TABLE ADD COLUMN` blocks at startup (there is no migration framework — add new columns the same way). Tables: `pages`, `studio_documents`, `studio_projects`, `app_metadata`. DB path: `~/Library/Application Support/org.opennotion.desktop/opennotion.db`.

- **`src/lib/db.ts` + `src/lib/studio.ts` + `src/lib/ai.ts`** — the data-access layer: thin typed wrappers around `invoke(...)` (page CRUD in `db.ts`; Studio documents/projects in `studio.ts`; AI settings/plan/apply + chat in `ai.ts`) plus the shared `Page`/`StudioDocument`/`StudioProject` types and `convertFileSrc` helpers. Nearly all `invoke` calls live here; the lone exception is a direct `invoke("show_character_palette")` in `PageEditor.tsx`. Add new backend calls as a typed function here, not inline in a component.

- **`src/store/useAppStore.ts`** — the single Zustand store; it never calls `invoke` directly but composes the `db.ts`/`studio.ts` wrappers. Actions follow an **optimistic-update** pattern: mutate local state immediately, call the wrapper, and on error roll back to the saved previous state while setting `notice`/`error`. Match this pattern when adding actions.

- **`src/App.tsx` + `src/components/Layout.tsx`** — top-level routing is state-driven via `workspaceMode` (`'notes' | 'studio'`) and `currentPageId` / `currentStudioDocumentId` in the store, not a router. Notes mode renders `HomeView` or `PageEditor`; Studio mode renders `StudioWorkspace` (split PDF/note view).

- **`src/lib/`** — pure, framework-free logic with co-located `*.test.ts` files (page tree/ordering, navigation, math/LaTeX normalization, tables, database schema, breadcrumbs, etc.). New non-trivial logic belongs here as a tested pure function, kept out of components. This is the bulk of the unit-test surface.

- **`src/components/PageEditor.tsx` + `src/lib/editorMath.tsx`** — the BlockNote editor and its formula handling. `editorMath` detects pasted LaTeX, normalizes split/bracketed display-math fences into single `formula` blocks, and prepares formulas for KaTeX. It is regex-heavy and well-covered by both unit tests and e2e tests in `tests/e2e/persistence.e2e.ts` — extend the tests when changing detection heuristics.

## AI integration

- **`src/lib/ai.ts`** is the AI data-access layer (provider is OpenRouter only: `AI_PROVIDER_OPENROUTER`). The frontend never calls the model directly. Two paths share the same action/apply machinery: (1) **plan/apply** — `generate_ai_action_plan` returns a structured `AiActionPlan` (a versioned list of `create_page` / `create_subpages` / `create_database` / `create_database_rows` / `append_blocks` actions), the user previews it, then `apply_ai_action_plan` executes it against the same page/DB tables; (2) **chat** — `stream_ai_chat_reply` (regenerate reuses the same path) streams a markdown reply over a Tauri `Channel` and may embed one plan in a trailing ```` ```opennotion-actions ```` fence, split out by `split_chat_actions` in `ai.rs` (frontend mirror: `aiChatSession.ts`). Conversations persist via `list`/`get`/`create`/`rename`/`delete_ai_conversation`. Add new AI action variants to the `AiAction` union here and mirror them in `ai.rs`.
- The API key lives backend-side: set via `save_ai_api_key` / cleared via `clear_ai_api_key`, or supplied through the `OPENROUTER_API_KEY` / `OPENNOTION_OPENROUTER_API_KEY` env vars (preferred over the keychain). It is **never returned to the frontend** — settings expose only a `has_api_key` boolean and an `api_key_source` (the source name, e.g. `keychain` or the env-var name, never the value). Don't surface or log the raw key.
- **Trusted mode** (`canTrustedModeAutoApply` in `ai.ts`) auto-applies a plan without confirmation only when trusted mode is on, the plan doesn't set `requires_confirmation`, action count is 1–12, and every action is an allow-listed create. Keep this allow-list narrow when adding actions.
- **`src/components/AiChat.tsx`** is the chat modal (streamed markdown via `AiMarkdown.tsx`, inline action cards, conversation history rail, copy/regenerate); **`src/lib/aiChatSession.ts`** holds the pure streaming/fence helpers (`visibleStreamText`, `CHAT_ACTIONS_FENCE`). Co-located tests: `ai.test.ts`, `aiChatSession.test.ts`, and e2e `tests/e2e/ai.e2e.ts`.

## Data model notes

- A `page` is the universal unit: ordinary notes, subpages (via parent linkage + `sort_order`), templates (`is_template`), databases (`is_database` + `database_schema` + `properties`), and Studio notes are all rows in `pages` distinguished by columns / `page_kind`.
- A Studio document (`studio_documents`) links a copied-in PDF to exactly one note page (`note_page_id`) and stores viewer state (zoom, page, panel layout). Documents can be grouped into `studio_projects` (which can themselves nest via `parent`).
