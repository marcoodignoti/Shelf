# OpenNotion

OpenNotion is a local-first notes app. The active macOS app is native SwiftUI with GRDB-backed SQLite storage. The older Tauri/React implementation remains in the repository for legacy comparison and web/Tauri checks.

## Current Scope

- Create, edit, and permanently delete pages after explicit confirmation.
- Persist page titles and BlockNote document content in local SQLite storage.
- Search pages by title and content through a Rust-backed database command.
- Export the full local workspace as JSON.
- Keep database access behind narrow Tauri commands instead of exposing raw SQL to the renderer.

## Native macOS Stack

- App shell: SwiftUI.
- Storage: SQLite through GRDB.
- Package: SwiftPM in `native-macos`.
- Release artifact: native `.app` and DMG from `scripts/package-native-macos.sh`.

## Legacy Tauri Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, BlockNote.
- Desktop shell: Tauri 2.
- Storage: SQLite through Rust `sqlx`.

## Development

Install dependencies:

```sh
npm install
```

Run frontend build:

```sh
npm run build
```

Run Rust checks/tests:

```sh
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Build desktop app:

```sh
npm run tauri build
```

Build native macOS app:

```sh
swift test --package-path native-macos
script/build_and_run.sh --verify
```

Package native macOS release artifacts:

```sh
npm run release:package:macos
npm run release:verify:macos
```

Production signing and notarization use `.github/workflows/macos-release.yml`.

## Repository Hygiene

Generated artifacts are ignored:

- `node_modules`
- `dist`
- `src-tauri/target`
- local SQLite databases

Keep source, config, lockfiles, and tests under version control.
