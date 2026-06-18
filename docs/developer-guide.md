# Shelf Developer Guide

Shelf is a local-first desktop workspace for notes, PDFs, study, and research. The app pairs a React renderer with an Electron shell and a SQLite-backed local persistence layer. This guide is the starting point for contributors, maintainers, and coding agents working in the repository.

## 1. Setup Instructions

### Prerequisites

- Node.js 22 or newer.
- npm, using the lockfile in this repository.
- macOS or Windows for desktop packaging work.
- Chromium Playwright browser for E2E tests.

Install dependencies from a clean checkout:

```sh
npm ci
```

Install the Playwright browser once before running browser E2E tests:

```sh
npm run e2e:install
```

### Run the App

Start the full Electron desktop app in development mode:

```sh
npm run electron:dev
```

This launches the Vite renderer server and opens Electron against it.

For renderer-only work, run Vite directly:

```sh
npm run dev
```

For the built renderer inside Electron:

```sh
npm run build
npm run electron
```

### Local Data

Shelf stores user data in local app data, not in the repository. On macOS the default data directory is:

```text
~/Library/Application Support/org.opennotion.desktop/
```

Important files and folders:

```text
opennotion.db      # SQLite database for pages and Studio metadata
backups/           # automatic pre-update database snapshots
covers/            # page cover images
editor-images/     # pasted or imported editor media
studio-documents/  # imported PDFs
```

Do not commit local databases, imported PDFs, private screenshots, generated builds, or Playwright result folders.

## 2. Project Structure Overview

### Desktop Backend

`electron/` contains the Electron process code, SQLite backend, IPC bridge, smoke tests, update support, and packaging verification scripts.

Key files:

- `electron/backend.cjs`: SQLite setup, schema initialization, command dispatch, backup import/export, and Studio file handling.
- `electron/main.cjs`: Electron main process entry point.
- `electron/preload.cjs`: secure bridge that exposes `window.openNotion`.
- `electron/*-smoke.cjs`: packaged Electron smoke, visual, parity, and stability checks.
- `electron/backend-*.cjs`: focused backend modules for assets, pages, Studio documents, links, projects, updates, and profiling.

All persistence must go through `window.openNotion` IPC. Renderer code must not read or write SQLite directly.

### Renderer App

`src/` contains the React 19, TypeScript, Tailwind 4, BlockNote, and Zustand application code.

Important areas:

- `src/App.tsx`: top-level state-driven app routing.
- `src/components/`: UI components, including the page editor, layout, Studio workspace, settings, sidebar, and dialogs.
- `src/lib/`: pure and shared logic such as database wrappers, Studio wrappers, editor math normalization, navigation, page tree behavior, table handling, and utility tests.
- `src/store/useAppStore.ts` and `src/store/slices/`: Zustand app state and actions.
- `src/types/`: shared TypeScript type definitions.

Top-level navigation is state-driven through `workspaceMode`, `currentPageId`, and `currentStudioDocumentId`; there is no route-based page model.

### Data Access Layer

Renderer persistence calls are centralized in:

- `src/lib/db.ts`: page CRUD and page-oriented typed wrappers.
- `src/lib/studio.ts`: Studio document/project wrappers and file helpers.
- `src/lib/desktop.ts`: desktop IPC invocation helper and bridge typing.

Add new backend calls as typed wrapper functions here. Avoid inline `invoke(...)` calls from components unless there is an established exception.

### State Management

`src/store/useAppStore.ts` is the single application store. Store actions generally follow this pattern:

1. Save the previous state.
2. Optimistically update the local state.
3. Call the typed data-access wrapper.
4. On failure, restore the previous state and set `notice` or `error`.

Follow that pattern when adding actions that persist changes.

### Documentation, Release, and Performance

- `docs/`: product, API, testing, release, launch, and performance docs.
- `docs/testing/e2e.md`: browser and packaged Electron E2E overview.
- `perf/README.md`: performance suite notes and budget guidance.
- `scripts/`: packaging, release, screenshot, preview, checksum, update-manifest, and helper scripts.
- `tests/e2e/`: Playwright E2E and performance specs.

## 3. Development Workflow

### Start With the Ownership Boundary

Choose the layer that owns the behavior:

- UI-only behavior belongs in `src/components/`.
- Cross-component or non-trivial logic belongs in `src/lib/` with tests.
- App-wide state transitions belong in `src/store/`.
- Persistence changes need typed renderer wrappers and backend IPC command support.
- SQLite schema changes belong in Electron backend startup code.

### Change Backend Commands

When adding or changing persisted data:

1. Add or update schema initialization in `electron/backend.cjs` or the relevant backend module.
2. Keep schema evolution idempotent with `CREATE TABLE IF NOT EXISTS` and best-effort `ALTER TABLE ADD COLUMN` blocks.
3. Add or update backend command handling.
4. Add a typed wrapper in `src/lib/db.ts` or `src/lib/studio.ts`.
5. Use the wrapper from the store or component layer.
6. Add focused unit tests for backend behavior and renderer-side pure logic.

There is no migration framework, so startup schema changes must be safe to run repeatedly.

### Change Editor Behavior

The editor stack is centered on `src/components/PageEditor.tsx` and `src/lib/editorMath.tsx`.

When changing formula, paste, block normalization, persistence, or destructive editor behavior:

- Keep parsing and normalization logic in `src/lib/`.
- Extend nearby unit tests.
- Add or update Playwright coverage when the behavior is user-visible.
- Re-run the relevant persistence or editor E2E spec in isolation if the full suite is noisy.

### Change Studio Behavior

Studio combines PDF state, linked notes, document metadata, and project grouping.

Common files:

- `src/lib/studio.ts`
- `src/components/StudioWorkspace.tsx`
- `electron/backend-studio-*.cjs`
- `tests/e2e/studio.e2e.ts`
- `tests/e2e/sidebar-projects.e2e.ts`

Be careful to preserve the invariant that a Studio document links to exactly one note page.

### Before Opening a Pull Request

Run the narrowest useful tests while iterating, then run the main gate before handing off:

```sh
npm run check
```

For changes that only affect pure frontend logic, start with:

```sh
npx vitest run src/lib/your-file.test.ts
```

For browser workflow changes, run the relevant E2E spec:

```sh
npx playwright test tests/e2e/persistence.e2e.ts
```

## 4. Testing Approach

### Unit Tests

Run all Vitest unit tests:

```sh
npm test
```

Run one Vitest file:

```sh
npx vitest run src/lib/foo.test.ts
```

Use unit tests for:

- Pure logic in `src/lib/`.
- Page tree ordering, navigation, breadcrumbs, table behavior, math normalization, and schema helpers.
- Store-adjacent behavior that can be isolated.

### Node Tests

Backend and script tests use Node's built-in test runner:

```sh
npm run test:scripts
```

Use these for:

- Electron backend modules.
- Release, packaging, checksum, notarization, and update-manifest scripts.
- Backend command behavior that does not need a full Electron launch.

### Browser E2E Tests

Run all browser E2E specs:

```sh
npm run e2e
```

Run one browser E2E spec:

```sh
npx playwright test tests/e2e/studio.e2e.ts
```

Browser E2E tests run against the Vite app with a deterministic mock of `window.openNotion`. They do not touch the real local SQLite database.

The whole E2E suite shares one Vite server. If a full-suite run reports a `page.goto("/")` timeout, re-run the failing spec by itself before treating it as a product regression.

### Electron Smoke and Full Gate

Run the full Electron gate:

```sh
npm run check
```

This includes:

- TypeScript and Vite build.
- Vitest unit tests.
- Node backend/script tests.
- Electron smoke and runtime checks.
- npm audit at moderate severity.
- Packaged directory build.
- Visual, parity, and stability smoke tests.

### Performance Tests

Run the frontend performance suite:

```sh
npm run perf
```

Run macOS release-binary RSS and startup profiling:

```sh
npm run perf:native
```

Performance baselines and budgets are tracked in the repository. Update them deliberately only when a regression or behavioral change is intentional and documented.

## 5. Common Troubleshooting Steps

### `npm run electron:dev` Hangs or Does Not Open

Check whether Vite is already running on port `1420` or whether stale Electron/Vite processes are still alive from a previous run.

Useful checks:

```sh
lsof -i :1420
ps aux | grep -E "Electron|vite|electron-dev"
```

Stop stale processes, then retry:

```sh
npm run electron:dev
```

### Browser E2E `page.goto("/")` Timeouts

The full E2E suite can be noisy under load because specs share one Vite server. Re-run the failing spec in isolation:

```sh
npx playwright test tests/e2e/the-failing-spec.e2e.ts
```

If the isolated run passes, treat the first failure as load-related unless it repeats.

### Playwright Browser Is Missing

Install Chromium:

```sh
npm run e2e:install
```

Then re-run the E2E command.

### App State Looks Wrong During Manual Testing

Shelf reads from local app data, not from repository fixtures. If manual testing shows unexpected notes, projects, PDFs, or settings, inspect the local app data directory:

```text
~/Library/Application Support/org.opennotion.desktop/
```

Back up data before deleting or moving any local database or imported files.

### Build or Package Output Looks Stale

Clean the Electron package output:

```sh
npm run electron:clean
```

Then rebuild:

```sh
npm run build
npm run electron:package:dir
```

### Tests Pass in Browser but Fail in Packaged Electron

Browser E2E uses a mocked bridge, while packaged Electron smoke tests use the real preload bridge and SQLite backend. Check:

- Preload exposure in `electron/preload.cjs`.
- Main-process command dispatch in `electron/main.cjs`.
- Backend command registration and schema setup.
- Typed renderer wrappers in `src/lib/db.ts` or `src/lib/studio.ts`.
- Whether packaged files are included or excluded by `package.json` build rules.

### SQLite Schema Changes Do Not Appear

Schema setup runs at app startup and must be idempotent. Confirm that:

- The `CREATE TABLE IF NOT EXISTS` statement includes the new table shape for fresh installs.
- Existing installs get a best-effort `ALTER TABLE ADD COLUMN` block.
- The command reads and writes the same column names.
- Tests cover both fresh and existing database cases when possible.

## System Role Prompts

Use these role prompts when working with Shelf through an AI coding assistant or when creating task-specific contributor instructions.

### Repository Maintainer

```text
You are a senior maintainer for Shelf, a local-first Electron, React, TypeScript, and SQLite desktop app. Preserve local-first privacy, keep persistence behind the typed window.openNotion IPC bridge, follow existing optimistic store patterns, and require focused tests for persistence, editor, Studio, release, and destructive-action changes.
```

### Frontend Contributor

```text
You are a frontend contributor working on Shelf's React renderer. Match the existing component and Tailwind patterns, keep non-trivial logic in src/lib with tests, use the Zustand store for app state, and avoid direct backend invokes from components unless an established exception already exists.
```

### Backend Contributor

```text
You are an Electron backend contributor for Shelf. Implement persistence through IPC commands, keep SQLite schema setup idempotent, add startup-safe ALTER TABLE blocks for existing installs, protect local user data, and verify behavior with backend Node tests plus packaged Electron smoke tests when the bridge or packaging changes.
```

### Testing Contributor

```text
You are a testing contributor for Shelf. Prefer fast unit tests for pure logic, Node tests for backend and scripts, browser Playwright tests for mocked renderer workflows, and packaged Electron smoke tests for real IPC, SQLite, and build output. Re-run flaky full-suite E2E failures in isolation before diagnosing product regressions.
```
