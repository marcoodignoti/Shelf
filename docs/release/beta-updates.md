# Beta Updates

OpenNotion uses signed assisted beta updates for testers.

This is not a silent auto-updater. Current macOS builds are ad-hoc signed and
Windows builds are unsigned, so the app checks a small GitHub Release manifest,
verifies its Ed25519 signature, shows a brief changelog, downloads the matching
DMG or ZIP, and verifies the artifact SHA-256 before opening it.

## Tester Flow

1. App starts and checks `beta-update.json` from the beta channel release.
   Only the repository allowlisted GitHub Release URLs are accepted.
2. If the manifest version is newer than the installed `package.json` version,
   OpenNotion shows a beta update notice.
3. Tester reads the short changelog and downloads the matching build.
   The app rejects unsigned manifests, bad signatures, wrong hosts, and
   artifacts whose SHA-256 does not match the manifest.
4. Tester replaces the app manually.

On macOS, testers can alternatively use the Homebrew beta cask documented in
[`homebrew.md`](homebrew.md). Windows testers use the guided ZIP download.

## Create Manifest

Generate an Ed25519 update signing key once:

```sh
npm run release:update-keypair
```

Put the public key in `electron/update-public-key.pem`. Store the private key in
a local secret manager or GitHub Actions secret, never in git.

After packaging the beta artifacts, generate:

```sh
OPENNOTION_UPDATE_PRIVATE_KEY_PATH=.secrets/opennotion-update-private.pem \
OPENNOTION_UPDATE_VERSION=0.1.1 \
OPENNOTION_UPDATE_TAG=v0.1.1 \
OPENNOTION_UPDATE_TITLE="OpenNotion 0.1.1" \
OPENNOTION_UPDATE_SUMMARY="Studio links, bookmarks, shared search, and beta updates." \
OPENNOTION_UPDATE_CHANGES="PDFs can link multiple notes;Inline page links show previews;Studio notes appear in Notes search;Slash command search is more accurate;Beta updates now include changelog" \
npm run release:update-manifest
```

Generated file:

```text
dist-electron/beta-update.json
```

Upload the DMG, ZIP, and release-local manifest to the versioned GitHub Release:

```text
OpenNotion_0.1.1_arm64.dmg
OpenNotion_0.1.1_win-x64.zip
beta-update.json
```

Then upload the same `beta-update.json` to the `beta` release, replacing the
old asset. The app checks this deterministic channel URL first:

```text
https://github.com/marcoodignoti/OpenNotion/releases/download/beta/beta-update.json
```

The legacy `releases/latest/download/beta-update.json` URL remains a fallback
for older builds and GitHub cache edge cases.

## Manifest Format

```json
{
  "signatureAlgorithm": "ed25519",
  "payload": {
    "version": "0.1.1",
    "channel": "beta",
    "publishedAt": "2026-06-04T00:00:00.000Z",
    "title": "OpenNotion 0.1.1",
    "summary": "Studio links, bookmarks, shared search, and beta updates.",
    "changes": [
      "PDFs can link multiple notes",
      "Inline page links show previews",
      "Studio notes appear in Notes search"
    ],
    "downloads": {
      "macosArm64": {
        "url": "https://github.com/marcoodignoti/OpenNotion/releases/download/v0.1.1/OpenNotion_0.1.1_arm64.dmg",
        "label": "macOS Apple Silicon",
        "sha256": "..."
      },
      "windowsX64": {
        "url": "https://github.com/marcoodignoti/OpenNotion/releases/download/v0.1.1/OpenNotion_0.1.1_win-x64.zip",
        "label": "Windows x64 portable zip",
        "sha256": "..."
      }
    }
  },
  "signature": "base64-ed25519-signature"
}
```

Keep `changes` short: three to five concrete points, no marketing copy.
