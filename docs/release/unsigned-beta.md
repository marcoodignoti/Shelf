# Unsigned Beta Release

Unsigned beta releases are for public testing before paid signing credentials exist.

## What This Supports

- macOS DMG artifact from Tauri
- Windows installer artifact from Tauri
- GitHub prerelease with explicit warning text

## What This Does Not Solve

- macOS Gatekeeper trust
- macOS notarization
- Windows SmartScreen trust
- production-grade public distribution

## Create A Beta Release

Use a beta tag:

```sh
git switch main
git pull --ff-only origin main
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

Build the unsigned desktop artifacts on the target platform:

```sh
npm ci
npm run check:tauri
npm run tauri build
```

Upload the generated Tauri artifacts from `src-tauri/target/release/bundle/` to a GitHub prerelease.

## User Warning

Beta users must expect OS trust warnings:

- macOS: unidentified developer warning or "damaged and can't be opened" after browser download
- Windows: SmartScreen warning because installer is unsigned

For macOS private testing:

```sh
xattr -dr com.apple.quarantine /Applications/OpenNotion.app
```

Run that after copying `OpenNotion.app` into `/Applications`, then open the app. This only removes the browser quarantine marker; it does not sign or notarize the app.
