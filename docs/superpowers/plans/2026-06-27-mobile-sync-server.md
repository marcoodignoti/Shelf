# Shelf Mobile Sync — Phase 1+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract framework-free code into a shared workspace package, then build a local-first sync server inside the Electron desktop app so a future mobile client can read/write pages over an encrypted local-network REST API.

**Architecture:** An npm-workspaces monorepo adds `packages/shared` (framework-free types + pure page/i18n logic consumed by both desktop renderer and future mobile app). The desktop gains new Electron modules that run an HTTPS server bound to private interfaces; it advertises itself via mDNS, pairs phones via QR + device token, and maps REST routes to the existing `backend.invoke(command, args)` layer — no new database code except the `sync_devices` table.

**Tech Stack:** TypeScript (shared), Node `https`/`http` + `bonjour-service` (mDNS) + `node:crypto` (cert/token) in Electron, Vitest + `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-06-27-mobile-app-design.md`

**Out of scope (deferred to Phase 3):** the mobile app itself (`mobile/` submodule), WebView editor host, mobile SQLite client, mobile UI.

---

## File Structure

### Phase 1 — `packages/shared` extraction

| File | Responsibility |
|---|---|
| `packages/shared/package.json` | Workspace package manifest (`@shelf/shared`, `"main": "./src/index.ts"`) |
| `packages/shared/tsconfig.json` | TS config for shared (ESNext, strict, `noEmit`, `DOM` lib for `crypto.randomUUID` consumer compat) |
| `packages/shared/src/index.ts` | Barrel re-exporting types + functions |
| `packages/shared/src/types.ts` | `Page`, `PageKind`, `SearchResult` (extracted verbatim from `src/lib/db.ts`) |
| `packages/shared/src/pageTree.ts` | Pure page ordering/tree functions (from `src/lib/pageTree.ts`) |
| `packages/shared/src/breadcrumb.ts` | Breadcrumb builder (from `src/lib/breadcrumb.ts`) |
| `packages/shared/src/i18n/index.ts` | `resolveLocale` + `useT` hook (from `src/lib/i18n.ts`) |
| `packages/shared/src/i18n/locales/en.ts` | English strings (from `src/lib/locales/en.ts`) |
| `packages/shared/src/i18n/locales/it.ts` | Italian strings (from `src/lib/locales/it.ts`) |
| `packages/shared/src/pageTree.test.ts` | Moved from `src/lib/pageTree.test.ts` |
| `packages/shared/src/breadcrumb.test.ts` | Moved from `src/lib/breadcrumb.test.ts` |
| `packages/shared/src/i18n/i18n.test.ts` | Moved from `src/lib/i18n.test.ts` |
| `src/lib/db.ts` (modify) | Re-export types from `@shelf/shared` for backwards compat |
| `src/lib/pageTree.ts` (modify/delete) | Replace with re-export from `@shelf/shared` |
| `src/lib/breadcrumb.ts` (modify/delete) | Replace with re-export from `@shelf/shared` |
| `src/lib/i18n.ts` (modify/delete) | Replace with re-export from `@shelf/shared` |
| `package.json` (modify root) | Add `workspaces: ["packages/*"]` |
| `tsconfig.json` (modify) | Add `@shelf/shared` path mapping |
| `vitest.config.ts` (modify) | Include `packages/shared/**/*.test.ts` |

### Phase 2 — Desktop sync server

| File | Responsibility |
|---|---|
| `electron/sync-certs.cjs` | Generate/load ECDSA self-signed cert (P-256), persist to `appConfigDir/sync-server/` |
| `electron/sync-certs.test.cjs` | Cert generation + reload idempotency |
| `electron/sync-tokens.cjs` | Random token generation (32 bytes), SHA-256 hashing, constant-time compare |
| `electron/sync-tokens.test.cjs` | Token + hash + compare behavior |
| `electron/sync-devices.cjs` | CRUD over `sync_devices` table: register/list/revoke, lookup by token hash |
| `electron/sync-devices.test.cjs` | Device lifecycle |
| `electron/sync-pairing.cjs` | Ephemeral pairing tokens (TTL 5 min), QR payload builder, PIN generation |
| `electron/sync-pairing.test.cjs` | Pairing flow + expiry |
| `electron/sync-routes.cjs` | REST route table: maps `GET/PUT/POST/DELETE /pages[/:id]` + `/pair` + `/devices` to handler functions |
| `electron/sync-routes.test.cjs` | Route dispatch + auth boundary |
| `electron/sync-server.cjs` | HTTPS server lifecycle: bind to private interfaces, TLS, rate limit, dispatch via routes |
| `electron/sync-server.test.cjs` | End-to-end server ↔ simulated client (push/pull/conflict/revoke) |
| `electron/sync-mdns.cjs` | Advertise `_shelf-sync._tcp` via `bonjour-service` (start/stop) |
| `electron/sync-mdns.test.cjs` | Advertisement lifecycle (mocked service) |
| `electron/backend-helpers.cjs` (modify) | Add `sync_devices` idempotent migration + export `SYNC_*` constants |
| `electron/backend.cjs` (modify) | Call `runSyncDeviceMigrations(db)` inside `ShelfBackend` constructor |
| `electron/main.cjs` (modify) | Start/stop sync server on app lifecycle; wire mDNS; handle Settings toggle |
| `electron/preload.cjs` (modify) | Expose `window.openNotion.sync.*` (enable, disable, getStatus, getDevices, revokeDevice, startPairing, cancelPairing) |
| `src/lib/desktop.ts` (modify) | Typed wrappers for the new sync IPC methods |
| `src/lib/desktopCommands.ts` (modify) | Add sync command constants |
| `src/components/SettingsModal.tsx` (modify) | Add "Mobile sync" settings section |
| `electron/smoke.cjs` (modify) | Add smoke assertions: sync server starts only when enabled; `sync_devices` table exists |
| `package.json` (modify) | Add `bonjour-service` dependency; add `sync:test` script |

---

## Phase 1 — Extract `packages/shared`

### Task 1: Create the `packages/shared` workspace package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Modify: `package.json` (root, add workspaces)

- [ ] **Step 1: Add workspaces to root `package.json`**

In `/Users/marcodignoti/Developer/Shelf/package.json`, add a `"workspaces"` field after `"type": "module"` (line 16):

```json
  "type": "module",
  "workspaces": ["packages/*"],
```

- [ ] **Step 2: Create `packages/shared/package.json`**

```json
{
  "name": "@shelf/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

No build step — consumers (Vite renderer, Vitest, RN bundler) resolve the TS source directly via the workspace symlink. This matches the repo convention of shipping TS source (the Electron backend is `.cjs`, the renderer imports `.ts`/`.tsx` directly).

- [ ] **Step 3: Create `packages/shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020"],
    "skipLibCheck": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Note: no `DOM` lib here — shared code must stay framework-free. `crypto.randomUUID()` usage belongs in consumers, not shared.

- [ ] **Step 4: Install the workspace (creates the symlink)**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm install`
Expected: npm creates `node_modules/@shelf/shared` → `../../packages/shared`. No errors.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/shared/package.json packages/shared/tsconfig.json package-lock.json
git commit -m "build(workspaces): add @shelf/shared workspace package"
```

---

### Task 2: Extract `Page` types into shared

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`
- Modify: `src/lib/db.ts:3-28` (replace inline types with re-export)

- [ ] **Step 1: Write the type module**

Create `packages/shared/src/types.ts` with the verbatim types currently at `src/lib/db.ts:3-28`:

```typescript
export type PageKind = 'note' | 'studio_note' | 'project';

export interface Page {
  id: string;
  title: string;
  parent_id: string | null;
  content: string | null;
  search_text: string | null;
  icon: string | null;
  cover_url: string | null;
  is_deleted: number;
  is_favorite: number;
  is_template: number;
  is_database?: number;
  database_schema?: string | null;
  properties?: string | null;
  sort_order: number;
  page_kind: PageKind;
  created_at: string;
  updated_at: string;
  content_loaded?: number;
}

export interface SearchResult extends Page {
  matched_content: string | null;
}
```

- [ ] **Step 2: Create the barrel**

Create `packages/shared/src/index.ts`:

```typescript
export * from "./types";
```

- [ ] **Step 3: Replace the inline types in `src/lib/db.ts`**

In `src/lib/db.ts`, delete lines 3-28 (the `PageKind`, `Page`, `SearchResult` declarations) and replace with a re-export at the top of the file (after line 1, the existing import):

```typescript
export type { Page, PageKind, SearchResult } from "@shelf/shared";
import type { Page } from "@shelf/shared";
```

Keep the existing `import { fileSrc, ... } from './desktop';` on what is now line 1. The `export type` re-export preserves the public API of `src/lib/db.ts` so every existing import of `Page` from `./db` keeps working unchanged.

- [ ] **Step 4: Verify the build still passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run build`
Expected: `tsc` succeeds with no errors, Vite build completes.

- [ ] **Step 5: Verify unit tests still pass**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm test -- src/lib/db.test.ts`
Expected: all tests pass (these are the existing db tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts src/lib/db.ts
git commit -m "refactor(shared): extract Page types into @shelf/shared"
```

---

### Task 3: Extract page-tree logic into shared

**Files:**
- Create: `packages/shared/src/pageTree.ts` (move from `src/lib/pageTree.ts`)
- Create: `packages/shared/src/pageTree.test.ts` (move from `src/lib/pageTree.test.ts`)
- Modify: `src/lib/pageTree.ts` (replace with re-export)
- Modify: `packages/shared/src/index.ts` (add export)
- Modify: `tsconfig.json` (path alias)
- Modify: `vitest.config.ts` (include shared tests)

- [ ] **Step 1: Read the current file to move it verbatim**

Run: `cat src/lib/pageTree.ts` (review full content before moving).

- [ ] **Step 2: Copy verbatim to shared**

Copy the entire contents of `src/lib/pageTree.ts` into `packages/shared/src/pageTree.ts`. The only change: if it imports the `Page` type from a relative path like `./db`, change that import to a relative `./types`:

```typescript
import type { Page } from "./types";
```

No other edits.

- [ ] **Step 3: Move the test file**

Copy `src/lib/pageTree.test.ts` into `packages/shared/src/pageTree.test.ts`. Update any relative imports in the test the same way (e.g. `./pageTree` stays relative; `Page` type import → `./types`). Delete `src/lib/pageTree.test.ts` afterward.

- [ ] **Step 4: Replace the desktop file with a re-export**

Overwrite `src/lib/pageTree.ts` with:

```typescript
export * from "@shelf/shared";
export { buildPageTree, flattenPageTree, orderPages /* ...list every named export from the moved file... */ } from "@shelf/shared";
```

If the moved module has default exports or many names, simplest is `export * from "@shelf/shared";` — but since `@shelf/shared` re-exports many modules, prefer a direct deep import instead. Overwrite `src/lib/pageTree.ts` with:

```typescript
export * from "@shelf/shared/pageTree";
```

Then add to `packages/shared/package.json` `exports`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./pageTree": "./src/pageTree.ts"
  }
```

- [ ] **Step 5: Add to the shared barrel**

Append to `packages/shared/src/index.ts`:

```typescript
export * from "./pageTree";
```

- [ ] **Step 6: Wire TS path alias + vitest include**

In `tsconfig.json`, add under `paths`:

```json
    "@shelf/shared": ["./packages/shared/src/index.ts"],
    "@shelf/shared/*": ["./packages/shared/src/*"]
```

In `vitest.config.ts`, change `include` to:

```typescript
    include: ["src/**/*.test.{ts,tsx}", "packages/shared/**/*.test.ts"],
```

- [ ] **Step 7: Run the moved tests from the new location**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm test -- packages/shared/src/pageTree.test.ts`
Expected: all moved tests pass.

- [ ] **Step 8: Run the full build + test gate**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run build && npm test`
Expected: build succeeds; all tests pass (desktop consumers resolve through the re-export).

- [ ] **Step 9: Commit**

```bash
git add packages/shared packages/shared/src/pageTree.ts packages/shared/src/pageTree.test.ts \
        packages/shared/src/index.ts packages/shared/package.json \
        src/lib/pageTree.ts src/lib/pageTree.test.ts tsconfig.json vitest.config.ts
git commit -m "refactor(shared): move pageTree into @shelf/shared"
```

---

### Task 4: Extract breadcrumb logic into shared

**Files:**
- Create: `packages/shared/src/breadcrumb.ts` (move from `src/lib/breadcrumb.ts`)
- Create: `packages/shared/src/breadcrumb.test.ts` (move from `src/lib/breadcrumb.test.ts`)
- Modify: `src/lib/breadcrumb.ts` (replace with re-export)
- Modify: `packages/shared/src/index.ts` (add export)

- [ ] **Step 1: Read the current file**

Run: `cat src/lib/breadcrumb.ts`

- [ ] **Step 2: Copy verbatim to shared with import fix**

Copy `src/lib/breadcrumb.ts` → `packages/shared/src/breadcrumb.ts`. Change any `Page` type import from `./db` to `./types`. No other edits.

- [ ] **Step 3: Move the test**

Copy `src/lib/breadcrumb.test.ts` → `packages/shared/src/breadcrumb.test.ts`, fix relative imports (`./breadcrumb` stays, `Page` → `./types`). Delete the original test.

- [ ] **Step 4: Replace desktop file with re-export**

Overwrite `src/lib/breadcrumb.ts`:

```typescript
export * from "@shelf/shared/breadcrumb";
```

- [ ] **Step 5: Add to barrel**

Append to `packages/shared/src/index.ts`:

```typescript
export * from "./breadcrumb";
```

- [ ] **Step 6: Run moved tests + full gate**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm test -- packages/shared/src/breadcrumb.test.ts && npm run build && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/breadcrumb.ts packages/shared/src/breadcrumb.test.ts \
        packages/shared/src/index.ts src/lib/breadcrumb.ts src/lib/breadcrumb.test.ts
git commit -m "refactor(shared): move breadcrumb into @shelf/shared"
```

---

### Task 5: Extract i18n into shared

**Files:**
- Create: `packages/shared/src/i18n/index.ts` (move logic from `src/lib/i18n.ts`)
- Create: `packages/shared/src/i18n/locales/en.ts` (move from `src/lib/locales/en.ts`)
- Create: `packages/shared/src/i18n/locales/it.ts` (move from `src/lib/locales/it.ts`)
- Create: `packages/shared/src/i18n/i18n.test.ts` (move from `src/lib/i18n.test.ts`)
- Modify: `src/lib/i18n.ts` (replace with re-export)
- Modify: `packages/shared/src/index.ts` (add export)

⚠️ **Caveat to flag for the implementer:** `src/lib/i18n.ts` exports `useT`, a React hook. Shared code must be framework-free. The resolution: split i18n into a **pure core** (`resolveLocale`, dictionaries, `translate(key, locale, params)`) that moves to `@shelf/shared`, and keep `useT` in `src/lib/i18n.ts` as a thin React wrapper that imports the pure core from `@shelf/shared`. Do **not** move the React hook into shared.

- [ ] **Step 1: Read the current i18n files**

Run: `cat src/lib/i18n.ts && echo "---EN---" && cat src/lib/locales/en.ts | head -30 && echo "---IT---" && cat src/lib/locales/it.ts | head -30`

Review what is pure (locale resolution, dictionary lookup, interpolation) vs React (`useT`, `useContext`, `createContext`).

- [ ] **Step 2: Move the locale dictionaries**

Create `packages/shared/src/i18n/locales/en.ts` from the verbatim contents of `src/lib/locales/en.ts`. Same for `it.ts`. Delete the originals under `src/lib/locales/`.

- [ ] **Step 3: Create the pure i18n core**

Create `packages/shared/src/i18n/index.ts` containing the pure parts extracted from `src/lib/i18n.ts`:

```typescript
import type { Page } from "../types"; // only if i18n references Page; remove if unused
import { en } from "./locales/en";
import { it } from "./locales/it";

export type Locale = "en" | "it";
export type TranslationDictionary = typeof en;

const LOCALES: Record<Locale, TranslationDictionary> = { en, it };

export function resolveLocale(preference: string | null | undefined, browserLocale: string): Locale {
  const pref = (preference ?? "").toLowerCase();
  if (pref.startsWith("it")) return "it";
  if (pref.startsWith("en")) return "en";
  const browser = (browserLocale ?? "").toLowerCase();
  if (browser.startsWith("it")) return "it";
  return "en";
}

export function translate(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  // Paste here — verbatim — the existing dictionary lookup + {param} interpolation
  // body from src/lib/i18n.ts (the non-React part). It is pure today; it stays
  // pure in shared. Do not invent new logic; copy what's there.
  return /* existing lookup body */ "";
}

export { en, it };
```

Replace the `TODO` by copying the existing dictionary lookup + `{param}` interpolation logic from `src/lib/i18n.ts` exactly as-is (it is pure).

- [ ] **Step 4: Move the i18n tests (pure parts only)**

Copy `src/lib/i18n.test.ts` → `packages/shared/src/i18n/i18n.test.ts`. Keep only tests that exercise `resolveLocale` / `translate` / dictionaries. Fix imports to point at `./index` and `./locales/*`. Delete the original test.

- [ ] **Step 5: Keep `useT` in the desktop, backed by the shared core**

Overwrite `src/lib/i18n.ts` with a thin React wrapper:

```typescript
import { resolveLocale as resolveLocaleCore, translate, type Locale } from "@shelf/shared";
// keep any existing React imports (createContext, useContext, etc.)

export { resolveLocaleCore as resolveLocale, translate, type Locale };
// keep the React `useT` hook and its provider exactly as they are,
// but change its internal lookup to call `translate(...)` from @shelf/shared.
export function useT() { /* existing body, now calling translate() */ }
```

Preserve the exact public exports the desktop currently has so consumers (`App.tsx`, components) are unchanged.

- [ ] **Step 6: Add to barrel**

Append to `packages/shared/src/index.ts`:

```typescript
export * from "./i18n";
```

- [ ] **Step 7: Update vitest coverage exclude**

In `vitest.config.ts` `coverage.exclude`, change `"src/lib/locales/**"` to also exclude `"packages/shared/src/i18n/locales/**"` (locale dictionaries are data, not logic):

```typescript
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/vite-env.d.ts",
        "src/main.tsx",
        "src/lib/locales/**",
        "packages/shared/src/i18n/locales/**",
      ],
```

- [ ] **Step 8: Run i18n tests + full gate**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm test -- packages/shared/src/i18n && npm run build && npm test`
Expected: all pass; desktop `useT` resolves through shared `translate`.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/i18n src/lib/i18n.ts packages/shared/src/index.ts vitest.config.ts
# also stage deletions of src/lib/locales/ if git hasn't auto-tracked them
git add -A src/lib/locales
git commit -m "refactor(shared): move pure i18n core into @shelf/shared; keep useT as React wrapper"
```

---

### Task 6: Phase 1 verification gate

- [ ] **Step 1: Full build + unit tests**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run build && npm test`
Expected: `tsc` + Vite build clean; all unit tests pass (desktop + shared).

- [ ] **Step 2: Smoke-check the desktop renderer still boots**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run electron:smoke`
Expected: smoke assertions pass (the renderer resolving `@shelf/shared` doesn't break the boot path).

- [ ] **Step 3: Confirm no dead files**

Run: `cd /Users/marcodignoti/Developer/Shelf && git status`
Expected: clean working tree (all moved files committed; no leftover originals under `src/lib/locales`).

**Phase 1 done. `packages/shared` is consumable; desktop unchanged in behavior.**

---

## Phase 2 — Desktop sync server

### Task 7: Add `sync_devices` migration + shared constants

**Files:**
- Modify: `electron/backend-helpers.cjs` (add migration + constants)
- Modify: `electron/backend.cjs` (call migration in constructor)

- [ ] **Step 1: Add migration constants near the other exports**

In `electron/backend-helpers.cjs`, add a constants block (place near `APP_SCHEMA_VERSION`, ~line 110):

```javascript
const SYNC_DEVICE_TOKEN_BYTES = 32;
const SYNC_PAIRING_TOKEN_BYTES = 24;
const SYNC_PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SYNC_PIN_DIGITS = 6;
const SYNC_RATE_LIMIT_MAX_PER_MINUTE = 600;
const SYNC_CERT_VALIDITY_YEARS = 10;
const SYNC_PORT_RANGE_START = 43200;
const SYNC_PORT_RANGE_END = 43299;
```

- [ ] **Step 2: Add the migration function**

In `electron/backend-helpers.cjs`, add after `runMigrations` (~line 240, after the last `CREATE TABLE IF NOT EXISTS` in that function but inside the existing `db.exec` chain is **not** possible since `runMigrations` is one `exec`. Add a new function instead, after `runMigrations` closes):

```javascript
function runSyncDeviceMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_devices (
      device_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      paired_at TEXT NOT NULL,
      last_seen TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
  `);
}
```

- [ ] **Step 3: Export the new symbols**

In the `module.exports` block of `electron/backend-helpers.cjs` (~line 1234), add:

```javascript
  SYNC_DEVICE_TOKEN_BYTES,
  SYNC_PAIRING_TOKEN_BYTES,
  SYNC_PAIRING_TOKEN_TTL_MS,
  SYNC_PIN_DIGITS,
  SYNC_RATE_LIMIT_MAX_PER_MINUTE,
  SYNC_CERT_VALIDITY_YEARS,
  SYNC_PORT_RANGE_START,
  SYNC_PORT_RANGE_END,
  runSyncDeviceMigration,
```

- [ ] **Step 4: Call the migration from the backend constructor**

In `electron/backend.cjs`, add `runSyncDeviceMigration` to the destructured imports from `./backend-helpers.cjs` (the long require at the top). Then call it right after the database is opened. Find `this.db = openDatabase(appConfigDir);` (~line 76) and add immediately after:

```javascript
    this.db = openDatabase(appConfigDir);
    runSyncDeviceMigration(this.db);
```

- [ ] **Step 5: Write the migration test**

Create `electron/sync-devices-migration.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { runSyncDeviceMigration } = require("./backend-helpers.cjs");

test("sync_devices migration is idempotent and creates expected columns", () => {
  const db = new DatabaseSync(":memory:");
  runSyncDeviceMigration(db);
  runSyncDeviceMigration(db); // idempotent — no error
  const cols = db.prepare("SELECT name FROM pragma_table_info('sync_devices')").all().map(r => r.name);
  assert.ok(cols.includes("device_id"));
  assert.ok(cols.includes("token_hash"));
  assert.ok(cols.includes("revoked"));
  db.close();
});
```

- [ ] **Step 6: Run the test**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run test:scripts`
Expected: the `node --test scripts/*.test.cjs electron/*.test.cjs` runner picks up `electron/sync-devices-migration.test.cjs` and it passes.

- [ ] **Step 7: Commit**

```bash
git add electron/backend-helpers.cjs electron/backend.cjs electron/sync-devices-migration.test.cjs
git commit -m "feat(sync): add sync_devices table migration + constants"
```

---

### Task 8: Tokens (generation, hashing, constant-time compare)

**Files:**
- Create: `electron/sync-tokens.cjs`
- Create: `electron/sync-tokens.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `electron/sync-tokens.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { generateToken, hashToken, verifyToken } = require("./sync-tokens.cjs");

test("generateToken returns url-safe base64 of the requested length", () => {
  const t = generateToken(32);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  // 32 bytes → ~43 chars base64url, no padding
  assert.ok(t.length >= 42 && t.length <= 44);
});

test("hashToken is stable and different from the token", () => {
  const t = generateToken(32);
  const h = hashToken(t);
  assert.ok(typeof h === "string" && h.length > 0);
  assert.notStrictEqual(h, t);
  assert.strictEqual(hashToken(t), h); // deterministic
});

test("verifyToken matches the hash and rejects others", () => {
  const t = generateToken(32);
  const h = hashToken(t);
  assert.strictEqual(verifyToken(t, h), true);
  assert.strictEqual(verifyToken(generateToken(32), h), false);
  assert.strictEqual(verifyToken(t, null), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-tokens.test.cjs`
Expected: FAIL — `Cannot find module './sync-tokens.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `electron/sync-tokens.cjs`:

```javascript
const crypto = require("node:crypto");

function generateToken(byteLength) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// Constant-time comparison to avoid timing oracles on token checks.
function verifyToken(token, expectedHash) {
  if (typeof expectedHash !== "string" || expectedHash.length === 0) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { generateToken, hashToken, verifyToken };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-tokens.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/sync-tokens.cjs electron/sync-tokens.test.cjs
git commit -m "feat(sync): device token generation, hashing, constant-time verify"
```

---

### Task 9: Self-signed certificates (generate, persist, reload)

**Files:**
- Create: `electron/sync-certs.cjs`
- Create: `electron/sync-certs.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `electron/sync-certs.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ensureSyncCert } = require("./sync-certs.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shelf-cert-"));
}

test("ensureSyncCert generates a cert+key pair on first call", () => {
  const dir = tempDir();
  const { cert, key, fingerprint } = ensureSyncCert(dir);
  assert.ok(cert.includes("BEGIN CERTIFICATE"));
  assert.ok(key.includes("PRIVATE KEY"));
  assert.match(fingerprint, /^[0-9a-f]{64}$/); // sha-256 hex of DER
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ensureSyncCert reloads the same cert on subsequent calls (stable fingerprint)", () => {
  const dir = tempDir();
  const a = ensureSyncCert(dir);
  const b = ensureSyncCert(dir);
  assert.strictEqual(a.fingerprint, b.fingerprint);
  assert.strictEqual(a.cert, b.cert);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fingerprint matches the certificate's DER", () => {
  const dir = tempDir();
  const { cert, fingerprint } = ensureSyncCert(dir);
  const der = crypto.X509Certificate ? new crypto.X509Certificate(cert).raw : Buffer.from("");
  assert.strictEqual(crypto.createHash("sha256").update(der).digest("hex"), fingerprint);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-certs.test.cjs`
Expected: FAIL — `Cannot find module './sync-certs.cjs'`.

- [ ] **Step 3: Decide on cert-minting and write the implementation**

⚠️ **Node's `node:crypto` cannot mint X.509 certificates without a third-party library** (it can parse and verify them, but not create them). Three viable options:

1. **Add `selfsigned` npm dependency** (the most common, audited library for exactly this — generates a self-signed X.509 with any SANs). ~1 dep, widely used, no native code.
2. **Pre-generate the cert at build time** using `openssl` and ship it read-only — but then every install shares the same private key, which is catastrophic for security. **Rejected.**
3. **Hand-roll ASN.1 DER encoding** for an ECDSA P-256 self-signed cert — possible (~150 lines) but error-prone, hard to review, and brittle. **Rejected for maintainability.**

**Recommendation: use `selfsigned` (RSA-2048, acceptable for local-network TLS; `selfsigned` does not support EC well).**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm install selfsigned`

Then create `electron/sync-certs.cjs`:

```javascript
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const selfsigned = require("selfsigned");
const { ensurePrivateDirectory, SYNC_CERT_VALIDITY_YEARS } = require("./backend-helpers.cjs");

const CERT_FILE = "sync-cert.pem";
const KEY_FILE = "sync-key.pem";
const CN = "Shelf Sync";

function directoryFor(appConfigDir) {
  return path.join(appConfigDir, "sync-server");
}

function readPair(dir) {
  const certPath = path.join(dir, CERT_FILE);
  const keyPath = path.join(dir, KEY_FILE);
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
  return { cert: fs.readFileSync(certPath, "utf8"), key: fs.readFileSync(keyPath, "utf8") };
}

function writePair(dir, pair) {
  ensurePrivateDirectory(dir);
  fs.writeFileSync(path.join(dir, CERT_FILE), pair.cert, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, KEY_FILE), pair.key, { mode: 0o600 });
}

function fingerprintOf(certPem) {
  const der = new crypto.X509Certificate(certPem).raw;
  return crypto.createHash("sha256").update(der).digest("hex");
}

function generatePair() {
  const attrs = [{ name: "commonName", value: CN }];
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    days: SYNC_CERT_VALIDITY_YEARS * 365,
  });
  return { cert: pems.cert, key: pems.private };
}

function ensureSyncCert(appConfigDir) {
  const dir = directoryFor(appConfigDir);
  const existing = readPair(dir);
  if (existing) return { ...existing, fingerprint: fingerprintOf(existing.cert) };
  const pair = generatePair();
  writePair(dir, pair);
  return { ...pair, fingerprint: fingerprintOf(pair.cert) };
}

module.exports = { ensureSyncCert, fingerprintOf };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-certs.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/sync-certs.cjs electron/sync-certs.test.cjs package.json package-lock.json
git commit -m "feat(sync): self-signed cert generation (selfsigned dep) with stable reload"
```

---

### Task 10: Device registry (sync_devices CRUD)

**Files:**
- Create: `electron/sync-devices.cjs`
- Create: `electron/sync-devices.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `electron/sync-devices.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { runSyncDeviceMigration, SYNC_DEVICE_TOKEN_BYTES } = require("./backend-helpers.cjs");
const { generateToken, hashToken } = require("./sync-tokens.cjs");
const { createSyncDeviceStore } = require("./sync-devices.cjs");

function makeStore() {
  const db = new DatabaseSync(":memory:");
  runSyncDeviceMigration(db);
  return { db, store: createSyncDeviceStore(db) };
}

test("registerDevice stores the hashed token and returns a sanitized record", () => {
  const { db, store } = makeStore();
  const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
  const dev = store.registerDevice({ name: "Marco iPhone", platform: "ios", token });
  assert.strictEqual(dev.name, "Marco iPhone");
  assert.strictEqual(dev.platform, "ios");
  assert.strictEqual(dev.revoked, 0);
  assert.ok(dev.device_id);
  // token must NOT be stored in plaintext
  const row = db.prepare("SELECT token_hash, name FROM sync_devices WHERE device_id = ?").get(dev.device_id);
  assert.strictEqual(row.token_hash, hashToken(token));
  assert.ok(!JSON.stringify(dev).includes(token));
});

test("lookupByToken finds active devices, ignores revoked", () => {
  const { store } = makeStore();
  const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
  const dev = store.registerDevice({ name: "iPad", platform: "ios", token });
  assert.ok(store.lookupByToken(token));
  store.revokeDevice(dev.device_id);
  assert.strictEqual(store.lookupByToken(token), null);
});

test("listDevices returns active devices with last_seen", () => {
  const { store } = makeStore();
  store.registerDevice({ name: "A", platform: "ios", token: generateToken(SYNC_DEVICE_TOKEN_BYTES) });
  const list = store.listDevices();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, "A");
  assert.ok("last_seen" in list[0]);
});

test("touchLastSeen updates last_seen", () => {
  const { store } = makeStore();
  const dev = store.registerDevice({ name: "A", platform: "ios", token: generateToken(SYNC_DEVICE_TOKEN_BYTES) });
  const before = store.listDevices()[0].last_seen;
  store.touchLastSeen(dev.device_id);
  const after = store.listDevices()[0].last_seen;
  assert.notStrictEqual(after, before);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-devices.test.cjs`
Expected: FAIL — `Cannot find module './sync-devices.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `electron/sync-devices.cjs`:

```javascript
const crypto = require("node:crypto");
const { hashToken, verifyToken } = require("./sync-tokens.cjs");

function nowIso() {
  return new Date().toISOString();
}

function createSyncDeviceStore(db) {
  function registerDevice({ name, platform, token }) {
    const deviceId = "dev:" + crypto.randomUUID();
    const tokenHash = hashToken(token);
    const now = nowIso();
    db.prepare(
      `INSERT INTO sync_devices (device_id, name, platform, token_hash, paired_at, last_seen, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(deviceId, String(name), String(platform), tokenHash, now, now);
    return { device_id: deviceId, name: String(name), platform: String(platform), paired_at: now, last_seen: now, revoked: 0 };
  }

  function lookupByToken(token) {
    const rows = db.prepare("SELECT * FROM sync_devices WHERE revoked = 0").all();
    for (const row of rows) {
      if (verifyToken(token, row.token_hash)) {
        return row;
      }
    }
    return null;
  }

  function listDevices() {
    return db
      .prepare("SELECT device_id, name, platform, paired_at, last_seen, revoked FROM sync_devices WHERE revoked = 0 ORDER BY paired_at ASC")
      .all();
  }

  function revokeDevice(deviceId) {
    db.prepare("UPDATE sync_devices SET revoked = 1 WHERE device_id = ?").run(deviceId);
  }

  function touchLastSeen(deviceId) {
    db.prepare("UPDATE sync_devices SET last_seen = ? WHERE device_id = ?").run(nowIso(), deviceId);
  }

  return { registerDevice, lookupByToken, listDevices, revokeDevice, touchLastSeen };
}

module.exports = { createSyncDeviceStore };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-devices.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/sync-devices.cjs electron/sync-devices.test.cjs
git commit -m "feat(sync): device registry over sync_devices table"
```

---

### Task 11: Pairing controller (ephemeral tokens, QR payload, PIN)

**Files:**
- Create: `electron/sync-pairing.cjs`
- Create: `electron/sync-pairing.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `electron/sync-pairing.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { createPairingController } = require("./sync-pairing.cjs");

function makeController() {
  return createPairingController({
    port: 43201,
    hostCandidates: ["192.168.1.5"],
    certFingerprint: "abc123",
  });
}

test("startPairing returns a QR payload + PIN; consume resolves a device token", () => {
  const c = makeController();
  const session = c.startPairing();
  assert.match(session.qrPayload, /^https:\/\/192\.168\.1\.5:43201\/pair\?token=/);
  assert.match(session.pin, /^\d{6}$/);
  const result = c.consumePairing({ token: session.pairingToken, name: "iPhone", platform: "ios" });
  assert.ok(result.deviceToken);
  assert.ok(result.deviceId);
});

test("consumePairing rejects unknown token", () => {
  const c = makeController();
  assert.throws(() => c.consumePairing({ token: "nope", name: "X", platform: "ios" }), /invalid or expired/);
});

test("pairing token expires after TTL", () => {
  const c = createPairingController({
    port: 43201,
    hostCandidates: ["192.168.1.5"],
    certFingerprint: "abc123",
    ttlMs: 0, // immediately expired
  });
  const session = c.startPairing();
  assert.throws(() => c.consumePairing({ token: session.pairingToken, name: "X", platform: "ios" }), /expired/);
});

test("a pairing token can only be consumed once", () => {
  const c = makeController();
  const session = c.startPairing();
  c.consumePairing({ token: session.pairingToken, name: "A", platform: "ios" });
  assert.throws(() => c.consumePairing({ token: session.pairingToken, name: "B", platform: "ios" }), /invalid or expired/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-pairing.test.cjs`
Expected: FAIL — `Cannot find module './sync-pairing.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `electron/sync-pairing.cjs`:

```javascript
const {
  generateToken,
} = require("./sync-tokens.cjs");
const {
  SYNC_PAIRING_TOKEN_BYTES,
  SYNC_PAIRING_TOKEN_TTL_MS,
  SYNC_PIN_DIGITS,
} = require("./backend-helpers.cjs");

function createPairingController({ port, hostCandidates, certFingerprint, ttlMs }) {
  const ttl = ttlMs ?? SYNC_PAIRING_TOKEN_TTL_MS;
  const sessions = new Map(); // pairingToken -> { pin, host, expiresAt, consumed }

  function pickHost() {
    return hostCandidates && hostCandidates.length ? hostCandidates[0] : "127.0.0.1";
  }

  function startPairing() {
    const pairingToken = generateToken(SYNC_PAIRING_TOKEN_BYTES);
    const pin = String(Math.floor(Math.random() * 10 ** SYNC_PIN_DIGITS)).padStart(SYNC_PIN_DIGITS, "0");
    const host = pickHost();
    const expiresAt = Date.now() + ttl;
    sessions.set(pairingToken, { pin, host, expiresAt, consumed: false });
    const qrPayload = `https://${host}:${port}/pair?token=${pairingToken}`;
    return { pairingToken, pin, qrPayload, expiresAt };
  }

  function consumePairing({ token, name, platform }) {
    const session = sessions.get(token);
    if (!session) throw new Error("invalid or expired pairing token");
    if (session.consumed) throw new Error("invalid or expired pairing token");
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      throw new Error("expired pairing token");
    }
    session.consumed = true;
    sessions.delete(token);
    const deviceToken = generateToken(32); // full device token (SYNC_DEVICE_TOKEN_BYTES)
    return { deviceToken, deviceId: null }; // deviceId assigned by the device store on registration
  }

  function currentSession() {
    // for the UI to poll the QR/PIN while a pairing is pending
    const entry = [...sessions.entries()].find(([, s]) => !s.consumed && Date.now() <= s.expiresAt);
    if (!entry) return null;
    const [token, s] = entry;
    return { pairingToken: token, pin: s.pin, qrPayload: `https://${s.host}:${port}/pair?token=${token}`, expiresAt: s.expiresAt };
  }

  function cancel() {
    sessions.clear();
  }

  return { startPairing, consumePairing, currentSession, cancel };
}

module.exports = { createPairingController };
```

Note: the controller returns a raw `deviceToken`; the caller (sync-server wiring, Task 14) is responsible for passing it to `sync-devices.registerDevice` so the hash is stored and the `deviceId` is assigned. This keeps the pairing controller free of DB coupling.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-pairing.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/sync-pairing.cjs electron/sync-pairing.test.cjs
git commit -m "feat(sync): ephemeral pairing tokens with TTL + QR payload + PIN"
```

---

### Task 12: REST route table (maps HTTP → backend commands)

**Files:**
- Create: `electron/sync-routes.cjs`
- Create: `electron/sync-routes.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `electron/sync-routes.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { createRouteResolver } = require("./sync-routes.cjs");

function makeResolver() {
  const calls = [];
  const backend = {
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "list_pages") return [{ id: "p1", title: "Page One" }];
      if (command === "get_page") return { id: args.id, title: "got" };
      if (command === "create_page") return { id: args.id, title: args.title };
      return undefined;
    },
  };
  const devices = {
    lookupByToken: (t) => (t === "good" ? { device_id: "dev:1" } : null),
    touchLastSeen: () => {},
  };
  return { resolver: createRouteResolver({ backend, devices }), calls };
}

test("GET /pages maps to list_pages", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/pages", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, [{ id: "p1", title: "Page One" }]);
  assert.strictEqual(calls[0].command, "list_pages");
});

test("GET /pages?since= ignores since in MVP (returns full list) but accepts the param", async () => {
  const { resolver } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/pages?since=2026-01-01T00:00:00Z", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 200);
});

test("PUT /pages/:id maps to update_page with id + updates + updatedAt", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({
    method: "PUT",
    path: "/pages/p1",
    headers: {},
    body: { title: "New", content: "xyz" },
    authToken: "good",
  });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(calls[0].command, "update_page");
  assert.strictEqual(calls[0].args.id, "p1");
  assert.deepStrictEqual(calls[0].args.updates.title, "New");
  assert.ok(calls[0].args.updatedAt);
});

test("DELETE /pages/:id maps to delete_page", async () => {
  const { resolver, calls } = makeResolver();
  const res = await resolver.resolve({ method: "DELETE", path: "/pages/p1", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(calls[0].command, "delete_page");
});

test("unauthenticated request is 401", async () => {
  const { resolver } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/pages", headers: {}, body: null, authToken: null });
  assert.strictEqual(res.status, 401);
});

test("unknown path is 404", async () => {
  const { resolver } = makeResolver();
  const res = await resolver.resolve({ method: "GET", path: "/nope", headers: {}, body: null, authToken: "good" });
  assert.strictEqual(res.status, 404);
});

test("POST /pair is unauthenticated and consumes the pairing token", async () => {
  let paired = null;
  const backend = { invoke: async () => undefined };
  const devices = {
    lookupByToken: () => null,
    registerDevice: ({ name, platform, token }) => (paired = { name, platform, token, deviceId: "dev:x" }),
    touchLastSeen: () => {},
  };
  const pairing = { consumePairing: ({ token, name, platform }) => ({ deviceToken: "dt-" + token, deviceId: null }) };
  const resolver = createRouteResolver({ backend, devices, pairing });
  const res = await resolver.resolve({
    method: "POST",
    path: "/pair",
    headers: {},
    body: { token: "pair-token", name: "iPhone", platform: "ios" },
    authToken: null,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.deviceToken, "dt-pair-token");
  assert.deepStrictEqual(paired.name, "iPhone");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-routes.test.cjs`
Expected: FAIL — `Cannot find module './sync-routes.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `electron/sync-routes.cjs`:

```javascript
const { assertSafeInvokeArgs } = require("./backend-helpers.cjs");

function parsePath(url) {
  const [pathname, search] = url.split("?");
  const query = {};
  if (search) {
    for (const part of search.split("&")) {
      const [k, v] = part.split("=");
      if (k) query[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
    }
  }
  return { pathname, query };
}

function createRouteResolver({ backend, devices, pairing }) {
  async function requireDevice(authToken) {
    if (!authToken) return null;
    const device = devices.lookupByToken(authToken);
    if (!device) return null;
    devices.touchLastSeen(device.device_id);
    return device;
  }

  async function resolve({ method, path, headers, body, authToken }) {
    const { pathname, query } = parsePath(path);

    // Pairing is the only unauthenticated route.
    if (method === "POST" && pathname === "/pair") {
      if (!pairing) return { status: 501, body: { error: "pairing disabled" } };
      const { token, name, platform } = body || {};
      if (!token || !name || !platform) return { status: 400, body: { error: "token, name, platform required" } };
      let result;
      try {
        result = pairing.consumePairing({ token, name, platform });
      } catch (err) {
        return { status: 401, body: { error: err.message } };
      }
      const registered = devices.registerDevice({ name, platform, token: result.deviceToken });
      return { status: 200, body: { deviceToken: result.deviceToken, deviceId: registered.device_id } };
    }

    // Everything else requires a valid device token.
    const device = await requireDevice(authToken);
    if (!device) return { status: 401, body: { error: "unauthorized" } };

    try {
      if (method === "GET" && pathname === "/pages") {
        // MVP: `since` is accepted for forward compatibility but IGNORED — we
        // return the full active page list. Spec §4 calls for incremental sync
        // (GET /pages?since=<cursor>); the desktop-side filter by updated_at is
        // deferred to a Phase 2.5 task. The mobile client already supports
        // incremental pull locally (compares updated_at against its own
        // last_pulled_cursor), so no wire-format change will be needed when the
        // server-side filter lands.
        const pages = await backend.invoke("list_pages", {});
        return { status: 200, body: pages };
      }
      if (method === "GET" && pathname.startsWith("/pages/")) {
        const id = decodeURIComponent(pathname.slice("/pages/".length));
        const page = await backend.invoke("get_page", { id });
        if (!page) return { status: 404, body: { error: "not found" } };
        return { status: 200, body: page };
      }
      if (method === "PUT" && pathname.startsWith("/pages/")) {
        const id = decodeURIComponent(pathname.slice("/pages/".length));
        const updates = body && typeof body === "object" ? body : {};
        assertSafeInvokeArgs("update_page", { id, updates, updatedAt: new Date().toISOString() });
        await backend.invoke("update_page", { id, updates, updatedAt: new Date().toISOString() });
        return { status: 204, body: null };
      }
      if (method === "POST" && pathname === "/pages") {
        const { id, title, parentId } = body || {};
        if (!id) return { status: 400, body: { error: "id required" } };
        await backend.invoke("create_page", { id, title, parentId, createdAt: new Date().toISOString() });
        return { status: 201, body: { id } };
      }
      if (method === "DELETE" && pathname.startsWith("/pages/")) {
        const id = decodeURIComponent(pathname.slice("/pages/".length));
        await backend.invoke("delete_page", { id });
        return { status: 204, body: null };
      }
      return { status: 404, body: { error: "not found" } };
    } catch (err) {
      return { status: 500, body: { error: String(err.message || err) } };
    }
  }

  return { resolve };
}

module.exports = { createRouteResolver };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-routes.test.cjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/sync-routes.cjs electron/sync-routes.test.cjs
git commit -m "feat(sync): REST route resolver mapping HTTP to backend.invoke"
```

---

### Task 13: Private-interface binding + port selection + rate limit

**Files:**
- Create: `electron/sync-network.cjs`
- Create: `electron/sync-network.test.cjs`

- [ ] **Step 1: Write the failing test**

Create `electron/sync-network.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { isPrivateHost, pickPort } = require("./sync-network.cjs");

test("isPrivateHost accepts RFC1918 addresses", () => {
  assert.strictEqual(isPrivateHost("192.168.1.5"), true);
  assert.strictEqual(isPrivateHost("10.0.0.1"), true);
  assert.strictEqual(isPrivateHost("172.16.0.1"), true);
  assert.strictEqual(isPrivateHost("172.31.255.255"), true);
});

test("isPrivateHost rejects public addresses", () => {
  assert.strictEqual(isPrivateHost("8.8.8.8"), false);
  assert.strictEqual(isPrivateHost("172.32.0.1"), false); // outside the private 172.16/12 range
  assert.strictEqual(isPrivateHost("203.0.113.5"), false);
});

test("isPrivateHost accepts loopback", () => {
  assert.strictEqual(isPrivateHost("127.0.0.1"), true);
});

test("pickPort returns a free port in the configured range", async () => {
  const port = await pickPort({ start: 43200, end: 43210 });
  assert.ok(port >= 43200 && port <= 43210);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-network.test.cjs`
Expected: FAIL — `Cannot find module './sync-network.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `electron/sync-network.cjs`:

```javascript
const net = require("node:net");

function ipv4ToLong(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inRange(ip, base, mask) {
  return (ipv4ToLong(ip) & mask) === (base & mask);
}

const RFC1918 = [
  { base: ipv4ToLong("10.0.0.0"), mask: 0xff000000 },
  { base: ipv4ToLong("172.16.0.0"), mask: 0xffff0000 },
  { base: ipv4ToLong("192.168.0.0"), mask: 0xffff0000 },
];

function isPrivateHost(host) {
  if (host === "127.0.0.1" || host === "localhost") return true;
  // IPv6 loopback / link-local
  if (host === "::1" || host.startsWith("fe80")) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // not an IPv4 literal
  const value = ipv4ToLong(host);
  return RFC1918.some((range) => (value & range.mask) === (range.base & range.mask));
}

function pickPort({ start, end }) {
  return new Promise((resolve, reject) => {
    function tryAt(port) {
      if (port > end) return reject(new Error(`no free port in ${start}-${end}`));
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => tryAt(port + 1));
      srv.listen(port, "0.0.0.0", () => {
        const chosen = srv.address().port;
        srv.close(() => resolve(chosen));
      });
    }
    tryAt(start);
  });
}

module.exports = { isPrivateHost, pickPort };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-network.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/sync-network.cjs electron/sync-network.test.cjs
git commit -m "feat(sync): private-host validation + free-port picker"
```

---

### Task 14: The HTTPS sync server (lifecycle, TLS, rate limit, dispatch)

**Files:**
- Create: `electron/sync-server.cjs`
- Create: `electron/sync-server.test.cjs`

- [ ] **Step 1: Write the failing test (end-to-end server ↔ simulated client)**

Create `electron/sync-server.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const https = require("node:https");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { runSyncDeviceMigration, SYNC_DEVICE_TOKEN_BYTES, SYNC_PORT_RANGE_START, SYNC_PORT_RANGE_END } = require("./backend-helpers.cjs");
const { generateToken } = require("./sync-tokens.cjs");
const { createSyncDeviceStore } = require("./sync-devices.cjs");
const { createPairingController } = require("./sync-pairing.cjs");
const { createRouteResolver } = require("./sync-routes.cjs");
const { createSyncServer } = require("./sync-server.cjs");

function tempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shelf-sync-"));
}

function makeStack() {
  const configDir = tempConfigDir();
  const db = new DatabaseSync(":memory:");
  runSyncDeviceMigration(db);
  const pages = new Map();
  const backend = {
    invoke: async (command, args) => {
      if (command === "list_pages") return [...pages.values()];
      if (command === "get_page") return pages.get(args.id) ?? null;
      if (command === "update_page") { const p = pages.get(args.id); pages.set(args.id, { ...p, ...args.updates, updated_at: args.updatedAt }); return; }
      if (command === "create_page") { pages.set(args.id, { id: args.id, title: args.title }); return; }
      if (command === "delete_page") { const p = pages.get(args.id); if (p) pages.set(args.id, { ...p, is_deleted: 1 }); return; }
    },
  };
  const devices = createSyncDeviceStore(db);
  const pairing = createPairingController({ port: 0, hostCandidates: ["127.0.0.1"], certFingerprint: "" });
  const resolver = createRouteResolver({ backend, devices, pairing });
  return { configDir, db, devices, pairing, resolver, pages };
}

function request(server, { method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        method,
        hostname: "127.0.0.1",
        port: server.port,
        path,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        rejectUnauthorized: false, // self-signed test cert
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("e2e: list_pages is 401 without token, 200 with a registered device token", async () => {
  const stack = makeStack();
  const server = createSyncServer({ configDir: stack.configDir, resolver: stack.resolver, portRange: { start: 43200, end: 43299 } });
  await server.start();
  try {
    const unauth = await request(server, { method: "GET", path: "/pages" });
    assert.strictEqual(unauth.status, 401);

    const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
    stack.devices.registerDevice({ name: "iPhone", platform: "ios", token });
    const auth = await request(server, { method: "GET", path: "/pages", token });
    assert.strictEqual(auth.status, 200);
    assert.ok(Array.isArray(auth.body));
  } finally {
    await server.stop();
    fs.rmSync(stack.configDir, { recursive: true, force: true });
  }
});

test("e2e: PUT a page then GET it back", async () => {
  const stack = makeStack();
  const server = createSyncServer({ configDir: stack.configDir, resolver: stack.resolver, portRange: { start: 43200, end: 43299 } });
  await server.start();
  try {
    const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
    stack.devices.registerDevice({ name: "iPhone", platform: "ios", token });
    const put = await request(server, { method: "PUT", path: "/pages/p1", body: { title: "Hello", content: "world" }, token });
    assert.strictEqual(put.status, 204);
    const get = await request(server, { method: "GET", path: "/pages/p1", token });
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.body.title, "Hello");
  } finally {
    await server.stop();
    fs.rmSync(stack.configDir, { recursive: true, force: true });
  }
});

test("e2e: a revoked device token is rejected", async () => {
  const stack = makeStack();
  const server = createSyncServer({ configDir: stack.configDir, resolver: stack.resolver, portRange: { start: 43200, end: 43299 } });
  await server.start();
  try {
    const token = generateToken(SYNC_DEVICE_TOKEN_BYTES);
    const dev = stack.devices.registerDevice({ name: "iPhone", platform: "ios", token });
    stack.devices.revokeDevice(dev.device_id);
    const res = await request(server, { method: "GET", path: "/pages", token });
    assert.strictEqual(res.status, 401);
  } finally {
    await server.stop();
    fs.rmSync(stack.configDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-server.test.cjs`
Expected: FAIL — `Cannot find module './sync-server.cjs'`.

- [ ] **Step 3: Write the implementation**

Create `electron/sync-server.cjs`:

```javascript
const https = require("node:https");
const { ensureSyncCert } = require("./sync-certs.cjs");
const { pickPort } = require("./sync-network.cjs");
const { SYNC_RATE_LIMIT_MAX_PER_MINUTE } = require("./backend-helpers.cjs");

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

function createRateLimiter(maxPerMinute) {
  const buckets = new Map(); // deviceId -> { count, windowStart }
  function hit(deviceId) {
    const now = Date.now();
    let b = buckets.get(deviceId);
    if (!b || now - b.windowStart > 60_000) {
      b = { count: 0, windowStart: now };
      buckets.set(deviceId, b);
    }
    b.count += 1;
    return b.count <= maxPerMinute;
  }
  return { hit };
}

function createSyncServer({ configDir, resolver, portRange }) {
  let server = null;
  let port = null;
  const limiter = createRateLimiter(SYNC_RATE_LIMIT_MAX_PER_MINUTE);

  async function start() {
    const { cert, key } = ensureSyncCert(configDir);
    port = await pickPort(portRange);
    server = https.createServer({ cert, key }, async (req, res) => {
      try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
        const body = await readBody(req);
        const result = await resolver.resolve({ method: req.method, path: req.url, headers: req.headers, body, authToken: token });
        // rate limit only for authenticated requests (device is attached by resolver via lookup)
        // — resolver already touched last_seen; we additionally throttle per token string.
        const key2 = token || "anon";
        if (!limiter.hit(key2)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "rate limit" }));
          return;
        }
        res.writeHead(result.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(result.body === null || result.body === undefined ? "" : JSON.stringify(result.body));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    });
    await new Promise((resolve) => server.listen(port, "0.0.0.0", resolve));
    return { port };
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
    port = null;
  }

  function getPort() { return port; }

  return { start, stop, get port() { return port; } };
}

module.exports = { createSyncServer };
```

Note on binding address: `server.listen(port, "0.0.0.0", ...)` binds all interfaces for the test (loopback). In production wiring (Task 16, `main.cjs`), the server should additionally check that the host it advertises via mDNS is private (`isPrivateHost`) and refuse to advertise/start if only a public interface is present. The bind itself stays on `0.0.0.0` because the device may roam between private networks; the **advertisement** is gated on privacy. This is captured in Task 16.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-server.test.cjs`
Expected: PASS (3 e2e tests).

- [ ] **Step 5: Commit**

```bash
git add electron/sync-server.cjs electron/sync-server.test.cjs
git commit -m "feat(sync): HTTPS sync server with TLS, auth, and rate limiting"
```

---

### Task 15: mDNS advertisement

**Files:**
- Create: `electron/sync-mdns.cjs`
- Create: `electron/sync-mdns.test.cjs`
- Modify: `package.json` (add `bonjour-service` dependency)

- [ ] **Step 1: Add the dependency**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm install bonjour-service`

- [ ] **Step 2: Write the failing test (mocked service)**

Create `electron/sync-mdns.test.cjs`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { createMdnsAdvertiser } = require("./sync-mdns.cjs");

function mockBonjour() {
  const published = [];
  const destroyed = [];
  return {
    published,
    destroyed,
    Bonjour: function () {
      this.publish = (opts) => {
        published.push(opts);
        return { stop: () => destroyed.push(opts) };
      };
      this.destroy = () => {};
    },
  };
}

test("start advertises _shelf-sync._tcp with port and name, stop tears it down", () => {
  const mock = mockBonjour();
  const adv = createMdnsAdvertiser({ bonjourModule: mock, name: "Shelf on Marco's MacBook", port: 43201, txt: { v: "0.5.0" } });
  adv.start();
  assert.strictEqual(mock.published.length, 1);
  assert.strictEqual(mock.published[0].type, "shelf-sync");
  assert.strictEqual(mock.published[0].protocol, "tcp");
  assert.strictEqual(mock.published[0].port, 43201);
  assert.strictEqual(mock.published[0].name, "Shelf on Marco's MacBook");
  adv.stop();
  assert.strictEqual(mock.destroyed.length, 1);
});

test("start without calling is a no-op", () => {
  const mock = mockBonjour();
  const adv = createMdnsAdvertiser({ bonjourModule: mock, name: "x", port: 1 });
  adv.stop(); // nothing started — no throw
  assert.strictEqual(mock.published.length, 0);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-mdns.test.cjs`
Expected: FAIL — `Cannot find module './sync-mdns.cjs'`.

- [ ] **Step 4: Write the implementation**

Create `electron/sync-mdns.cjs`:

```javascript
function createMdnsAdvertiser({ bonjourModule, name, port, txt }) {
  // bonjourModule is injected for testing; defaults to the real library.
  const real = bonjourModule || require("bonjour-service");
  const Bonjour = real.Bonjour || real;
  let bonjour = null;
  let service = null;

  function start() {
    if (service) return;
    bonjour = new Bonjour();
    service = bonjour.publish({
      name,
      type: "shelf-sync",
      protocol: "tcp",
      port,
      txt: txt || {},
    });
  }

  function stop() {
    if (service) {
      service.stop();
      service = null;
    }
    if (bonjour) {
      bonjour.destroy();
      bonjour = null;
    }
  }

  return { start, stop };
}

module.exports = { createMdnsAdvertiser };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/marcodignoti/Developer/Shelf && node --test electron/sync-mdns.test.cjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add electron/sync-mdns.cjs electron/sync-mdns.test.cjs package.json package-lock.json
git commit -m "feat(sync): mDNS advertiser for _shelf-sync._tcp (bonjour-service)"
```

---

### Task 16: Wire the server into Electron lifecycle (`main.cjs`) + preload + desktop wrappers

**Files:**
- Modify: `electron/main.cjs` (start/stop server, gate advertisement on private host)
- Modify: `electron/preload.cjs` (expose `window.openNotion.sync.*`)
- Modify: `src/lib/desktopCommands.ts` (add sync command constants)
- Modify: `src/lib/desktop.ts` (typed wrappers)

- [ ] **Step 1: Add the IPC command constants**

In `src/lib/desktopCommands.ts`, add a new `sync` command namespace (follow the existing constant style):

```typescript
export const SYNC_COMMANDS = {
  enable: "sync_enable",
  disable: "sync_disable",
  getStatus: "sync_get_status",
  getDevices: "sync_get_devices",
  revokeDevice: "sync_revoke_device",
  startPairing: "sync_start_pairing",
  cancelPairing: "sync_cancel_pairing",
  getPairing: "sync_get_pairing",
} as const;
```

- [ ] **Step 2: Add typed wrappers in `src/lib/desktop.ts`**

Add (matching the existing `invoke(...)` wrapper style in that file):

```typescript
import { SYNC_COMMANDS } from "./desktopCommands";

export interface SyncDevice {
  device_id: string;
  name: string;
  platform: string;
  paired_at: string;
  last_seen: string | null;
}

export interface SyncStatus {
  enabled: boolean;
  port: number | null;
  host: string | null;
  certFingerprint: string | null;
}

export interface SyncPairing {
  pairingToken: string;
  pin: string;
  qrPayload: string;
  expiresAt: number;
}

export async function syncEnable(): Promise<SyncStatus> {
  return invoke(SYNC_COMMANDS.enable);
}
export async function syncDisable(): Promise<void> {
  await invoke(SYNC_COMMANDS.disable);
}
export async function syncGetStatus(): Promise<SyncStatus> {
  return invoke(SYNC_COMMANDS.getStatus);
}
export async function syncGetDevices(): Promise<SyncDevice[]> {
  return invoke(SYNC_COMMANDS.getDevices);
}
export async function syncRevokeDevice(deviceId: string): Promise<void> {
  await invoke(SYNC_COMMANDS.revokeDevice, { deviceId });
}
export async function syncStartPairing(): Promise<SyncPairing> {
  return invoke(SYNC_COMMANDS.startPairing);
}
export async function syncCancelPairing(): Promise<void> {
  await invoke(SYNC_COMMANDS.cancelPairing);
}
export async function syncGetPairing(): Promise<SyncPairing | null> {
  return invoke(SYNC_COMMANDS.getPairing);
}
```

- [ ] **Step 3: Expose them in preload**

In `electron/preload.cjs`, add a `sync` group to the exposed `openNotion` object (mirror the existing groups like `externalAssistant`). Use `ipcRenderer.invoke(channel, ...args)` for each:

```javascript
    sync: {
      enable: () => ipcRenderer.invoke("sync_enable"),
      disable: () => ipcRenderer.invoke("sync_disable"),
      getStatus: () => ipcRenderer.invoke("sync_get_status"),
      getDevices: () => ipcRenderer.invoke("sync_get_devices"),
      revokeDevice: (deviceId) => ipcRenderer.invoke("sync_revoke_device", deviceId),
      startPairing: () => ipcRenderer.invoke("sync_start_pairing"),
      cancelPairing: () => ipcRenderer.invoke("sync_cancel_pairing"),
      getPairing: () => ipcRenderer.invoke("sync_get_pairing"),
    },
```

- [ ] **Step 4: Wire the server lifecycle in `main.cjs`**

In `electron/main.cjs`, after the `ShelfBackend` is constructed, add a sync controller that holds an optional running server + advertiser. Handle each `sync_*` IPC channel via `ipcMain.handle`. The key parts:

```javascript
const os = require("node:os");
const { createSyncServer } = require("./sync-server.cjs");
const { createMdnsAdvertiser } = require("./sync-mdns.cjs");
const { createSyncDeviceStore } = require("./sync-devices.cjs");
const { createPairingController } = require("./sync-pairing.cjs");
const { createRouteResolver } = require("./sync-routes.cjs");
const { isPrivateHost } = require("./sync-network.cjs");
const { ensureSyncCert } = require("./sync-certs.cjs");

let syncState = null; // { server, advertiser, devices, pairing, resolver, host, port, fingerprint }

function privateHostCandidates() {
  const ifaces = os.networkInterfaces();
  const hosts = [];
  for (const list of Object.values(ifaces)) {
    for (const iface of list || []) {
      if (!iface.internal && iface.family === "IPv4" && isPrivateHost(iface.address)) {
        hosts.push(iface.address);
      }
    }
  }
  return hosts;
}

async function syncEnableInternal() {
  if (syncState) return syncStatusInternal();
  const hosts = privateHostCandidates();
  if (hosts.length === 0) {
    throw new Error("No private network interface found; sync cannot advertise safely.");
  }
  const host = hosts[0];
  const fingerprint = ensureSyncCert(backend.appConfigDir).fingerprint;
  const devices = createSyncDeviceStore(backend.db);
  const pairing = createPairingController({ port: 0, hostCandidates: [host], certFingerprint: fingerprint });
  const resolver = createRouteResolver({ backend, devices, pairing });
  const server = createSyncServer({ configDir: backend.appConfigDir, resolver, portRange: { start: SYNC_PORT_RANGE_START, end: SYNC_PORT_RANGE_END } });
  const { port } = await server.start();
  const advertiser = createMdnsAdvertiser({ name: `Shelf on ${os.hostname()}`, port, txt: { v: CURRENT_APP_VERSION } });
  advertiser.start();
  syncState = { server, advertiser, devices, pairing, resolver, host, port, fingerprint };
  return syncStatusInternal();
}

function syncStatusInternal() {
  if (!syncState) return { enabled: false, port: null, host: null, certFingerprint: null };
  return { enabled: true, port: syncState.port, host: syncState.host, certFingerprint: syncState.fingerprint };
}

async function syncDisableInternal() {
  if (!syncState) return;
  await syncState.advertiser.stop();
  await syncState.server.stop();
  syncState.pairing.cancel();
  syncState = null;
}

ipcMain.handle("sync_enable", async () => syncEnableInternal());
ipcMain.handle("sync_disable", async () => { await syncDisableInternal(); });
ipcMain.handle("sync_get_status", async () => syncStatusInternal());
ipcMain.handle("sync_get_devices", async () => syncState ? syncState.devices.listDevices() : []);
ipcMain.handle("sync_revoke_device", async (_e, deviceId) => { if (syncState) syncState.devices.revokeDevice(deviceId); });
ipcMain.handle("sync_start_pairing", async () => {
  if (!syncState) throw new Error("sync is not enabled");
  return syncState.pairing.startPairing();
});
ipcMain.handle("sync_cancel_pairing", async () => { if (syncState) syncState.pairing.cancel(); });
ipcMain.handle("sync_get_pairing", async () => syncState ? syncState.pairing.currentSession() : null);
```

Ensure `SYNC_PORT_RANGE_START`, `SYNC_PORT_RANGE_END`, `CURRENT_APP_VERSION` are imported from `./backend-helpers.cjs` at the top of `main.cjs` (they are already exported there). Also stop the server on `app.on("before-quit")`:

```javascript
app.on("before-quit", async () => { await syncDisableInternal(); });
```

- [ ] **Step 5: Build to confirm types are valid**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run build`
Expected: `tsc` passes (the new `src/lib/desktop.ts` types compile).

- [ ] **Step 6: Commit**

```bash
git add electron/main.cjs electron/preload.cjs src/lib/desktopCommands.ts src/lib/desktop.ts
git commit -m "feat(sync): wire sync server into Electron lifecycle + IPC bridge"
```

---

### Task 17: Settings UI — "Mobile sync" panel

**Files:**
- Modify: `src/components/SettingsModal.tsx` (add a "Mobile sync" section)

- [ ] **Step 1: Read the current SettingsModal to match its section pattern**

Run: `cd /Users/marcodignoti/Developer/Shelf && grep -n "section\|Section\|initialSection\|settingsSection" src/components/SettingsModal.tsx | head -30`

Match the existing section registration pattern (there is a `settingsSection` union and a list of sections in the modal).

- [ ] **Step 2: Add the section type**

In `SettingsModal.tsx`, extend the settings section union to include `"mobile-sync"` (find the existing union type for sections and add the member; follow the exact casing used there).

- [ ] **Step 3: Add the section component**

Add a `MobileSyncSection` component inside `SettingsModal.tsx` (or a new file `src/components/settings/MobileSyncSection.tsx` if the modal splits sections into files — match the existing convention). It:

- Loads status on mount via `syncGetStatus()`.
- Shows a toggle "Enable mobile sync" → calls `syncEnable()` / `syncDisable()`.
- When enabled, shows the host + port ("Shelf is reachable at `192.168.1.5:43201` on your local network").
- "Pair a device" button → `syncStartPairing()` → renders the QR (`qrPayload`) + the 6-digit PIN. Poll `syncGetPairing()` every 2s while pending so the QR/PIN stay fresh, stop polling on success/cancel/timeout.
- Lists paired devices (`syncGetDevices()`) with a "Revoke" button each (`syncRevokeDevice(id)`).
- Shows a privacy note: "Sync stays on your local network. Your notes are never sent to a cloud."

For QR rendering, add a tiny dependency: `npm install qrcode.react`. Use `<QRCode value={qrPayload} />`.

- [ ] **Step 4: Register the section in the modal navigation**

Add "Mobile sync" to the section list shown in the Settings sidebar (match the existing entries' icon + label style — use `lucide-react` icon `Smartphone` or `Wifi`).

- [ ] **Step 5: Build + run**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run build`
Expected: build passes.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.tsx src/components/settings package.json package-lock.json
git commit -m "feat(sync): Mobile sync settings panel (enable, pairing QR, devices)"
```

---

### Task 18: Smoke test + `sync:test` script + full gate

**Files:**
- Modify: `electron/smoke.cjs` (assert `sync_devices` table exists, server off by default)
- Modify: `package.json` (add `sync:test` script)

- [ ] **Step 1: Add smoke assertions**

In `electron/smoke.cjs`, after the backend is constructed for smoke, add:

```javascript
// Sync: devices table must exist; server must not start unless enabled.
const tableExists = backend.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_devices'").get();
assert.ok(tableExists, "sync_devices table should exist after backend construction");
```

(Adapt the exact assertion style already used in `smoke.cjs`.)

- [ ] **Step 2: Add the `sync:test` script**

In `package.json` `scripts`, add:

```json
    "sync:test": "node --test electron/sync-*.test.cjs",
```

- [ ] **Step 3: Run the sync test suite**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run sync:test`
Expected: all `sync-*.test.cjs` tests pass.

- [ ] **Step 4: Run the full scripts test runner**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run test:scripts`
Expected: all `scripts/*.test.cjs` + `electron/*.test.cjs` pass (including the new sync ones).

- [ ] **Step 5: Run the full gate**

Run: `cd /Users/marcodignoti/Developer/Shelf && npm run check`
Expected: build + unit + smoke + audit all green. (If `electron:smoke:visual`/`parity` are flaky under load, re-run the failing one in isolation per AGENTS.md.)

- [ ] **Step 6: Commit**

```bash
git add electron/smoke.cjs package.json
git commit -m "test(sync): smoke assertion for sync_devices + sync:test npm script"
```

---

### Task 19: Documentation

**Files:**
- Create: `docs/sync.md` (operator/developer-facing reference for the sync server)
- Modify: `AGENTS.md` (mention the new sync modules + `sync:test` command)

- [ ] **Step 1: Write `docs/sync.md`**

Cover: what the sync server is, how it's enabled (Settings → Mobile sync), the REST routes, the security model (TLS self-signed pinned at pairing, device tokens hashed, private-interface-only advertisement, rate limit), how to run `npm run sync:test`, and the fact that it is desktop-only in this phase (the mobile client is Phase 3).

- [ ] **Step 2: Update `AGENTS.md`**

In the architecture section, add a short bullet describing the sync server modules and point to `docs/sync.md`. Add `npm run sync:test` to the Commands list.

- [ ] **Step 3: Commit**

```bash
git add docs/sync.md AGENTS.md
git commit -m "docs(sync): local sync server reference + AGENTS.md note"
```

---

## Verification (end of plan)

- [ ] `npm run build` — TypeScript + Vite build clean.
- [ ] `npm test` — all Vitest unit tests pass (desktop + `packages/shared`).
- [ ] `npm run test:scripts` — all `node --test` files pass, including every `electron/sync-*.test.cjs`.
- [ ] `npm run sync:test` — the focused sync suite passes.
- [ ] `npm run check` — the full Electron gate is green.
- [ ] Manual: open Settings → Mobile sync, enable, scan the QR with any QR reader, confirm a device appears in the list and can be revoked.

**Phase 1+2 complete.** The desktop can now act as an encrypted local-network sync server for pages; the mobile client (Phase 3, separate plan) can be built against this REST API.
