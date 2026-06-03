# Electron Migration

Goal: one maintained OpenNotion desktop app on Electron.

## Current State

- React renderer runs through Electron.
- Renderer calls route through `src/lib/desktop.ts`.
- Preload exposes one bridge: `window.openNotion`.
- Electron main owns SQLite, filesystem imports, dialogs, open/reveal file actions.
- App data keeps the legacy `org.opennotion.desktop` directory so existing `opennotion.db`, covers, editor images, and Studio PDFs can be reused.
- `src-tauri/`, Tauri dependencies, Tauri scripts, and Tauri release workflows have been removed.

## Gate

Run:

```sh
npm run check:electron
```

This covers build, unit tests, backend smoke, Electron runtime smoke, npm audit, packaged app creation, visual smoke, and packaged parity smoke.

## Remaining Release Work

- Replace the temporary manual macOS app-bundle copy with a signed/notarized release pipeline.
- Add Windows packaging when ready.
- Add migration checks for users coming from older beta bundle identifiers.
