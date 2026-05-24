# Native Parity Roadmap

The native SwiftUI app is the primary macOS product. The legacy Tauri app stays
in the repository only as a parity reference until the native app carries the
same product surface.

## Already Native

- Native SwiftUI shell with `NavigationSplitView`.
- Native GRDB SQLite repository.
- Separate native bundle ID and database path.
- Page create/edit, favorite, Trash, restore, permanent delete.
- Search by title and content metadata.
- Basic block editor with slash menu, headings, lists, checklist, code, divider,
  and block drag/drop.
- Editor reliability basics: title Enter focuses the body, markdown shortcuts
  convert block type, and Backspace merges blocks with an expected caret target.
- Native unsigned/signed `.app` and DMG packaging pipeline.

## Port From Tauri

1. Editor daily reliability:
   - split keeps caret in expected position
   - inline formatting parity
   - undo works for multi-block edits

2. Page shell parity:
   - Home view with recent and favorites
   - command palette with content previews
   - page breadcrumbs
   - page icon picker
   - cover URL and local cover image import
   - duplicate page
   - move page
   - sibling reorder and nested drag/drop in sidebar
   - create subpage from template
   - mark/unmark template

3. Backup and migration:
   - native JSON workspace export
   - native JSON import as duplicates
   - explicit import from legacy Tauri database
   - no implicit startup migration

4. Database pages:
   - default database schema
   - table view
   - board view
   - properties: text, checkbox, select, date
   - sort and filter
   - row templates
   - row reorder
   - property add/edit/delete

5. App polish:
   - settings for appearance and data tools
   - user-facing error notices
   - native visual polish matching final product direction
   - packaged-app UI smoke test path

## Guardrails

- Native defaults stay under `org.opennotion.native`.
- Legacy Tauri defaults stay under `org.opennotion.desktop`.
- Import between products is manual and visible.
- New native behavior gets Swift tests first where possible.
