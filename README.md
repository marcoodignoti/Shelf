# OpenNotion

OpenNotion is a local-first desktop workspace for notes, study, and research. It keeps your pages, PDFs, images, and working context on your machine, with a Notion-inspired editor and a focused Studio flow for reading sources while writing notes.

OpenNotion is built with Tauri, React, TypeScript, Tailwind CSS, BlockNote, Rust, and SQLite.

![OpenNotion home dashboard](docs/assets/opennotion-home.png)

## Why OpenNotion

- Local-first by default: your workspace lives in app data, not a remote account.
- Notion-style writing: pages, subpages, icons, favorites, slash-style blocks, lists, checklist, code, divider, and drag/drop ordering.
- Study mode: import a PDF, keep the document on one side, and write the linked note on the other.
- Local images: add images from file picker or paste them into the editor.
- Search and recents: jump through pages without losing writing context.
- Cross-platform path: macOS DMG and Windows builds come from the same Tauri app.

## Study Mode

Studio is built for students and researchers who need to read and write in the same place. Import a local PDF, keep the PDF and its note tied together, and return later with viewer state intact.

![OpenNotion Studio PDF workspace](docs/assets/opennotion-studio-pdf.png)

Current Studio capabilities:

- PDF import through local file copy.
- One linked note per PDF.
- PDF left / note right by default, with layout switch support.
- Resizable split view.
- Zoom and current page controls.
- Recent documents and all documents in the Studio sidebar.
- Rename and delete document actions.
- Persisted viewer page, zoom, and panel layout.

## Core Notes Experience

OpenNotion supports the everyday workspace loop:

![OpenNotion page with subpages](docs/assets/opennotion-page-subpages.png)

1. Create a page or subpage.
2. Add an icon, title, and structured blocks.
3. Move pages through the sidebar.
4. Favorite important pages.
5. Search by title and content.
6. Move pages to Trash, restore them, or permanently delete after confirmation.

The editor stores BlockNote-compatible document content in SQLite, with page metadata and search text kept alongside the document.

### Fast Editing

![OpenNotion slash command menu](docs/assets/opennotion-slash-menu.png)

Type `/` to open the block menu and quickly insert headings, lists, checklist items, quotes, dividers, code, and other structured content.

### Search

![OpenNotion command palette search](docs/assets/opennotion-search.png)

Open search from the sidebar to jump through recent pages and find workspace content without leaving the keyboard.

## Architecture

- Frontend: React, TypeScript, Vite, Tailwind CSS, BlockNote.
- Desktop shell: Tauri 2.
- Storage: SQLite through Rust `sqlx`.
- Data path: `~/Library/Application Support/org.opennotion.desktop/opennotion.db`.

## Development

Install dependencies:

```sh
npm install
```

Run checks:

```sh
npm run check:tauri
```

Build the desktop app:

```sh
npm run tauri build
```

Run all checks:

```sh
npm run check
```

macOS and Windows release builds should be profiled for memory, disk use, startup time, PDF import behavior, and long-session stability before public distribution.

## Repository Hygiene

Generated artifacts are ignored:

- `node_modules`
- `dist`
- `src-tauri/target`
- local SQLite databases

Keep source, config, lockfiles, screenshots, docs, and tests under version control.
