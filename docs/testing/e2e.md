# E2E Testing

OpenNotion has browser-level Playwright coverage for common workflows and packaged Electron smoke tests for the real desktop bridge.

## Browser E2E

Run locally:

```sh
npm run e2e:install
npm run e2e
```

Browser tests run the Vite app with a deterministic mock of `window.openNotion`. They do not touch the real local SQLite database.

## Packaged Electron Smoke

Run the Electron gate:

```sh
npm run check:electron
```

This builds the app, packages `dist-electron/mac-arm64/OpenNotion.app`, launches it with Playwright Electron, checks the rendered UI is nonblank, runs a parity workflow, and verifies the real SQLite database state.
