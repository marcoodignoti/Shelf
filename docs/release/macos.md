# macOS Electron Release Checklist

OpenNotion's macOS build is the Electron desktop app packaged under `dist-electron`.
Public distribution needs Developer ID signing, hardened runtime, notarization,
stapling, and Gatekeeper verification.

## Local Release Gate

Run these commands before any macOS build is considered ready for distribution:

```sh
npm ci
npm run check:electron
npm run release:package:macos
```

The current unsigned app bundle is generated at:

```text
dist-electron/mac-arm64/OpenNotion.app
```

## Acceptance Criteria

- The app launches cleanly on a clean macOS user account.
- Notes, images, Studio documents, and settings persist after relaunch.
- `npm run check:electron` passes.
- The packaged app opens normally.
- For public releases, Gatekeeper accepts the app after signing and notarization.
- Large local PDFs are handled with clear errors or acceptable performance.

## Pre-Distribution Profiling

Before publishing a build, measure:

- startup time
- idle memory
- memory after long editing session
- memory after opening small and large PDFs
- disk growth after importing and deleting PDFs/images
- size of generated `.app`, SQLite DB, `covers/`, `editor-images/`, and `studio-documents/`
