# OpenNotion

OpenNotion is a local-first notes app built with Tauri, React, TypeScript, BlockNote, and SQLite.

## Current Scope

- Create, edit, and permanently delete pages after explicit confirmation.
- Persist page titles and BlockNote document content in local SQLite storage.
- Search pages by title and content through a Rust-backed database command.
- Export the full local workspace as JSON.
- Keep database access behind narrow Tauri commands instead of exposing raw SQL to the renderer.

## Tech Stack

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

## Repository Hygiene

Generated artifacts are ignored:

- `node_modules`
- `dist`
- `src-tauri/target`
- local SQLite databases

Keep source, config, lockfiles, and tests under version control.
