# macOS Release Checklist

OpenNotion can build an unsigned local app without Apple credentials. Public production distribution needs Developer ID signing, hardened runtime, notarization, stapling, and Gatekeeper verification.

## Required Secrets

- Apple Developer ID Application certificate in the signing keychain.
- Apple Developer ID Installer certificate if adding installer package formats.
- App Store Connect API key or a configured `notarytool` keychain profile.
- Tauri signing/notarization configuration wired to those credentials.

## Local Release Gate

Run these commands before any public build is considered releasable:

```sh
npm ci
npm run check
npm run tauri build
npm run release:verify:macos
```

`npm run release:verify:macos` is expected to fail for ad-hoc local builds. A releasable artifact must pass:

```sh
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/OpenNotion.app
spctl --assess --type execute --verbose=4 src-tauri/target/release/bundle/macos/OpenNotion.app
spctl --assess --type open --verbose=4 src-tauri/target/release/bundle/dmg/OpenNotion_<version>_<arch>.dmg
```

The DMG filename depends on the app version and build architecture. `scripts/verify-macos-release.sh` derives the default name from `package.json` and the local machine architecture.

## Acceptance Criteria

- `codesign -dv --verbose=4` does not report `Signature=adhoc`.
- `codesign -dv --verbose=4` reports a real `TeamIdentifier`.
- `spctl` accepts both the app and DMG.
- The DMG is stapled after successful notarization.
- The app version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` matches the release tag.
