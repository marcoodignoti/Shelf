# Shelf Mobile App — Design

**Date:** 2026-06-27
**Status:** Approved (pending implementation plan)
**Scope:** First mobile app for Shelf (iOS + Android), MVP limited to notes read/write + local sync with the desktop app.

---

## 1. Goals & Non-Goals

### Goals

- Provide a mobile companion app for Shelf that lets users **read and write notes** from a phone.
- Keep the **local-first, no-cloud** promise: data is exchanged directly between the phone and the user's own desktop app over the local network, never through a third-party cloud.
- Reuse the existing desktop stack as much as possible: the BlockNote editor (via WebView), the pure logic in `src/lib` (types, page tree, i18n), and the existing backend command layer.
- Ship on **iOS and Android** from a single codebase.

### Non-Goals (out of MVP scope)

- **Studio / PDF reading** on mobile (PDF reader + side-by-side note is a separate, larger effort with its own touch design).
- **Cloud sync** or any remote relay. Sync happens only on the local network with the desktop app running.
- **Video in notes** (downloaded on demand, manually tested in MVP).
- **Conflict merging / CRDTs** — last-write-wins per page is the conflict model.
- Reaching the desktop when it is asleep or off the local network (deferred to a possible future Tailscale/relay phase).

---

## 2. Key Decisions (summary)

| Decision | Choice |
|---|---|
| Data source for mobile | Local sync with desktop (no cloud) |
| Platforms | iOS + Android from one codebase |
| MVP scope | Notes read/write + sync (no Studio/PDF) |
| Conflict model | Last-write-wins per page (by `updated_at`) |
| Framework | Hybrid: React Native (Expo) for native UI + WebView for the BlockNote editor |
| Code reuse | `packages/shared` (public) for types/page-tree/i18n; desktop editor reused via WebView |
| Mobile code visibility | Private GitHub repo `marcoodignoti/Shelf-mobile` referenced as a **git submodule** in the public repo |
| Sync reach | Same local network + desktop app running (Option 1). No remote sync. |
| Block insertion UX | Floating toolbar (primary), no `/` slash menu on mobile |
| Transport security | HTTPS with a self-signed certificate pinned at pairing time |

---

## 3. Repository & Monorepo Structure

```
Shelf/                              # public repo (marcoodignoti/Shelf)
├── electron/                       # desktop app (existing) + new sync server modules
├── src/                            # desktop React renderer (existing)
├── packages/
│   └── shared/                     # NEW — framework-free code shared by desktop + mobile
│       ├── types/                  #   Page, PageKind, SearchResult (from src/lib/db.ts)
│       ├── pageTree/               #   ordering, breadcrumbs (from src/lib/pageTree.ts, breadcrumb.ts)
│       ├── i18n/                   #   resolveLocale + locales en/it (from src/lib/i18n.ts)
│       └── db-contract/            #   request/response types for backend commands
├── mobile/                         # git submodule → private repo marcoodignoti/Shelf-mobile
│   ├── app/                        #   expo-router screens
│   ├── components/                 #   native RN UI (sidebar, lists, editor host)
│   ├── store/                      #   mobile Zustand store (mirror of desktop useAppStore)
│   ├── lib/                        #   sync client + local SQLite
│   └── editor/                     #   WebView host loading the BlockNote renderer
└── package.json                    # workspace root (npm workspaces)
```

### Principles

1. **`packages/shared` contains only framework-free code.** No React, no Electron, no RN. This extends the existing project rule ("new non-trivial logic belongs in `src/lib` as a tested pure function") to the mobile consumer. Desktop and mobile both import from `shared`.
2. **`packages/shared` stays public** because it is consumed by the desktop renderer, which is public. Only `mobile/` is private.
3. **The desktop remains the source of truth.** The sync server lives inside Electron and calls the same `invoke(command, args)` backend commands the renderer already uses — no new database code.
4. **`mobile/` is a git submodule** pointing at the private repo `marcoodignoti/Shelf-mobile`. The public repo only shows the submodule pointer (commit hash), not the source.

### Developer workflow with the submodule

```sh
git clone --recurse-submodules <Shelf>
git submodule update --remote mobile    # pull latest mobile code
```

---

## 4. Sync Architecture (desktop as local server)

### Discovery & pairing

- The Electron app advertises a **mDNS/Bonjour** service of type `_shelf-sync._tcp` (via `bonjour-service`, no native deps), so the phone auto-discovers "Shelf on Marco's MacBook" on the local network without typing an IP.
- **One-time QR pairing:** the desktop shows a QR containing `https://<ip>:<port>/pair?token=<ephemeral-token>`. The phone scans it, calls the pairing endpoint with the token, the desktop confirms (with an optional 6-digit PIN shown on screen for visual confirmation), and the phone receives a persistent **device token**.
- **Multi-device:** multiple phones can be paired to the same desktop.

### Protocol

- **HTTP/JSON REST** over **HTTPS with a self-signed certificate** generated by the desktop. The phone **pins** the certificate fingerprint at pairing time and refuses connections if it changes without re-pairing.
- Routes map to existing backend commands:

| Route | Backend command |
|---|---|
| `GET /pages?since=<ts>` | `list_pages` (incremental — only pages changed after `since`) |
| `GET /pages/:id` | `get_page` |
| `PUT /pages/:id` | `update_page` |
| `POST /pages` | `create_page` |
| `DELETE /pages/:id` | `delete_page` |

- **Auth:** `Authorization: Bearer <device-token>` on every request after pairing. The desktop validates the token against the hashed value in `sync_devices`.

### Sync cycle (last-write-wins per page)

1. The phone writes immediately to its **local SQLite** copy and enqueues a dirty entry in `sync_queue`.
2. The background sync client (with automatic reconnect) **pushes** dirty pages (`PUT`) and then **pulls** (`GET /pages?since=last_pulled_cursor>`).
3. For a page modified on both sides since the last sync, the side with the more recent `updated_at` wins. The losing version is overwritten silently — no conflict UI, consistent with the LWW choice.
4. The desktop applies remote mutations through its own `invoke('update_page')` / `create_page` / `delete_page` — **zero new DB code**, full reuse of the existing backend.

### Reach model (explicit constraint)

Sync happens **only** when all three conditions hold:

1. The phone and desktop are on the **same local network**.
2. The **desktop app is open** (the HTTP server runs in the Electron process).
3. The **desktop is awake** (not asleep).

The phone always works offline (reads/writes its local copy instantly); changes queue and sync automatically once the phone returns to the desktop's network with the desktop running. There is no remote sync path in the MVP.

### Connection-state UX (transparency is required)

Because sync is not "magic", the connection state must always be visible:

- A persistent indicator in the phone's top bar: **"Connected to Shelf (MacBook)"** / **"Offline — changes will sync when you're back"**. Never ambiguous.
- A **local notification** when the phone rejoins the desktop's network: "Back home — syncing 3 pages". Sync then starts automatically in the background.
- On the desktop, a sidebar indicator shows which devices are currently connected.

---

## 5. Mobile App — Screens & UX

MVP is notes read/write + sync (no Studio/PDF). Navigation is a native stack via `expo-router`.

### 5.1 Home / Page list (entry point)

- Compact header: "Shelf" title, search icon, sync icon (tap to see connection state + devices).
- **Recent** section (recently opened pages: icon + title + text preview, list style).
- **Favorites** section (starred pages).
- Navigable **page tree** (expand/collapse, like the desktop sidebar but touch-optimized: tap to open, long-press for menu — move / favorite / delete).
- Floating **+** button (bottom-right) for a new page.

### 5.2 Editor (the core screen)

- **Header:** breadcrumb (parent → current page, tappable to go back), "···" button (share, info, delete).
- **Title input:** native RN at the top.
- **BlockNote editor in a WebView** below the title. The WebView loads an **isolated editor bundle** (not the whole desktop React app — only `PageEditor` + the minimum it needs). Bidirectional communication via `postMessage`:
  - RN → WebView: load this content, apply theme (light/dark).
  - WebView → RN: content changed, mark dirty, request image import.
- **Floating toolbar** (bottom) with essential actions (bold, heading, checklist, code, formula, image) instead of the desktop's full slash menu. Block insertion is tap-driven, not `/`-driven.

### 5.3 Search

- Full-screen search bar at the top, live results (uses `searchPages` from `packages/shared`), tap to open.

### 5.4 Devices & Sync (in settings)

- List of paired devices with "Last synced: 12 min ago".
- "Sync now" button.
- Revoke a device.

### 5.5 Onboarding / Pairing (first launch)

- "Connect to your Shelf desktop" screen: instructions + "Scan QR" button that opens the camera.
- After scan: if the desktop requested PIN confirmation for this pairing, confirm the 6-digit PIN shown on the desktop (PIN is optional per pairing — see Open Questions §9).
- Initial sync progress: "Initial sync — 142 pages".

---

## 6. Mobile Persistence & Data Model

The phone keeps its own SQLite copy so it works offline and responds instantly.

### Local SQLite (mobile)

Library: `expo-sqlite` (synchronous JS-thread API via hooks). Schema mirrors the desktop `pages` table, plus support tables:

- `pages` — same columns as the desktop entity (`id, title, content, parent_id, sort_order, ..., updated_at, content_loaded`).
- `sync_queue` — dirty pages to push: `(page_id, pending_op: 'update'|'create'|'delete', queued_at)`.
- `sync_state` — single row: `last_synced_at`, `desktop_device_id`, `last_pulled_cursor`.

### Offline-first read/write flow

1. User opens a page → read from local SQLite (instant).
2. Edit → write immediately to local SQLite + insert into `sync_queue`.
3. The mobile Zustand store (a mirror of the desktop `useAppStore`, but with its source = local SQLite instead of `invoke`) updates the UI.
4. When connected, the sync client drains `sync_queue` (`PUT` per page) and then pulls (`GET /pages?since=last_pulled_cursor>`).

### Boot / initial sync

- First launch after pairing: `GET /pages` with no `since` → full pull → `import_pages`-equivalent into local SQLite. Progress indicator.
- Subsequent launches: incremental pull + drain the queue.

### Media (images/video)

- Page images are on-disk blobs on the desktop (`editor-images/`, served via the `app-asset://` protocol). On the phone, during page sync the media references are **downloaded as blobs and stored in the app's Document Directory**, with the local URL remapped. MVP: **images only** (videos are rare in notes and heavy — downloaded on demand at tap). A `media_sync_state(page_id, media_path, downloaded)` table tracks downloads.

### Deletions

- Soft-delete consistent with the desktop: `DELETE /pages/:id` sets `is_deleted=1`. The pull propagates the flag. No physical deletion on the phone except occasional garbage collection.

---

## 7. Security & Privacy

Consistent with the project's "local-first, no cloud" stance, sync is encrypted even on the local network.

### Transport

- **HTTPS with a self-signed certificate** generated by the desktop when the sync server first starts. The phone pins the fingerprint at pairing and refuses connections if the cert changes without re-pairing — protection against local-network man-in-the-middle.
- Generated via `node:crypto` in Electron (ECDSA P-256 key, valid 10 years). Stored at `~/Library/Application Support/org.opennotion.desktop/sync-server/`.

### Auth

- **Device token** (32 random bytes, base64url) issued by the desktop at pairing. The phone stores it in **Keychain (iOS) / Keystore (Android)**, never in plaintext AsyncStorage. Every REST request carries `Authorization: Bearer <token>`.
- The desktop keeps a new `sync_devices` table: `(device_id, name, platform, token_hash, paired_at, last_seen, revoked)`. The token is **hashed (SHA-256)** in the DB, never stored in plaintext.

### Network permissions (desktop)

- The sync server **binds only to private interfaces** (RFC 1918: `192.168.x`, `10.x`, `172.16–31.x`) and refuses to listen on public interfaces. It is impossible to accidentally expose Shelf to the internet.
- Port is chosen automatically (range `43200–43299`, first free) to avoid conflicts.

### Boundaries

- The phone can never access the desktop filesystem outside the intended page commands. The REST API is a **closed list** (`GET/PUT/POST/DELETE /pages`): no arbitrary paths, no shell command execution. Reuses the existing `assertSafeInvokeArgs` guard from the backend.
- Basic rate limiting: max N requests/minute per device token, to contain abuse even from a paired (e.g. misbehaving) device.

### Privacy / data

- No telemetry, no analytics — consistent with the README ("no telemetry, no sign-up"). The phone talks only to the user's own desktop.
- The only new sensitive data is the `sync_devices` table and the certificate. The private key lives in the protected config dir (`ensurePrivateDirectory`, already used by the backend).

---

## 8. Desktop Changes & Testing

### What changes in the desktop (public repo)

To support sync, the Electron app gains a few new modules — all in the existing backend style, no rewrites:

1. **Sync HTTP server** — new file `electron/sync-server.cjs` (Node `http`/`https` + a minimal router). Starts at Electron boot, binds to private interfaces, maps REST routes to existing `invoke(...)` commands. Toggleable from Settings (default **off** until the user enables "Mobile sync" or starts pairing).
2. **mDNS advertisement** — `electron/sync-mdns.cjs` registers `_shelf-sync._tcp` (uses `bonjour-service`, lightweight, no native deps).
3. **Pairing controller** — `electron/sync-pairing.cjs`: generates QR + ephemeral tokens, issues device tokens, manages `sync_devices`.
4. **Certificates** — `electron/sync-certs.cjs`: generates/loads the self-signed certificate.
5. **`sync_devices` table** — idempotent migration in `backend.cjs` (`CREATE TABLE IF NOT EXISTS`, same pattern as the rest of the schema).
6. **Desktop UI** — "Mobile sync" panel in Settings (toggle server, show QR, list paired devices + revoke), plus a small status indicator in the sidebar ("iPhone connected").

All of this is **public** in the Shelf repo (it is desktop server-side, not mobile app code). Only the mobile app itself lives in the private submodule.

### Shared code extracted to `packages/shared`

- Types `Page`, `PageKind`, `SearchResult` (from `src/lib/db.ts`).
- Pure functions from `pageTree.ts`, `breadcrumb.ts`, `navigation.ts`.
- `i18n` (`resolveLocale`, dictionaries `en`/`it`).
- Command contracts (request/response for `update_page`, `create_page`, etc.).

The extraction is a mechanical refactor; the existing co-located `*.test.ts` files must continue to pass for both the desktop and the mobile consumers.

### Testing

| Level | What | Tool |
|---|---|---|
| Pure functions | `pageTree`, `breadcrumb`, i18n (after move to shared) | Vitest (existing) |
| Sync protocol | pairing, token validation, route mapping, LWW resolution, rate limit | Vitest + `node:test` for `electron/*.test.cjs` |
| Sync end-to-end | server ↔ simulated client: push/pull, conflict, device revoke | new spec `electron/sync-server.test.cjs` |
| Mobile store | mobile Zustand store, dirty queue, conflict resolution | Jest/Vitest on the mobile package |
| E2E mobile | QR pairing → initial sync → offline edit → reconnect → sync | Maestro or Detox (MVP: manual on simulator) |

### Not tested in MVP

- Studio / PDF on mobile (out of scope).
- Video in pages (on-demand download, manual test).

### New npm scripts

- `npm run mobile:dev` — start Expo + dev client.
- `npm run mobile:ios` / `mobile:android` — build on simulator.
- `npm run sync:test` — run the sync server in isolation and test against it.

---

## 9. Open Questions

None blocking. The following are deferred to the implementation plan:

- Exact device-token request/minute rate-limit value.
- Whether the optional 6-digit pairing PIN is mandatory or opt-in per pairing session.
- GC policy/interval for locally deleted pages on the phone.
