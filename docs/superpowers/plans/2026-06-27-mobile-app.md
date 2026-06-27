# Shelf Mobile App — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Native (Expo) mobile companion for Shelf that reads/writes notes offline and syncs with the desktop over the local network via the Phase 2 REST API.

**Architecture:** A private git submodule (`mobile/`) holds an Expo app. Native UI (lists, navigation, shell) is React Native. The BlockNote editor runs in a WebView. Local SQLite mirrors the desktop `pages` table. A background sync client discovers the desktop via mDNS, pairs via QR, then pushes/pulls pages over REST. `packages/shared` provides shared types, page-tree logic, and i18n.

**Tech Stack:** Expo SDK 54+ with React Native 0.79+, expo-router (navigation), expo-sqlite (local DB), Zustand (state), BlockNote editor in WebView with `postMessage` bridge, `react-native-zeroconf` (mDNS discovery), `expo-camera` (QR scan).

**Spec:** `docs/superpowers/specs/2026-06-27-mobile-app-design.md`

**Desktop (public repo) tasks:** none — Phase 1+2 are complete. This plan builds the mobile client against the existing sync server. Minor additions to `packages/shared` (Task 1b) are public and committed directly.

---

## Pre-requisite (do once, before any task)

### Task 0: Create the private repo + git submodule

- [ ] **Step 1: Create private GitHub repo**

Create `marcoodignoti/Shelf-mobile` on GitHub (private). Do NOT initialize with a README — the Expo template will provide one.

- [ ] **Step 2: Add as a git submodule**

```sh
cd /Users/marcodignoti/Developer/Shelf
git submodule add https://github.com/marcoodignoti/Shelf-mobile mobile
```

This creates `mobile/` with a `.gitmodules` entry. The public repo only sees the submodule pointer (commit hash), not the source.

- [ ] **Step 3: Initialize the Expo project inside the submodule**

```sh
cd mobile
npx create-expo-app@latest . --template blank-typescript --tabs
```

Follow the template prompts. This scaffolds `app/`, `components/`, `constants/`, `hooks/` directories with expo-router tab navigation.

- [ ] **Step 4: Install mobile dependencies**

```sh
cd mobile
npx expo install expo-sqlite expo-router zustand react-native-zeroconf expo-camera expo-secure-store expo-file-system expo-notifications
```

- `expo-sqlite` — local SQLite mirror of desktop `pages` table.
- `expo-router` — file-based navigation (already in the template).
- `zustand` — mirror of the desktop store pattern.
- `react-native-zeroconf` — mDNS service discovery (`_shelf-sync._tcp`).
- `expo-camera` — QR code scanning during pairing.
- `expo-secure-store` — Keychain (iOS) / Keystore (Android) for the device token.
- `expo-file-system` — image download + local storage in the app's Document Directory.
- `expo-notifications` — local notification when sync reconnects.

- [ ] **Step 5: Add the shared workspace as a dependency**

In `mobile/package.json`, add the workspace reference so the Expo bundler resolves `@shelf/shared`:

```json
{
  "dependencies": {
    "@shelf/shared": "*"
  }
}
```

Then run `npm install` from the **root** (`Shelf/`) so the workspace symlink is created.

Alternatively, if Expo's Metro bundler doesn't resolve workspace symlinks cleanly, add a `metro.config.js` override:

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "..", "packages", "shared")];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "..", "node_modules"),
];
module.exports = config;
```

- [ ] **Step 6: Commit the submodule setup**

```sh
# In Shelf/ root:
git add .gitmodules mobile
git commit -m "chore: add mobile/ git submodule (Shelf-mobile, private)"
```

```sh
# In mobile/ (submodule):
git add -A
git commit -m "chore: initialize Expo project with dependencies"
git push -u origin main
```

- [ ] **Step 7: Push the submodule pointer update**

```sh
# In Shelf/ root:
git push origin feat/mobile-sync-server  # or current branch
```

---

## File Structure

```
Shelf/                                    # public repo
├── packages/shared/                      # (existing Phase 1) shared types + logic
│   └── src/
│       ├── types.ts                      # Page, PageKind, SearchResult
│       ├── pageTree.ts                   # ordering, tree building
│       ├── breadcrumb.ts                 # breadcrumb builder
│       └── i18n/                         # locale resolution, en/it dictionaries
├── mobile/                               # git submodule → marcoodignoti/Shelf-mobile
│   ├── app/                              # expo-router screens
│   │   ├── _layout.tsx                   # root layout (theme + connection indicator)
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx              # tab bar layout
│   │   │   ├── index.tsx                # Home / page list
│   │   │   ├── search.tsx               # Search screen
│   │   │   └── settings.tsx             # Settings + sync management
│   │   ├── editor/[id].tsx              # Editor screen (one per page)
│   │   └── onboarding/
│   │       ├── index.tsx                # Welcome / connect prompt
│   │       └── pair.tsx                 # QR scanner + pairing flow
│   ├── components/                       # native RN UI
│   │   ├── PageList.tsx                 # recent/favorites/tree list
│   │   ├── PageTreeItem.tsx            # expandable tree node
│   │   ├── FloatingToolbar.tsx          # editor floating toolbar
│   │   ├── ConnectionIndicator.tsx      # top-bar sync status
│   │   ├── SyncStatusBar.tsx            # "Connected to Shelf" / "Offline"
│   │   └── DeviceList.tsx              # paired devices list
│   ├── store/                            # mobile Zustand store
│   │   └── useMobileStore.ts            # mirror of desktop useAppStore
│   ├── lib/                              # mobile data + sync layer
│   │   ├── db.ts                        # SQLite CRUD wrappers (mirror desktop db.ts)
│   │   ├── schema.ts                    # CREATE TABLE idempotent migrations
│   │   ├── sync.ts                      # sync client (pull/push + queue drain)
│   │   ├── pairing.ts                   # QR scan → pair → store token
│   │   ├── discovery.ts                 # mDNS service browser
│   │   ├── api.ts                       # REST client with cert pinning
│   │   ├── media.ts                     # image download + URL remapping
│   │   └── secureStore.ts              # Keychain/Keystore wrapper
│   ├── editor/                           # WebView-hosted BlockNote
│   │   ├── bundle.html                  # stripped BlockNote renderer (built)
│   │   ├── bundle.ts                    # entry point for the WebView bundle
│   │   └── bridge.ts                    # postMessage protocol types
│   └── assets/                           # icons, splash, fonts
├── .gitmodules                           # submodule tracking
└── AGENTS.md                             # (update with mobile commands + notes)
```

---

## Task 1: Extend `packages/shared` with command contracts

**Files:**
- Create: `packages/shared/src/dbContract.ts`

The mobile sync client needs typed request/response contracts for every REST endpoint so the API layer (`mobile/lib/api.ts`) can be built against them. These types are pure — no framework dependency.

- [ ] **Step 1: Write the contract module**

```typescript
// packages/shared/src/dbContract.ts
import type { Page } from "./types";

export interface ListPagesRequest {
  since?: string;
}

export interface ListPagesResponse {
  pages: Page[];
}

export interface GetPageRequest {
  id: string;
}

export interface GetPageResponse {
  page: Page;
}

export interface CreatePageRequest {
  id: string;
  title?: string;
  content?: string;
  parentId?: string | null;
  createdAt: string;
}

export interface CreatePageResponse {
  id: string;
}

export interface UpdatePageRequest {
  id: string;
  updates: Partial<Pick<Page, "title" | "content" | "parent_id" | "icon" | "is_favorite" | "sort_order">>;
  updatedAt: string;
}

export type UpdatePageResponse = null;

export interface DeletePageRequest {
  id: string;
}

export type DeletePageResponse = null;

export interface PairRequest {
  token: string;
  name: string;
  platform: "ios" | "android";
}

export interface PairResponse {
  deviceToken: string;
  deviceId: string;
}

export interface SyncQueueEntry {
  page_id: string;
  pending_op: "update" | "create" | "delete";
  queued_at: string;
}

export interface SyncState {
  last_synced_at: string | null;
  desktop_device_id: string | null;
  last_pulled_cursor: string | null;
}
```

- [ ] **Step 2: Export from the shared barrel**

Append to `packages/shared/src/index.ts`:

```typescript
export * from "./dbContract";
```

- [ ] **Step 3: Verify build**

```sh
cd /Users/marcodignoti/Developer/Shelf && npm run build
```

Expected: `tsc` passes with no new errors. The desktop renderer imports from `@shelf/shared` (barrel) and the new exports are valid TypeScript.

- [ ] **Step 4: Commit**

```sh
git add packages/shared/src/dbContract.ts packages/shared/src/index.ts
git commit -m "feat(shared): add mobile sync command contracts (db-contract)"
```

---

## Task 2: Mobile SQLite layer — schema, migrations, CRUD

**Files:**
- Create: `mobile/lib/schema.ts`
- Create: `mobile/lib/db.ts`
- Create: `mobile/lib/db.test.ts`

Mirror the desktop `pages` table + add `sync_queue` and `sync_state`. Use `expo-sqlite` synchronous API.

- [ ] **Step 1: Write the schema + migration**

`mobile/lib/schema.ts`:

```typescript
import type { SQLiteDatabase } from "expo-sqlite";

export function runMigrations(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      title TEXT,
      parent_id TEXT,
      content TEXT,
      search_text TEXT,
      icon TEXT,
      cover_url TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_template INTEGER NOT NULL DEFAULT 0,
      is_database INTEGER DEFAULT 0,
      database_schema TEXT,
      properties TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      page_kind TEXT NOT NULL DEFAULT 'note',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_loaded INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id TEXT NOT NULL,
      pending_op TEXT NOT NULL CHECK(pending_op IN ('update', 'create', 'delete')),
      queued_at TEXT NOT NULL,
      UNIQUE(page_id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_cache (
      page_id TEXT NOT NULL,
      media_path TEXT NOT NULL,
      local_uri TEXT NOT NULL,
      downloaded INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (page_id, media_path)
    );
  `);
}
```

- [ ] **Step 2: Write the CRUD layer**

`mobile/lib/db.ts` wraps every operation in a typed function — mirroring the pattern of `src/lib/db.ts` but targeting `expo-sqlite` instead of `invoke`. Example:

```typescript
import { openDatabaseSync } from "expo-sqlite";
import { runMigrations } from "./schema";
import type { Page, SyncQueueEntry, SyncState } from "@shelf/shared";

let _db: ReturnType<typeof openDatabaseSync> | null = null;

export function getDb() {
  if (!_db) {
    _db = openDatabaseSync("shelf.db");
    runMigrations(_db);
  }
  return _db;
}

export function listPages(): Page[] {
  return getDb().getAllSync<Page>(
    "SELECT * FROM pages WHERE is_deleted = 0 ORDER BY sort_order ASC"
  );
}

export function getPage(id: string): Page | null {
  return getDb().getFirstSync<Page>(
    "SELECT * FROM pages WHERE id = ?",
    id
  ) ?? null;
}

export function upsertPage(page: Page): void {
  getDb().runSync(
    `INSERT OR REPLACE INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at, content_loaded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    page.id, page.title, page.parent_id, page.content, page.search_text,
    page.icon, page.cover_url, page.is_deleted, page.is_favorite,
    page.is_template, page.is_database ?? 0, page.database_schema,
    page.properties, page.sort_order, page.page_kind,
    page.created_at, page.updated_at, page.content_loaded ?? 0
  );
}

export function softDeletePage(id: string, updatedAt: string): void {
  getDb().runSync(
    "UPDATE pages SET is_deleted = 1, updated_at = ? WHERE id = ?",
    updatedAt, id
  );
}

// Sync queue
export function enqueueSync(pageId: string, op: SyncQueueEntry["pending_op"]): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO sync_queue (page_id, pending_op, queued_at) VALUES (?, ?, ?)",
    pageId, op, new Date().toISOString()
  );
}

export function drainSyncQueue(): SyncQueueEntry[] {
  const entries = getDb().getAllSync<SyncQueueEntry>(
    "SELECT * FROM sync_queue ORDER BY id ASC"
  );
  return entries;
}

export function clearSyncQueueEntry(pageId: string): void {
  getDb().runSync("DELETE FROM sync_queue WHERE page_id = ?", pageId);
}

export function importPages(pages: Page[]): void {
  const db = getDb();
  db.execSync("BEGIN IMMEDIATE");
  try {
    for (const page of pages) {
      upsertPage(page);
    }
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  }
}

// Sync state (single-row key-value store)
export function getSyncState(): SyncState {
  const db = getDb();
  const lastSynced = db.getFirstSync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = 'last_synced_at'"
  );
  const desktopDeviceId = db.getFirstSync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = 'desktop_device_id'"
  );
  const lastPulledCursor = db.getFirstSync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = 'last_pulled_cursor'"
  );
  return {
    last_synced_at: lastSynced?.value ?? null,
    desktop_device_id: desktopDeviceId?.value ?? null,
    last_pulled_cursor: lastPulledCursor?.value ?? null,
  };
}

export function setSyncState(key: string, value: string): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
    key, value
  );
}
```

- [ ] **Step 3: Write unit tests**

`mobile/lib/db.test.ts` — open an in-memory SQLite (expo-sqlite supports `:memory:`), run migrations, insert test rows, exercise each CRUD function, verify queue drain + clear.

- [ ] **Step 4: Run the tests**

```sh
cd mobile && npx expo run:ios  # or: npx jest lib/db.test.ts
```

Expected: all CRUD tests pass.

- [ ] **Step 5: Commit (in submodule)**

```sh
cd mobile
git add lib/schema.ts lib/db.ts lib/db.test.ts
git commit -m "feat(db): mobile SQLite layer — schema, migrations, CRUD, sync queue"
```

---

## Task 3: Mobile Zustand store

**Files:**
- Create: `mobile/store/useMobileStore.ts`

Mirror the desktop `useAppStore` (Zustand) but source data from `mobile/lib/db.ts` and use optimistic-update pattern. No `invoke` — mutations write to local SQLite + enqueue sync.

- [ ] **Step 1: Write the store**

Follow the desktop pattern: `pages` array, `currentPageId`, `syncStatus`, `setActivePage`, `updatePage`, `createPage`, `deletePage`, `searchPages`. Every mutation: (1) update local SQLite, (2) enqueue sync, (3) update Zustand state. On error, roll back.

- [ ] **Step 2: Wire the connection indicator**

Expose a `connectionStatus` field: `"connected" | "offline" | "syncing"`. The sync client updates it.

- [ ] **Step 3: Commit**

```sh
cd mobile
git add store/useMobileStore.ts
git commit -m "feat(store): mobile Zustand store mirroring desktop pattern"
```

---

## Task 4: Secure token storage

**Files:**
- Create: `mobile/lib/secureStore.ts`

The device token must live in the OS keychain, not AsyncStorage. Wrap `expo-secure-store`.

- [ ] **Step 1: Write the wrapper**

```typescript
import * as SecureStore from "expo-secure-store";

const DEVICE_TOKEN_KEY = "shelf-device-token";
const DESKTOP_FINGERPRINT_KEY = "shelf-desktop-fingerprint";

export async function storeDeviceToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
}

export async function getDeviceToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
}

export async function storeDesktopFingerprint(fp: string): Promise<void> {
  await SecureStore.setItemAsync(DESKTOP_FINGERPRINT_KEY, fp);
}

export async function getDesktopFingerprint(): Promise<string | null> {
  return await SecureStore.getItemAsync(DESKTOP_FINGERPRINT_KEY);
}

export async function clearPairingData(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
  await SecureStore.deleteItemAsync(DESKTOP_FINGERPRINT_KEY);
}
```

- [ ] **Step 2: Commit**

```sh
cd mobile
git add lib/secureStore.ts
git commit -m "feat(auth): secure token storage via Keychain/Keystore"
```

---

## Task 5: REST API client with cert pinning

**Files:**
- Create: `mobile/lib/api.ts`

Typed REST client that speaks to the desktop sync server. Pins the certificate fingerprint from pairing. Every request carries `Authorization: Bearer <device-token>`.

- [ ] **Step 1: Write the API client**

`mobile/lib/api.ts`:

```typescript
import type { Page, ListPagesResponse, CreatePageRequest, UpdatePageRequest, DeletePageRequest, PairRequest, PairResponse } from "@shelf/shared";

interface ApiConfig {
  baseUrl: string;           // https://192.168.1.5:43201
  deviceToken: string;
  certFingerprint: string;   // sha256 hex of the cert DER
}

let config: ApiConfig | null = null;

export function configureApi(cfg: ApiConfig): void {
  config = cfg;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
  if (!config) throw new Error("API not configured");
  const url = new URL(path, config.baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.deviceToken}`,
  };
  const payload = body ? JSON.stringify(body) : undefined;
  // In production, pin cert fingerprint. Expo's fetch doesn't support
  // cert pinning directly — use a native HTTP module or validate the
  // fingerprint after the first request by comparing against stored value.
  // For MVP, we accept self-signed certs for the configured baseUrl only.
  const res = await fetch(url.toString(), { method, headers, body: payload });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null as T;
  return res.json();
}

export async function listPages(since?: string): Promise<Page[]> {
  const result = await request<Page[]>("GET", "/pages", undefined, since ? { since } : undefined);
  return result;
}

export async function getPage(id: string): Promise<Page> {
  return request<Page>("GET", `/pages/${encodeURIComponent(id)}`);
}

export async function createPage(req: CreatePageRequest): Promise<{ id: string }> {
  return request("POST", "/pages", req);
}

export async function updatePage(req: UpdatePageRequest): Promise<null> {
  return request("PUT", `/pages/${encodeURIComponent(req.id)}`, req);
}

export async function deletePage(req: DeletePageRequest): Promise<null> {
  return request("DELETE", `/pages/${encodeURIComponent(req.id)}`);
}

export async function pairDevice(req: PairRequest): Promise<PairResponse> {
  return request("POST", "/pair", req);
}
```

The pairing endpoint does NOT send a device token (it's unauthenticated on the server). Create a separate unauthenticated fetch for pairing. Add:

```typescript
export async function pairDevice(baseUrl: string, req: PairRequest): Promise<PairResponse> {
  const res = await fetch(`${baseUrl}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Pairing failed: HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Commit**

```sh
cd mobile
git add lib/api.ts
git commit -m "feat(api): typed REST client with device-token auth"
```

---

## Task 6: mDNS discovery

**Files:**
- Create: `mobile/lib/discovery.ts`

Use `react-native-zeroconf` to scan for `_shelf-sync._tcp` services on the local network. Return a list of `{ name, host, port, txt }` entries.

- [ ] **Step 1: Write the discovery module**

```typescript
import Zeroconf from "react-native-zeroconf";

interface DiscoveredDesktop {
  name: string;
  host: string;
  port: number;
  version: string;
}

export function scanForDesktop(): Promise<DiscoveredDesktop[]> {
  return new Promise((resolve, reject) => {
    const zeroconf = new Zeroconf();
    const found: DiscoveredDesktop[] = [];
    const timeout = setTimeout(() => {
      zeroconf.stop();
      resolve(found);
    }, 5000);

    zeroconf.on("resolved", (service) => {
      if (service.name.includes("_shelf-sync._tcp")) {
        found.push({
          name: service.name,
          host: service.host,
          port: service.port,
          version: (service.txt as Record<string, string>).v ?? "unknown",
        });
      }
    });

    zeroconf.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    zeroconf.scan("_shelf-sync._tcp", "local.");
  });
}
```

- [ ] **Step 2: Commit**

```sh
cd mobile
git add lib/discovery.ts
git commit -m "feat(discovery): mDNS service browser for _shelf-sync._tcp"
```

---

## Task 7: Sync client (pull/push + queue drain + reconnection)

**Files:**
- Create: `mobile/lib/sync.ts`

Background sync loop: drain `sync_queue` (push), then `GET /pages?since=last_pulled_cursor` (pull), with automatic reconnection. Uses last-write-wins per page (the side with the more recent `updated_at` wins).

- [ ] **Step 1: Write the sync client**

Key functions:

- `syncLoop()` — runs on a timer (e.g. every 30s when connected). Push queue, then pull.
- `pushQueue()` — iterate `sync_queue`, for each: read the page from local SQLite, call the appropriate API method (create/update/delete). On success, clear the queue entry.
- `pullChanges()` — fetch `GET /pages?since=last_pulled_cursor`. For each remote page, compare `updated_at` with the local copy. If the remote is newer, upsert it locally. Update `last_pulled_cursor`.
- `fullSync()` — called on first launch after pairing: pull all pages with no `since` parameter, bulk-insert into local SQLite.
- `startSyncLoop()` / `stopSyncLoop()` — start/stop the periodic sync timer.
- Reconnection: monitor network state via `@react-native-community/netinfo`. When the network changes to the home Wi-Fi (SSID match or mDNS discovery succeeds), auto-reconnect.
- Update the store's `connectionStatus` on every state transition.

- [ ] **Step 2: Write unit tests**

Test `pushQueue` and `pullChanges` with a mock API + an in-memory SQLite database. Verify:
- A dirty page is pushed and cleared from the queue.
- A remote page with a newer `updated_at` overwrites the local copy.
- A local page with a newer `updated_at` is NOT overwritten.
- Deleted pages (`is_deleted = 1`) are propagated.

- [ ] **Step 3: Commit**

```sh
cd mobile
git add lib/sync.ts lib/sync.test.ts
git commit -m "feat(sync): background sync client — push queue + incremental pull"
```

---

## Task 8: Navigation shell + theme + connection indicator

**Files:**
- Modify: `mobile/app/_layout.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/components/ConnectionIndicator.tsx`

Set up the expo-router shell with a tab bar, a persistent connection-state indicator at the top, and the light/dark theme context.

- [ ] **Step 1: Root layout with theme + connection bar**

`mobile/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { ConnectionIndicator } from "../components/ConnectionIndicator";
import { useMobileStore } from "../store/useMobileStore";
import { useEffect } from "react";
import { initSync } from "../lib/sync";

export default function RootLayout() {
  const connectionStatus = useMobileStore((s) => s.connectionStatus);

  useEffect(() => {
    initSync(); // starts the sync loop + network monitoring
  }, []);

  return (
    <>
      <ConnectionIndicator status={connectionStatus} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="editor/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
```

- [ ] **Step 2: Tab layout**

`mobile/app/(tabs)/_layout.tsx` — standard expo-router tabs: Home, Search, Settings. Use `lucide-react-native` icons (install `lucide-react-native`).

- [ ] **Step 3: Connection indicator component**

A slim bar at the top: "Connected to Shelf (MacBook)" in green, "Offline" in amber, "Syncing..." with a spinner. Must always be visible on every screen.

- [ ] **Step 4: Commit**

```sh
cd mobile
git add app/_layout.tsx app/(tabs)/_layout.tsx components/ConnectionIndicator.tsx
git commit -m "feat(nav): expo-router shell with theme + connection indicator"
```

---

## Task 9: Home / Page list screen

**Files:**
- Create: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/components/PageList.tsx`
- Create: `mobile/components/PageTreeItem.tsx`

The entry screen: recent pages section, favorites section, expandable page tree, floating "+" button.

- [ ] **Step 1: Write the screen + components**

- Use `useMobileStore` to list pages.
- Build the page tree using `buildPageTree` from `@shelf/shared` (import from `@shelf/shared/pageTree`).
- `PageTreeItem` — recursive expandable list item (tap to open, long-press for context menu: favorite/delete).
- FloatingActionButton (bottom-right) → `createPage()` + navigate to editor.
- Recent section: last 5 pages by `updated_at`.
- Favorites section: pages with `is_favorite = 1`.

- [ ] **Step 2: Commit**

```sh
cd mobile
git add app/(tabs)/index.tsx components/PageList.tsx components/PageTreeItem.tsx
git commit -m "feat(ui): home screen — recent, favorites, page tree, FAB"
```

---

## Task 10: Editor screen (WebView + native chrome)

**Files:**
- Create: `mobile/app/editor/[id].tsx`
- Create: `mobile/components/FloatingToolbar.tsx`
- Create: `mobile/editor/bundle.ts`
- Create: `mobile/editor/bridge.ts`

The core editor: a WebView loading BlockNote, with a native title input and floating toolbar.

### Approach

The desktop `PageEditor.tsx` component cannot be used directly in React Native (it renders DOM). Instead, we build a **stripped editor bundle** that loads BlockNote in a minimal HTML page, communicates with the RN host via `postMessage`, and exposes controls through a native floating toolbar.

- [ ] **Step 1: Write the editor bundle entry**

`mobile/editor/bundle.ts` — a standalone Vite/Webpack entry that renders a BlockNote editor in a bare HTML page. It:
- Receives initial content + theme via `window.addEventListener("message", ...)`.
- Posts content changes and block selections via `window.ReactNativeWebView.postMessage(...)`.
- Exports no React component — this is a standalone bundle loaded in a `<WebView source={{ uri: ... }} />`.

Build command: add to `mobile/package.json`:

```json
{
  "scripts": {
    "build:editor": "vite build mobile/editor/bundle.html --outDir mobile/editor/dist"
  }
}
```

The bundle must be very light — only BlockNote + the minimal plugins (no Studio, no character palette). Use BlockNote's `useCreateBlockNote` with a limited plugin set.

- [ ] **Step 2: Define the bridge protocol**

`mobile/editor/bridge.ts`:

```typescript
export type RnToWebView =
  | { type: "loadContent"; content: string; theme: "light" | "dark" }
  | { type: "applyTheme"; theme: "light" | "dark" }
  | { type: "insertBlock"; blockType: "heading" | "checklist" | "code" | "bulletList" | "numberedList" };

export type WebViewToRn =
  | { type: "contentChanged"; content: string; searchText: string }
  | { type: "requestImageInsert" }
  | { type: "editorReady" };
```

- [ ] **Step 3: Write the editor screen**

`mobile/app/editor/[id].tsx`:
- Load page content from `useMobileStore`.
- Render a `<WebView>` with the bundled editor HTML.
- Above the WebView: native `<TextInput>` for the page title.
- Below (absolute positioned): `<FloatingToolbar>` with bold, heading, checklist, code, image buttons.
- On mount: send `{ type: "loadContent", content, theme }` to the WebView.
- On `onMessage`: parse `WebViewToRn` events — update store on content change, trigger image picker on `requestImageInsert`.
- Save debounced (every 2s of inactivity).

- [ ] **Step 4: Write the floating toolbar**

`mobile/components/FloatingToolbar.tsx` — horizontally scrollable button row pinned above the keyboard. Each button posts an `insertBlock` message to the WebView.

- [ ] **Step 5: Commit**

```sh
cd mobile
git add app/editor/[id].tsx components/FloatingToolbar.tsx editor/bundle.ts editor/bridge.ts
# + editor build output (dist/) once built
git commit -m "feat(editor): BlockNote WebView editor with floating toolbar bridge"
```

---

## Task 11: Search screen

**Files:**
- Create: `mobile/app/(tabs)/search.tsx`

Full-screen search with live results from local SQLite (search on `title` and `search_text` columns). Tap a result to open the editor.

- [ ] **Step 1: Write the search screen**

- Search input at the top (native `<TextInput>` with clear button).
- Live results below: list of page titles with `icon` + `title` + snippet of matched text.
- Use `useMobileStore` to query: `getDb().getAllSync("SELECT * FROM pages WHERE is_deleted = 0 AND (title LIKE ? OR search_text LIKE ?) ORDER BY updated_at DESC", [\`%${q}%\`, \`%${q}%\`])`.
- Debounce input (300ms) before querying.

- [ ] **Step 2: Commit**

```sh
cd mobile
git add app/(tabs)/search.tsx
git commit -m "feat(ui): full-text search screen"
```

---

## Task 12: Settings & sync screen

**Files:**
- Create: `mobile/app/(tabs)/settings.tsx`
- Create: `mobile/components/DeviceList.tsx`

Shows sync status, desktop info, paired devices list, manual sync trigger. Mirrors the desktop "Mobile sync" settings panel.

- [ ] **Step 1: Write the settings screen**

- Connection status banner at the top.
- Desktop info: "Connected to Shelf on Marco's MacBook at 192.168.1.5:43201".
- "Sync now" button → triggers `fullSync()` or `syncLoop()`.
- `<DeviceList>` — shows this device + any other paired devices (informational from the desktop? MVP: just the phone itself).
- "Disconnect" button → clears pairing data (`clearPairingData()`), redirects to onboarding.

- [ ] **Step 2: Commit**

```sh
cd mobile
git add app/(tabs)/settings.tsx components/DeviceList.tsx
git commit -m "feat(ui): settings screen — sync status, manual sync, disconnect"
```

---

## Task 13: Onboarding & pairing flow

**Files:**
- Create: `mobile/app/onboarding/index.tsx`
- Create: `mobile/app/onboarding/pair.tsx`
- Create: `mobile/lib/pairing.ts`

First-launch flow: scan for desktops via mDNS, show a QR scanner, call the pairing endpoint, store the token, run initial full sync.

- [ ] **Step 1: Write the pairing library**

`mobile/lib/pairing.ts`:
- `discoverAndPair()` — calls `scanForDesktop()`, if exactly one found, show its info. If none, show manual IP input.
- Opens QR scanner (`expo-camera` with `barCodeScannerSettings` for QR).
- On scan: parse `https://<host>:<port>/pair?token=<pairingToken>`.
- Call `pairDevice(baseUrl, { token, name, platform })` → receive `deviceToken`.
- Store via `storeDeviceToken()` + `storeDesktopFingerprint()`.
- Call `fullSync()` to pull all pages.

- [ ] **Step 2: Write the onboarding screens**

`mobile/app/onboarding/index.tsx`:
- Welcome text: "Connect to your Shelf desktop".
- "Scan QR" button → navigates to `onboarding/pair`.
- Shows discovered desktops list (from mDNS scan).

`mobile/app/onboarding/pair.tsx`:
- Full-screen camera view with QR overlay.
- On successful scan: shows "Pairing..." spinner.
- On pairing success: "Connected! Syncing your notes..." with progress bar.
- On completion: redirect to tabs home.

- [ ] **Step 3: Commit**

```sh
cd mobile
git add app/onboarding/index.tsx app/onboarding/pair.tsx lib/pairing.ts
git commit -m "feat(onboarding): QR pairing flow — scan, pair, initial full sync"
```

---

## Task 14: Image download during sync + URL remapping

**Files:**
- Create: `mobile/lib/media.ts`

When pages sync from the desktop, images referenced in `content` (BlockNote JSON blocks with `url: "opennotion-app://asset/..."`) must be downloaded and remapped to local `file://` URIs.

- [ ] **Step 1: Write the media module**

`mobile/lib/media.ts`:
- Parse page content JSON, find all image URLs matching `opennotion-app://asset/...` or `https://` (desktop-hosted).
- Download each image via `expo-file-system` (`FileSystem.downloadAsync`).
- Store in `FileSystem.documentDirectory + "media/" + hash(url)`.
- Replace the URL in the content JSON with the local `file://` URI.
- Track download state in `media_cache` table.

- [ ] **Step 2: Wire into the sync client**

After `pullChanges()` receives pages, for each page with `content_loaded === 1`, run `downloadPageMedia(pageId, content)` before upserting.

- [ ] **Step 3: Commit**

```sh
cd mobile
git add lib/media.ts
git commit -m "feat(media): image download + URL remapping during page sync"
```

---

## Task 15: Testing — unit + integration

**Files:**
- Create: `mobile/lib/db.test.ts` (already created in Task 2)
- Create: `mobile/lib/sync.test.ts` (already created in Task 7)
- Create: `mobile/store/useMobileStore.test.ts`
- Create: `mobile/lib/api.test.ts`

- [ ] **Step 1: Store tests**

`mobile/store/useMobileStore.test.ts` — test each action (createPage, updatePage, deletePage) writes to local SQLite + enqueues sync + updates Zustand state. Mock `lib/db.ts` functions.

- [ ] **Step 2: API client tests**

`mobile/lib/api.test.ts` — mock `fetch` globally, verify correct HTTP method, headers (Authorization), body serialization, and error handling for 401/404/500 responses.

- [ ] **Step 3: Run all mobile tests**

```sh
cd mobile && npx jest
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```sh
cd mobile
git add store/useMobileStore.test.ts lib/api.test.ts
git commit -m "test: mobile store + API client unit tests"
```

---

## Task 16: Desktop AGENTS.md update + mobile commands

**Files:**
- Modify: `AGENTS.md` (in Shelf root)

- [ ] **Step 1: Add mobile commands**

Add to the Commands section:

```sh
cd mobile && npx expo start   # Start the Expo dev server for the mobile app
cd mobile && npx expo run:ios      # Build and run on iOS simulator
cd mobile && npx expo run:android  # Build and run on Android emulator
cd mobile && npx jest              # Run mobile unit tests
```

- [ ] **Step 2: Add mobile architecture note**

In the Architecture section, add:

```
- **`mobile/` (private submodule)** — React Native (Expo) mobile companion. Reads/writes notes offline via local SQLite, syncs with the desktop over the local network via the Phase 2 REST API. See `docs/superpowers/specs/2026-06-27-mobile-app-design.md`.
```

- [ ] **Step 3: Commit (in public repo)**

```sh
git add AGENTS.md
git commit -m "docs: AGENTS.md — mobile commands + architecture note"
```

---

## Task 17: Verification gate

- [ ] **Step 1: Build the editor bundle**

```sh
cd mobile && npm run build:editor
```

No errors; `dist/` contains the BlockNote bundle.

- [ ] **Step 2: Expo builds**

```sh
cd mobile && npx expo run:ios     # iOS simulator
cd mobile && npx expo run:android  # Android emulator
```

Both launch without crashes. The app shows the onboarding screen (no desktop paired yet — that's the expected initial state).

- [ ] **Step 3: Run all mobile tests**

```sh
cd mobile && npx jest
```

All unit + integration tests pass.

- [ ] **Step 4: Manual pairing E2E**

1. On the desktop: open Settings → Mobile sync → Enable. Note the URL + QR.
2. On the phone (simulator): launch the app → onboarding → scan the QR.
3. The phone receives the device token, starts initial sync.
4. The desktop's "Paired devices" list shows the phone.
5. Create a page on the phone → it appears on the desktop after sync.
6. Create a page on the desktop → it appears on the phone after sync.

- [ ] **Step 5: Full public repo check**

```sh
npm run check  # (desktop gate — must still pass)
```

---

**Phase 3 complete.** Shelf now has a mobile companion (private, `mobile/` submodule) that reads/writes notes offline and syncs with the desktop over the local network. Studio/PDF on mobile is deferred to a future phase.

---

## Verification (end of plan)

- [ ] `mobile/` submodule exists and builds.
- [ ] `npm run build` (desktop) passes (shared contract types don't break anything).
- [ ] `npm run check` (desktop gate) passes.
- [ ] Mobile app launches on iOS simulator + Android emulator.
- [ ] Onboarding → QR scan → pairing completes.
- [ ] Pages sync bidirectionally (phone ↔ desktop).
- [ ] Offline edits are queued and synced when the phone reconnects.