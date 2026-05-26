# Studio Mode Design

## Context

OpenNotion's Tauri app should gain a persistent Studio mode for reading local PDFs and taking notes inside the app. Studio is reachable from the sidebar through a `Note | Studio` switch. It is a separate workflow from normal notes, but it reuses the existing local-first app model and editor where possible.

This design targets the Tauri app only. The native macOS app is a separate product surface and is out of scope for this spec.

The current checkout already contains unrelated modified and untracked files. Implementation should keep Studio changes isolated and avoid mixing them with existing native macOS or unrelated Tauri work.

## Goals

- Add a persistent Studio mode to the Tauri app.
- Let the user import a local PDF into OpenNotion's managed app data.
- Create one linked note for each imported PDF.
- Keep Studio notes hidden from the normal Note sidebar in the first version.
- Show PDF and linked note together in a split Studio view.
- Default to PDF on the left and note on the right.
- Let the user invert PDF and note panel positions.
- Provide a simple PDF viewer with zoom and saved page position if this is practical without a heavy viewer dependency.
- Modernize the sidebar with controlled glass styling, hover states, and solid fallbacks.

## Non-Goals

- Do not add multiple notes per PDF in the first version.
- Do not add folders, tags, annotations, highlights, thumbnails, or full PDF search in the first version.
- Do not require PDF.js for the first version.
- Do not show Studio notes in the regular Note page tree.
- Do not implement native macOS Studio parity as part of this Tauri spec.

## Chosen Approach

Use an MVP integrated into the Tauri app:

- Tauri backend imports and validates PDFs.
- Imported PDFs are copied into an app-managed directory.
- A `studio_documents` table stores persistent document metadata.
- A linked `pages` row stores the note content.
- The frontend adds a Studio mode, contextual sidebar, and split PDF/note view.
- The first PDF viewer should be simple and browser/native-backed where possible, while keeping the data model ready for a later PDF.js upgrade.

This approach avoids the complexity of a complete PDF.js viewer while still satisfying the core product requirement: read and take notes in the same app.

## Sidebar And Navigation

The app keeps one sidebar shell, but its content changes by mode.

In Note mode:

- The existing Note navigation remains the primary experience.
- Normal pages, home, search, templates, and existing sidebar actions continue to work.
- Studio notes are filtered out of the page tree.

In Studio mode:

- The top of the sidebar contains a `Note | Studio` segmented switch.
- `Import PDF` appears near the top.
- `Recenti` lists recently opened or imported Studio documents.
- `Tutti i documenti` lists all imported Studio documents.
- Selecting a Studio document opens the split Studio view.
- Empty state is compact and action-oriented, centered on importing a PDF.

The Studio sidebar should use consistent hover states:

- Switch segments have clear hover and selected states.
- Document rows have hover, active, focus, and truncated-title behavior consistent with existing shell rows.
- Secondary row actions appear through hover or context menu without cluttering the list.
- The import button has a visible hover state and disabled/loading state.

## Visual Direction

The sidebar should move toward a controlled glass style across the whole sidebar:

- Translucent sidebar surface with `backdrop-filter` blur where supported.
- Thin borders and subtle inner highlights.
- Soft hover states on rows, switch segments, and icon buttons.
- Strong enough contrast for readability in light and dark themes.
- Solid fallback background when blur is unsupported or too costly.

The design should remain work-focused. The glass effect should make the shell feel modern without becoming decorative or reducing scan speed.

## Studio Main View

The main Studio view contains a compact toolbar and a split content area.

Toolbar:

- Shows the document title.
- Shows zoom controls if supported by the simple viewer.
- Provides a panel-position toggle for `PDF left` and `Note left`.
- May include secondary actions such as open in system viewer or reveal file if they do not crowd the toolbar.

Split area:

- Default layout is PDF left, note right.
- User can invert the layout; the preference is persisted.
- Initial implementation may use a fixed 50/50 or 55/45 split.
- Resizable split is useful but optional for the first version.
- The note side should reuse the existing editor surface as much as possible, with Studio-specific containment so it does not behave like a normal page in the sidebar.

PDF viewer:

- Uses the imported PDF file as the source.
- Should support zoom if practical with the chosen viewer technique.
- Should save current page when reliable without PDF.js.
- If page tracking is not reliable in the simple viewer, page persistence is best-effort and should not block the first version.
- If rendering fails, the note remains available and the UI offers a fallback action to open the PDF externally.

## Data Model

Add a dedicated `studio_documents` table. Suggested fields:

- `id`
- `title`
- `original_filename`
- `stored_file_path`
- `note_page_id`
- `last_opened_at`
- `created_at`
- `updated_at`
- `viewer_zoom`
- `viewer_page`
- `panel_layout`

The linked note can remain a `pages` row, but it must be explicitly marked as a Studio note. Prefer a clear page classification field such as `workspace_area` or `page_kind` over an opaque metadata workaround, because this creates a cleaner path for future workspace areas.

Relationships:

- One `studio_documents` record has exactly one linked Studio note in the first version.
- The document owns the user-facing Studio navigation item.
- The linked page owns note content and editor persistence.

## Import Flow

1. User clicks `Import PDF` in Studio mode.
2. Frontend opens a file picker for PDFs.
3. Backend validates the selected file.
4. Backend copies the PDF to an app-managed directory such as `Application Support/.../studio-documents/<document-id>/source.pdf`.
5. Backend creates the linked note page.
6. Backend creates the Studio document record.
7. Frontend refreshes Studio documents and opens the imported document.

The original file is not needed after import. The app uses the managed copy as the persistent source.

## Error Handling

- Non-PDF or unreadable file: show a clear error and create no records.
- Duplicate import: allow it in the first version, optionally disambiguating the title.
- Copy succeeds but database write fails: rollback the database transaction or remove the copied file.
- PDF file missing from app storage: show a document-level error with a future-safe repair/remove path.
- Viewer cannot render PDF: keep the note accessible and offer an external open fallback.
- Linked note missing: either recreate an empty linked note or show a repair action. Auto-repair is acceptable only if it is simple and deterministic.

## Testing

Rust/Tauri tests:

- Migration creates `studio_documents`.
- Valid PDF import copies the file into managed storage.
- Non-PDF import is rejected.
- Import creates a linked Studio note.
- Import failure does not leave orphan records or files.
- Studio document listing returns recent and all-document data in the expected order.

TypeScript/Vitest tests:

- Note mode filters out Studio notes.
- Studio sidebar groups documents into `Recenti` and `Tutti i documenti`.
- Panel layout preference toggles and persists.
- Studio document view model handles missing or invalid source data.

Browser QA:

- Switch between Note and Studio.
- Import a sample PDF.
- Open an imported document.
- Verify PDF left and note right by default.
- Invert panels and verify persistence.
- Confirm Studio note does not appear in Note mode.
- Verify hover states across switch, rows, import button, and viewer controls.
- Verify glass sidebar readability in light and dark themes.
- Verify viewer failure fallback if practical.

Final Tauri gates:

- `npm run build`
- `npm run test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- Browser QA on the local Tauri/Vite target
- `npm run check:tauri` when the branch is ready for PR-level validation

## Future Path

The data model should support a later PDF.js iteration without migration churn:

- `viewer_page` and `viewer_zoom` already map to richer viewer state.
- `studio_documents` can later gain annotation or outline tables.
- The split view and toolbar can swap the simple PDF renderer for PDF.js internally without changing the sidebar or document-note relationship.
