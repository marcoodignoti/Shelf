# OpenNotion

<p align="center">
  <img src="assets/app-icon.png" alt="OpenNotion app icon" width="112" height="112">
</p>

<p align="center">
  <strong>A local-first desktop workspace for notes, PDFs, study, and research.</strong>
</p>

<p align="center">
  <a href="https://github.com/marcoodignoti/OpenNotion/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/marcoodignoti/OpenNotion/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-black">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-40-47848f">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6">
</p>

OpenNotion is a private, local-first alternative for people who want a polished
document workspace without sending their notes, PDFs, images, and study context
to a remote account. It pairs a Notion-inspired editor with a focused Studio
mode for reading sources while writing linked notes.

It is built as a desktop app with Electron, React, TypeScript, BlockNote, and
SQLite.

![OpenNotion home dashboard](docs/assets/opennotion-home.png)

## Highlights

- **Local-first storage**: workspace data lives on your machine in SQLite.
- **Notion-style writing**: pages, subpages, icons, favorites, slash commands,
  structured blocks, lists, checklists, code, formulas, dividers, and drag/drop
  ordering.
- **Studio for research**: import a PDF, read it side-by-side with a linked
  note, and resume later with viewer state intact.
- **Fast navigation**: sidebar, recents, favorites, full workspace search, and
  command-style page switching.
- **Local media**: paste or select images and keep them in local app storage.
- **Desktop packaging**: unsigned macOS DMG, Windows portable zip, and Windows
  NSIS installer through GitHub Actions.

## Product Tour

### Notes That Stay Local

Create pages and subpages, organize them from the sidebar, favorite important
work, and recover deleted pages from Trash.

![OpenNotion page with subpages](docs/assets/opennotion-page-subpages.png)

OpenNotion stores editor content, page metadata, search text, images, covers,
and Studio documents in the local app data directory. There is no hosted sync
service in this repository.

### Studio Mode

Studio is designed for students, researchers, and builders who need to read and
write in one place. Import a PDF, keep the source and linked note together, and
move between reading and writing without context switching.

![OpenNotion Studio PDF workspace](docs/assets/opennotion-studio-pdf.png)

Current Studio capabilities:

- local PDF import
- one linked note per document
- split PDF/note workspace
- continuous, single-page, and two-page view modes
- zoom, current page, and panel layout persistence
- projects, folders, rename, drag/drop organization, and delete flows

### Fast Editing

Type `/` to insert structured content quickly: headings, lists, checklists,
quotes, dividers, code blocks, formulas, and more.

![OpenNotion slash command menu](docs/assets/opennotion-slash-menu.png)

### Search

Jump through recent pages and search workspace content without leaving the
keyboard.

![OpenNotion command palette search](docs/assets/opennotion-search.png)

## Privacy Model

OpenNotion has no account system and no cloud backend in this repository.

Default macOS data path:

```text
~/Library/Application Support/org.opennotion.desktop/
```

Important local files:

```text
opennotion.db
covers/
editor-images/
studio-documents/
```

Build artifacts do **not** include your personal database. A build installed on
another computer starts with that computer's own empty app data directory.

## Installation

OpenNotion `v0.1.1` is the current private beta release.

### macOS

Download `OpenNotion_0.1.1_arm64.dmg` from the latest GitHub release or build it
locally:

```sh
npm ci
npm run release:package:macos
npm run release:verify:macos
```

Generated artifact:

```text
dist-electron/OpenNotion_0.1.1_arm64.dmg
```

Because the current macOS build is ad-hoc signed with hardened runtime and not
notarized, macOS may show an unidentified developer warning. For private
testing after copying the app to `/Applications`:

```sh
xattr -dr com.apple.quarantine /Applications/OpenNotion.app
```

### Windows

Download the Windows installer from the latest GitHub release:

```text
OpenNotion_0.1.3_setup_win-x64.exe
```

The installer checks for newer Windows releases in background, downloads them
automatically, and installs on app quit.

Portable compatibility build:

```text
OpenNotion_0.1.3_win-x64.zip
```

1. Extract the zip.
2. Run `OpenNotion.exe`.

Both Windows builds are unsigned. Windows SmartScreen may show an untrusted app
warning until Authenticode signing is configured.

## Development

Requirements:

- Node.js 22+
- npm
- macOS for DMG packaging
- Windows or GitHub Actions for Windows packaging

Install dependencies:

```sh
npm ci
```

Run the Electron dev app:

```sh
npm run electron:dev
```

Run the full local gate:

```sh
npm run check
```

Run browser E2E tests:

```sh
npm run e2e
```

Build desktop artifacts:

```sh
npm run release:package:macos
npm run release:verify:macos
```

Generate a signed beta update manifest after packaging:

```sh
OPENNOTION_UPDATE_PRIVATE_KEY_PATH=.secrets/opennotion-update-private.pem \
npm run release:update-manifest
```

Windows packaging script, intended for Windows runners:

```sh
npm run release:package:windows
npm run release:package:windows:installer
```

## Architecture

```text
React + TypeScript + Vite
        |
        v
Electron preload bridge
        |
        v
Electron main process
        |
        v
SQLite + local filesystem app data
```

Key implementation areas:

- `src/` - React workspace, editor, Studio, state, tests
- `electron/` - Electron main/preload/backend and packaged-app smokes
- `scripts/` - macOS DMG, Windows packages, release verification
- `tests/e2e/` - production-preview browser flows
- `docs/` - release, testing, migration, and data-location notes

## Release Status

Current public-readiness level:

- macOS public release: supported as ad-hoc signed DMG
- Windows public release: supported as unsigned portable zip and unsigned NSIS installer
- Beta update manifests: Ed25519 signed, with SHA-256 verified artifacts
- Public notarized macOS release: not yet supported
- Authenticode-signed Windows installer: not yet supported
- Hosted sync/account service: intentionally not present

Before a broad public release, profile startup time, memory, long editing
sessions, large PDFs, import/delete disk growth, and OS trust/signing flows.

## Roadmap

- signed and notarized macOS distribution
- signed Windows installer
- import/export improvements
- richer Studio workflows for research projects
- optional backup/export tooling
- performance profiling for large workspaces and large PDFs

## License

OpenNotion source code is released under the MIT License. See
[LICENSE](LICENSE).

Third-party dependency license notes are tracked in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The OpenNotion name, app icon, screenshots, and repository assets are included
for use with this project. Do not use them to imply endorsement of unrelated
software.
