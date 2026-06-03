# Unsigned Beta Release

Unsigned beta releases are for private testing before paid signing credentials exist.

## What This Supports

- macOS Electron `.app` bundle
- explicit warning text for testers

## What This Does Not Solve

- macOS Gatekeeper trust
- macOS notarization
- Windows installer packaging
- production-grade public distribution

## Build Locally

Build unsigned desktop artifacts on macOS:

```sh
npm ci
npm run check:electron
npm run release:package:electron
```

Local Electron artifacts are generated under:

```text
dist-electron/mac-arm64/OpenNotion.app
```

## User Warning

Beta users must expect OS trust warnings:

- macOS: unidentified developer warning or "damaged and can't be opened" after browser download
- Windows: not currently packaged in this Electron spike

For macOS private testing:

```sh
xattr -dr com.apple.quarantine /Applications/OpenNotion.app
```

Run that after copying `OpenNotion.app` into `/Applications`, then open the app. This only removes the browser quarantine marker; it does not sign or notarize the app.
