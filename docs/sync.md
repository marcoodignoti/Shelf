# Mobile Sync Server (Phase 2)

Shelf can act as an encrypted, local-network sync server so a future mobile
client can read and write pages over a private REST API. This phase ships the
**desktop server only** — the mobile app itself is Phase 3.

Everything is local-first: notes are never sent to a cloud. The server binds
to private (RFC 1918) interfaces, advertises itself over mDNS, and only accepts
requests from devices that have been paired on-device via a QR code.

## Enabling

Settings → **Mobile sync** → **Enable**. Toggling off stops the server and the
mDNS advertisement; paired devices remain in the registry and can be revoked
at any time.

## REST API

All routes are JSON, served over HTTPS with a self-signed certificate minted
on first enable and persisted to `userData/sync-server/`. The certificate
fingerprint is part of the QR pairing payload so the mobile client can pin it.

| Method | Path             | Auth     | Maps to (`backend.invoke`)  |
|--------|------------------|----------|------------------------------|
| POST   | `/pair`          | none     | pairing → `registerDevice`   |
| GET    | `/pages`         | device   | `list_pages`                 |
| GET    | `/pages/:id`     | device   | `get_page`                   |
| POST   | `/pages`         | device   | `create_page`                |
| PUT    | `/pages/:id`     | device   | `update_page`                |
| DELETE | `/pages/:id`     | device   | `delete_page`                |

`GET /pages` accepts a `since` query param for forward compatibility; the
server-side incremental filter is deferred. `POST /pair` is the only
unauthenticated route and requires a one-time pairing token (TTL 5 min).

## Security model

- **TLS**: self-signed X.509 (RSA-2048, 10-year validity) minted with the
  `selfsigned` package, stored mode `0600` in a private directory.
- **Pairing**: a short-lived pairing token + a 6-digit PIN are shown as a QR
  in Settings. The QR encodes `https://<host>:<port>/pair?token=<pairingToken>`.
  The pairing token is single-use and expires after 5 minutes.
- **Device tokens**: on a successful `/pair`, the server mints a 32-byte
  device token, stores only its **SHA-256 hash** in `sync_devices`, and
  returns the raw token to the mobile client over the TLS channel the client
  just pinned. All subsequent requests carry `Authorization: Bearer <token>`.
  Token comparison is constant-time.
- **Revocation**: each paired device has a `revoked` flag; revoked tokens are
  rejected at the auth boundary.
- **Network scope**: mDNS advertisement and the advertised host are gated on
  `isPrivateHost` (RFC 1918 + loopback). The server refuses to enable when no
  private interface is present.
- **Rate limit**: 600 requests/minute/device; over the limit returns `429`.

## Testing

```sh
npm run sync:test        # focused: electron/sync-*.test.cjs
npm run test:scripts     # all node --test files (includes sync suite)
```

Coverage: token generation/hashing/compare, cert minting + idempotent reload,
`sync_devices` migration idempotency, device registry CRUD, pairing TTL +
single-use, REST route dispatch + auth boundary, end-to-end HTTPS server
(authenticated push/pull, revoked-token rejection), and mDNS advertisement
lifecycle (mocked).

## Module map

| File                          | Responsibility                                  |
|-------------------------------|-------------------------------------------------|
| `electron/sync-certs.cjs`     | Self-signed cert generation + persisted reload  |
| `electron/sync-tokens.cjs`    | Token gen, SHA-256 hash, constant-time verify   |
| `electron/sync-devices.cjs`   | CRUD over `sync_devices` (register/list/revoke) |
| `electron/sync-pairing.cjs`   | Ephemeral pairing tokens, QR payload, PIN       |
| `electron/sync-routes.cjs`    | REST route table → `backend.invoke`              |
| `electron/sync-network.cjs`   | Private-host validation + free-port picker       |
| `electron/sync-server.cjs`    | HTTPS server lifecycle, TLS, rate limit, dispatch |
| `electron/sync-mdns.cjs`      | `_shelf-sync._tcp` advertisement (bonjour-service) |
| `electron/main.cjs`           | Server lifecycle, IPC handlers (`opennotion:sync-*`) |
| `electron/preload.cjs`        | `window.openNotion.sync.*` bridge               |
| `src/lib/desktop.ts`          | Typed sync wrappers for the renderer            |
| `src/components/settings/MobileSyncSection.tsx` | Settings UI           |

## Out of scope (Phase 3)

The mobile app, WebView editor host, mobile SQLite client, and mobile UI are
deferred to a separate plan.