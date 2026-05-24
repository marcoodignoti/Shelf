# Native macOS Release Checklist

OpenNotion's active macOS product is the native SwiftUI app in `native-macos`.
Public distribution needs Developer ID signing, hardened runtime, notarization,
stapling, and Gatekeeper verification.

## Current Status

Unsigned/ad-hoc native builds are supported for development and private testing.
Production distribution is blocked until an Apple Developer Program account and
Developer ID Application certificate are available.

Until those credentials exist, local verification may pass only the unsigned
artifact checks. A public release must run with `REQUIRE_DEVELOPER_ID=1`.

## Required Secrets

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

`APPLE_CERTIFICATE` is the base64 encoded `.p12` export of the Developer ID
Application certificate. `APPLE_API_KEY_P8` is the full private key text
downloaded from App Store Connect. The release workflow writes that key to a
temporary file and passes `APPLE_API_KEY_PATH` to `scripts/package-native-macos.sh`.

## Local Release Gate

Run these commands before any native build is considered ready for distribution:

```sh
npm ci
npm run check:native
scripts/test-native-release-pipeline.sh
npm run release:package:macos
npm run release:verify:macos
```

Unsigned private builds may pass `npm run release:verify:macos` without
Developer ID checks. A public release must also pass:

```sh
REQUIRE_DEVELOPER_ID=1 npm run release:verify:macos
```

The default native artifacts live in:

```text
dist/native-release/OpenNotion.app
dist/native-release/OpenNotion_<version>_<arch>.dmg
```

## Acceptance Criteria

- `CFBundleIdentifier` is `org.opennotion.native`.
- The app executable is `OpenNotionNative`.
- The app has the `opennotion://` URL scheme.
- `codesign --verify --deep --strict --verbose=2` accepts the app.
- For public releases, `codesign -dv --verbose=4` does not report `Signature=adhoc`.
- For public releases, `codesign -dv --verbose=4` reports a real `TeamIdentifier`.
- For public releases, `spctl` accepts both the app and DMG.
- The DMG is stapled after successful notarization.

## GitHub Release Workflow

The `macOS Release` workflow runs only on manual dispatch or `v*` tags. It is
separate from CI because release builds require Apple credentials.

Run it after secrets are configured:

```sh
gh workflow run "macOS Release" --ref main
```

For tag releases:

```sh
git tag v0.1.0
git push origin v0.1.0
```
