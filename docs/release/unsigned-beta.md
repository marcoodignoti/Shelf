# Unsigned Beta Release

Unsigned beta releases are for public testing through GitHub Releases before paid signing credentials exist.

## What This Supports

- macOS DMG artifact from GitHub Actions
- Windows installer artifact from GitHub Actions
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

Or run the workflow manually:

```sh
gh workflow run "Unsigned Beta Release" --ref main -f tag=v0.1.0-beta.1
```

The workflow creates a GitHub prerelease and uploads unsigned macOS and Windows artifacts.

## User Warning

Beta users must expect OS trust warnings:

- macOS: unidentified developer warning, use Control-click or right-click then Open
- Windows: SmartScreen warning because installer is unsigned
