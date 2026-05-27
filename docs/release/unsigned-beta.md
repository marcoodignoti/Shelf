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

## Create A Beta Release On GitHub

Use a beta tag:

```sh
git switch main
git pull --ff-only origin main
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

Pushing a `v*-beta.*` tag starts the `Tauri Beta Release` workflow. The workflow builds:

- macOS Apple Silicon DMG/app bundle
- Windows installer/bundle

It then creates a GitHub prerelease and uploads the generated artifacts.

You can also rerun the workflow manually against an existing beta tag:

```sh
gh workflow run "Tauri Beta Release" --ref main -f tag=v0.1.0-beta.1
```

## Build Locally

Build unsigned desktop artifacts on the target platform:

```sh
npm ci
npm run check:tauri
npm run tauri build
```

Local Tauri artifacts are generated under `src-tauri/target/release/bundle/`.

## User Warning

Beta users must expect OS trust warnings:

- macOS: unidentified developer warning or "damaged and can't be opened" after browser download
- Windows: SmartScreen warning because installer is unsigned

For macOS private testing:

```sh
xattr -dr com.apple.quarantine /Applications/OpenNotion.app
```

Run that after copying `OpenNotion.app` into `/Applications`, then open the app. This only removes the browser quarantine marker; it does not sign or notarize the app.
