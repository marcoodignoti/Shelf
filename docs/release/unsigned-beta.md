# Unsigned Beta Release

Unsigned beta releases are for private testing before paid signing credentials exist.

## What This Supports

- macOS unsigned Electron DMG for private testing
- Windows unsigned Electron zip from GitHub Actions for private testing
- signed assisted beta update checks with SHA-256 verified downloads
- ad-hoc macOS codesigning with hardened runtime enabled
- explicit warning text for testers

## What This Does Not Solve

- macOS Gatekeeper trust
- macOS notarization
- Windows installer packaging or SmartScreen trust without Authenticode certs
- production-grade public distribution
- silent auto-install updates

## Build Locally

Build unsigned desktop artifacts on macOS:

```sh
npm ci
npm run check:electron
npm run release:package:electron
npm run release:verify:macos
```

Local Electron artifacts are generated under:

```text
dist-electron/mac-arm64/OpenNotion.app
dist-electron/OpenNotion_0.1.1_arm64.dmg
```

Build the unsigned Windows zip from GitHub Actions by running the `Windows package`
job. It uploads:

```text
OpenNotion_0.1.1_win-x64.zip
```

Generate the update manifest after packaging:

```sh
OPENNOTION_UPDATE_PRIVATE_KEY_PATH=.secrets/opennotion-update-private.pem \
npm run release:update-manifest
```

Upload signed `beta-update.json` with the DMG and ZIP in the same GitHub
Release. See [`docs/release/beta-updates.md`](beta-updates.md).

## Optional Signing Credentials

Free Apple accounts cannot produce Developer ID notarized builds. Current local
macOS packaging uses ad-hoc signing with hardened runtime. If you later get a
Developer ID certificate, set:

```sh
OPENNOTION_MAC_CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
```

Windows Authenticode signing is optional and only runs when certificate env vars
exist:

```sh
OPENNOTION_WINDOWS_PFX_PATH=.secrets/windows-code-signing.pfx
OPENNOTION_WINDOWS_PFX_PASSWORD=...
```

## User Warning

Beta users must expect OS trust warnings:

- macOS: unidentified developer warning or "damaged and can't be opened" after browser download
- Windows: SmartScreen/untrusted app warning

For macOS private testing:

```sh
xattr -dr com.apple.quarantine /Applications/OpenNotion.app
```

Run that after copying `OpenNotion.app` into `/Applications`, then open the app. This only removes the browser quarantine marker; it does not sign or notarize the app.
