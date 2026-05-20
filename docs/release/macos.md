# macOS Release Checklist

OpenNotion can build an unsigned local app without Apple credentials. Public production distribution needs Developer ID signing, hardened runtime, notarization, stapling, and Gatekeeper verification.

## Required Secrets

- Apple Developer ID Application certificate in the signing keychain.
- Apple Developer ID Installer certificate if adding installer package formats.
- App Store Connect API key or a configured `notarytool` keychain profile.
- Tauri signing/notarization configuration wired to those credentials.

For GitHub Actions, configure these repository secrets:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
KEYCHAIN_PASSWORD
APPLE_API_ISSUER
APPLE_API_KEY
APPLE_API_KEY_P8
APPLE_TEAM_ID
```

`APPLE_CERTIFICATE` is the base64 encoded `.p12` export of the Developer ID Application certificate. `APPLE_API_KEY_P8` is the full private key text downloaded from App Store Connect. The manual/tag workflow in `.github/workflows/macos-release.yml` writes that key to a temporary file and passes `APPLE_API_KEY_PATH` to Tauri.

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
- `codesign -dv --verbose=4` reports `Runtime Version`, proving hardened runtime is enabled.
- `spctl` accepts both the app and DMG.
- The DMG is stapled after successful notarization.
- The app version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` matches the release tag.

## GitHub Release Workflow

The `macOS Release` workflow runs only on manual dispatch or `v*` tags. It is separate from CI because unsigned PR builds must stay fast and green, while release builds require Apple credentials.

Run it after secrets are configured:

```sh
gh workflow run "macOS Release" --ref main
```

For tag releases:

```sh
git tag v0.1.0
git push origin v0.1.0
```
