# OpenNotion

OpenNotion is a local-first notes app. The active macOS app is native SwiftUI with GRDB-backed SQLite storage. The older Tauri/React implementation remains in the repository for legacy comparison and web/Tauri checks.

## Current Scope

- Create, edit, move to Trash, restore, and permanently delete pages after explicit confirmation.
- Persist page titles, metadata, and BlockNote-compatible document content in native SQLite storage.
- Search pages by title and content through the native GRDB repository.
- Edit basic native blocks: paragraph, headings, lists, checklist, code, divider, slash menu, and drag/drop ordering.
- Package unsigned or signed native macOS `.app` and DMG artifacts.

See `docs/native-parity-roadmap.md` for remaining Tauri-to-native parity work.

## Native macOS Stack

- App shell: SwiftUI.
- Storage: SQLite through GRDB.
- Package: SwiftPM in `native-macos`.
- Release artifact: native `.app` and DMG from `scripts/package-native-macos.sh`.
- Data path: `~/Library/Application Support/org.opennotion.native/opennotion-native.db`.

## Legacy Tauri Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, BlockNote.
- Desktop shell: Tauri 2.
- Storage: SQLite through Rust `sqlx`.
- Data path: `~/Library/Application Support/org.opennotion.desktop/opennotion.db`.

The native macOS app and the legacy Tauri app intentionally use separate bundle identifiers and separate databases.

## Development

Install dependencies:

```sh
npm install
```

Run native macOS checks:

```sh
npm run check:native
```

Build and launch native macOS app:

```sh
script/build_and_run.sh --verify
```

Package native macOS release artifacts:

```sh
npm run release:package:macos
npm run release:verify:macos
```

Run legacy Tauri checks:

```sh
npm run check:tauri
```

Build legacy Tauri app:

```sh
npm run tauri build
```

Production native signing and notarization use `.github/workflows/macos-release.yml`.

Run all repo checks:

```sh
npm run check
```

## Native Parity Target

The native app is the primary macOS product. Legacy Tauri remains as a comparison implementation until parity is complete. Port work must keep:

- native bundle ID: `org.opennotion.native`
- native database path: `~/Library/Application Support/org.opennotion.native/opennotion-native.db`
- legacy Tauri bundle ID: `org.opennotion.desktop`
- legacy Tauri database path: `~/Library/Application Support/org.opennotion.desktop/opennotion.db`

Any migration or import between native and Tauri databases must be an explicit user action.

## Native Development

```sh
swift test --package-path native-macos
script/build_and_run.sh --verify
```

## Repository Hygiene

Generated artifacts are ignored:

- `node_modules`
- `dist`
- `src-tauri/target`
- local SQLite databases

Keep source, config, lockfiles, and tests under version control.
