# Security Policy

## Supported Versions

Security fixes target the latest public release and the `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for a vulnerability that could expose user
data or weaken local app isolation.

Report privately through GitHub's private vulnerability reporting if enabled on
the repository. If it is not enabled, contact the maintainer directly through
the GitHub profile listed on the repository.

Include:

- affected commit or release artifact
- platform and OS version
- reproduction steps
- expected impact
- whether local user data, imported PDFs, or files outside app data can be read,
  modified, or deleted

## Security Model

Shelf is local-first:

- no account system
- no hosted sync backend
- workspace data stored in local app data
- renderer access to local capabilities mediated through Electron IPC
- build artifacts must not include local user databases or imported documents

Default macOS app data path:

```text
~/Library/Application Support/org.opennotion.desktop/
```

## Verifying a release artifact

Each release publishes a `SHA256SUMS` file alongside the artifacts. Verify a
download before opening it:

```sh
# With the SHA256SUMS file in the current directory:
node scripts/verify-release-checksums.cjs Shelf_<version>_arm64.dmg SHA256SUMS

# Or with a single 64-hex hash:
node scripts/verify-release-checksums.cjs Shelf_<version>_arm64.dmg <sha256>
```

The script exits `0` on match and `1` on mismatch.

## Current Distribution Caveats

- macOS builds are ad-hoc signed and **not notarized**. Notarization tooling is
  present but dormant (`scripts/electron-notarize.cjs`): it activates
  automatically once `SHELF_APPLE_ID`, `SHELF_APPLE_APP_SPECIFIC_PASSWORD`,
  `SHELF_APPLE_TEAM_ID`, and a real `SHELF_MAC_CODESIGN_IDENTITY` are provided
  at packaging time. No code change is required when an Apple Developer ID is
  obtained.
- Windows builds are unsigned portable zips.
- OS trust warnings are expected until Developer ID signing, notarization, and
  Windows code signing are implemented. Until then, verify artifacts with
  `SHA256SUMS` as described above.
