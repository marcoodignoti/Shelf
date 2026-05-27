# macOS Tauri Release Checklist

OpenNotion's macOS build is the Tauri desktop app in `src-tauri`.
Public distribution needs Developer ID signing, hardened runtime, notarization,
stapling, and Gatekeeper verification.

## Local Release Gate

Run these commands before any macOS build is considered ready for distribution:

```sh
npm ci
npm run check:tauri
npm run release:package:macos
```

The Tauri output is generated under `src-tauri/target/release/bundle/`.

## Acceptance Criteria

- The app launches cleanly on a clean macOS user account.
- Notes, images, Studio documents, and settings persist after relaunch.
- `npm run check:tauri` passes.
- The DMG opens and installs normally.
- For public releases, Gatekeeper accepts the app and DMG after notarization.
- Large local PDFs are handled with clear errors or acceptable performance.

## Pre-Distribution Profiling

Before publishing a DMG, measure:

- startup time
- idle memory
- memory after long editing session
- memory after opening small and large PDFs
- disk growth after importing and deleting PDFs/images
- size of generated `.app`, DMG, SQLite DB, `covers/`, `editor-images/`, and `studio-documents/`
