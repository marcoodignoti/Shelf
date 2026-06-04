# macOS Electron Release Checklist

OpenNotion's current macOS release candidate is an unsigned private Electron DMG
under `dist-electron`. Public distribution still needs Developer ID signing,
hardened runtime, notarization, stapling, and Gatekeeper verification.

## Local Release Gate

Run these commands before any macOS build is considered ready for distribution:

```sh
npm ci
npm run check:electron
npm run release:package:macos
npm run release:verify:macos
```

The current unsigned artifacts are generated at:

```text
dist-electron/mac-arm64/OpenNotion.app
dist-electron/OpenNotion_0.1.1_arm64.dmg
```

## Acceptance Criteria

- The app launches cleanly on a clean macOS user account.
- Notes, images, Studio documents, and settings persist after relaunch.
- `npm run check:electron` passes.
- `npm run release:verify:macos` passes.
- The packaged app opens normally after copying it from the DMG.
- For public releases, Gatekeeper accepts the app after signing and notarization.
- Large local PDFs are handled with clear errors or acceptable performance.
- Beta update notices open the latest GitHub Release DMG manually.

## Pre-Distribution Profiling

Before publishing a build, measure:

- startup time
- idle memory
- memory after long editing session
- memory after opening small and large PDFs
- disk growth after importing and deleting PDFs/images
- size of generated `.app`, SQLite DB, `covers/`, `editor-images/`, and `studio-documents/`
