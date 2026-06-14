# Unsigned Beta Release

Unsigned beta releases are for private testing before paid signing credentials exist.

## What This Supports

- macOS ad-hoc signed Electron DMG for private testing
- Windows unsigned Electron zip from GitHub Actions for private testing
- Windows unsigned NSIS installer from GitHub Actions for private testing
- signed assisted beta update checks with SHA-256 verified downloads
- Windows installer guided downloads through the signed update manifest
- ad-hoc macOS codesigning with hardened runtime enabled
- explicit warning text for testers

## What This Does Not Solve

- macOS Gatekeeper trust
- macOS notarization
- Windows SmartScreen trust without Authenticode certs
- production-grade public distribution
- macOS silent auto-install updates without Developer ID and notarization

## Build Locally

Build ad-hoc signed desktop artifacts on macOS:

```sh
npm ci
npm run check:electron
npm run release:package:electron
npm run release:verify:macos
```

Local Electron artifacts are generated under:

```text
dist-electron/mac-arm64/Shelf.app
dist-electron/Shelf_0.1.1_arm64.dmg
```

Build the unsigned Windows zip and installer from GitHub Actions by running the
`Windows package` job. It uploads:

```text
Shelf_0.1.4_win-x64.zip
Shelf_0.1.4_setup_win-x64.exe
```

Generate the update manifest after packaging:

```sh
SHELF_UPDATE_PRIVATE_KEY_PATH=.secrets/shelf-update-private.pem \
npm run release:update-manifest
```

Local macOS dry-runs can generate a manifest with only the DMG present. Full
multi-platform releases should set `SHELF_UPDATE_REQUIRE_ALL_ARTIFACTS=1`
after the Windows ZIP exists.

Upload signed `beta-update.json` with the DMG, ZIP, and installer in the same
GitHub Release. Then update the stable `beta` release manifest too;
otherwise existing beta apps can keep seeing an old version. See
[`docs/release/beta-updates.md`](beta-updates.md).

## Optional Signing Credentials

Free Apple accounts cannot produce Developer ID notarized builds. Current local
macOS packaging uses ad-hoc signing with hardened runtime. If you later get a
Developer ID certificate, set:

```sh
SHELF_MAC_CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
```

Windows Authenticode signing is optional and only runs when certificate env vars
exist:

```sh
SHELF_WINDOWS_PFX_PATH=.secrets/windows-code-signing.pfx
SHELF_WINDOWS_PFX_PASSWORD=...
```

## User Warning

Beta users must expect OS trust warnings:

- macOS: unidentified developer warning or "damaged and can't be opened" after browser download
- Windows: SmartScreen/untrusted app warning

For macOS private testing:

```sh
xattr -dr com.apple.quarantine /Applications/Shelf.app
```

Run that after copying `Shelf.app` into `/Applications`, then open the app. This only removes the browser quarantine marker; it does not sign or notarize the app.
