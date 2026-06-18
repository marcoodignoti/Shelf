# Shelf Local API Documentation

Shelf does not expose an HTTP server API. Its public application API is the Electron preload bridge exposed to the renderer as `window.openNotion`, backed by IPC handlers in `electron/main.cjs` and command handlers in `electron/backend-*.cjs`.

Most operations use this shape:

```ts
await window.openNotion.invoke(commandName, args)
```

The frontend should normally call the typed wrappers in `src/lib/db.ts`, `src/lib/studio.ts`, `src/lib/profile.ts`, `src/lib/backup.ts`, and `src/lib/desktop.ts` instead of calling `invoke` directly.

## System Role Prompts

No application system-role prompts or AI chat message templates are present in this codebase. Shelf is a local-first notes and PDF workspace; the public API documented here is Electron IPC plus local filesystem helpers.

If generating or updating this documentation with an AI assistant, use a system role prompt like:

```text
You are a senior technical writer documenting a local-first Electron application. Document only APIs that are present in the repository. Treat Electron IPC commands as local endpoints. Include request and response shapes, usage examples, constraints, and security boundaries. Do not invent HTTP routes or AI chat prompts.
```

## Transport

### `window.openNotion.invoke(command, args?)`

Runs a registered backend command.

Request:

```ts
{
  command: DesktopCommandName;
  args?: Record<string, unknown>;
}
```

Response:

```ts
Promise<DesktopCommandResult<typeof command>>
```

Errors reject the promise with an `Error`. Backend commands accept both camelCase and snake_case for many timestamp and foreign-key fields, for example `createdAt` or `created_at`.

Example:

```ts
const page = await window.openNotion!.invoke("create_page", {
  id: crypto.randomUUID(),
  title: "Reading notes",
  parentId: null,
  createdAt: new Date().toISOString(),
});
```

## Common Models

### `Page`

```ts
interface Page {
  id: string;
  title: string;
  parent_id: string | null;
  content: string | null;
  search_text: string | null;
  icon: string | null;
  cover_url: string | null;
  is_deleted: number;
  is_favorite: number;
  is_template: number;
  is_database?: number;
  database_schema?: string | null;
  properties?: string | null;
  sort_order: number;
  page_kind: "note" | "studio_note" | "project";
  created_at: string;
  updated_at: string;
  content_loaded?: number;
}
```

### `SearchResult`

`SearchResult` extends `Page` with:

```ts
matched_content: string | null;
```

### `StudioDocument`

```ts
interface StudioDocument {
  id: string;
  title: string;
  original_filename: string;
  stored_file_path: string;
  note_page_id: string;
  project_id: string | null;
  last_opened_at: string;
  viewer_zoom: number;
  viewer_page: number;
  panel_layout: "pdf-left" | "note-left";
  created_at: string;
  updated_at: string;
}
```

### `StudioProject`

```ts
interface StudioProject {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
```

### `StudioDocumentPageLink`

```ts
interface StudioDocumentPageLink {
  id: string;
  document_id: string;
  page_id: string;
  pdf_page: number | null;
  label: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  page: Page;
}
```

### `WorkspaceProfile`

```ts
interface WorkspaceProfile {
  name: string;
  workspaceName: string;
  avatarPath: string | null;
}
```

## Page Endpoints

### `list_pages`

Lists non-deleted note, studio note, and project pages. Page content is not loaded.

Request:

```ts
undefined
```

Response:

```ts
Page[]
```

Example:

```ts
const pages = await invoke("list_pages");
```

### `list_all_pages`

Lists every page row, including deleted pages and full content.

Request: `undefined`

Response: `Page[]`

Example:

```ts
const allPages = await invoke("list_all_pages");
```

### `search_pages`

Searches page titles and indexed content for non-deleted note and studio-note pages. Returns up to 50 results.

Request:

```ts
{ query: string }
```

Response:

```ts
SearchResult[]
```

Example:

```ts
const results = await invoke("search_pages", { query: "electron sqlite" });
```

Limitations:

- Empty or whitespace-only queries return `[]`.
- Uses SQLite FTS when available and falls back to `LIKE`.
- Project pages are not searched.

### `get_page`

Fetches a single page by ID.

Request:

```ts
{ id: string }
```

Response:

```ts
Page | null
```

Example:

```ts
const page = await invoke("get_page", { id: "page-1" });
```

### `create_page`

Creates a note page.

Request:

```ts
{
  id: string;
  title?: string;
  parentId?: string | null;
  parent_id?: string | null;
  createdAt?: string;
  created_at?: string;
}
```

Response: `Page`

Example:

```ts
const page = await invoke("create_page", {
  id: crypto.randomUUID(),
  title: "New note",
  parentId: null,
  createdAt: new Date().toISOString(),
});
```

Constraints:

- `id`, `title`, and timestamp values must be bounded strings.
- New pages are inserted before existing siblings by assigning a lower `sort_order`.

### `create_project`

Creates a project page.

Request:

```ts
{
  id: string;
  title?: string;
  createdAt?: string;
  created_at?: string;
}
```

Response: `Page`

Constraints:

- Project title cannot be empty after trimming.
- Created page has `page_kind: "project"`.

### `update_page`

Updates allowed page columns.

Request:

```ts
{
  id: string;
  updates: Partial<Page>;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Allowed `updates` fields:

```ts
title, parent_id, content, search_text, icon, cover_url,
is_deleted, is_favorite, is_template, is_database,
database_schema, properties, page_kind
```

Example:

```ts
await invoke("update_page", {
  id: "page-1",
  updates: {
    title: "Updated title",
    content: JSON.stringify([{ type: "paragraph", content: "Hello" }]),
  },
  updatedAt: new Date().toISOString(),
});
```

Notes:

- Updating `content` also updates `search_text`; if `search_text` is omitted, content is used.
- Updating a mirrored Studio project page title also updates the corresponding Studio project name.

### `delete_page`

Deletes a page and its descendants.

Request:

```ts
{ id: string }
```

Response: `void`

Constraints:

- A Studio document primary note cannot be deleted directly. Delete the Studio document first.
- Related Studio document links for deleted pages are removed.

### `delete_project`

Deletes a project page and detaches its children.

Request:

```ts
{
  id: string;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- Only pages with `page_kind: "project"` can be deleted through this command.
- Child pages and linked Studio documents/projects are detached rather than recursively deleted.

### `move_page`

Moves a page under a new parent or to the root.

Request:

```ts
{
  id: string;
  parentId?: string | null;
  parent_id?: string | null;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- A page cannot be moved under itself.
- A page cannot be moved under one of its descendants.
- Non-null parent IDs must point to an existing non-deleted page.

### `reorder_pages`

Reorders siblings under a parent.

Request:

```ts
{
  parentId?: string | null;
  parent_id?: string | null;
  orderedIds?: string[];
  ordered_ids?: string[];
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Example:

```ts
await invoke("reorder_pages", {
  parentId: null,
  orderedIds: ["page-a", "page-b", "page-c"],
  updatedAt: new Date().toISOString(),
});
```

Constraints:

- `orderedIds` must all be non-deleted pages under the given parent.
- Empty order arrays are ignored.

### `import_pages`

Bulk imports page records.

Request:

```ts
{ pages: Page[] }
```

Response:

```ts
number // inserted row count
```

Constraints:

- Maximum 5,000 pages.
- Page fields are sanitized and length-limited.
- Imported media block URLs are sanitized.

### `toggle_favorite`

Sets page favorite state.

Request:

```ts
{
  id: string;
  isFavorite?: boolean;
  is_favorite?: boolean;
}
```

Response: `void`

### `toggle_template`

Sets page template state.

Request:

```ts
{
  id: string;
  isTemplate?: boolean;
  is_template?: boolean;
}
```

Response: `void`

### `create_page_from_template`

Copies a template page into a new note page.

Request:

```ts
{
  id: string;
  templateId?: string;
  template_id?: string;
  parentId?: string | null;
  parent_id?: string | null;
  createdAt?: string;
  created_at?: string;
}
```

Response: `Page`

Constraints:

- Source template page must exist.
- New page copies content, icon, cover, database schema, and properties.

### `duplicate_page`

Duplicates an existing page beside the source page.

Request:

```ts
{
  id: string;
  sourceId?: string;
  source_id?: string;
  createdAt?: string;
  created_at?: string;
}
```

Response: `Page`

Constraints:

- Source page must exist.
- Duplicate title is prefixed with `Copy of `.

## Backup Endpoints

### `export_backup`

Exports all pages and basic profile metadata to a JSON file path.

Request:

```ts
{
  path: string;
  exportedAt?: string;
  exported_at?: string;
}
```

Response:

```ts
number // number of exported pages
```

Example:

```ts
const count = await invoke("export_backup", {
  path: "/Users/me/Desktop/shelf-backup.json",
  exportedAt: new Date().toISOString(),
});
```

Constraints:

- Direct renderer calls to `export_backup` are blocked; use `window.openNotion.exportBackup()` so a trusted native save dialog selects the path.
- Backup output must be 50 MB or smaller.
- The write is temp-file plus rename to avoid truncated backups.

### `import_backup`

Imports a JSON backup from a file path.

Request:

```ts
{
  path: string;
  importedAt?: string;
  imported_at?: string;
}
```

Response:

```ts
number // imported page count
```

Constraints:

- Direct renderer calls to `import_backup` are blocked; use `window.openNotion.importBackup()`.
- Backup file must be JSON, version `1`, 50 MB or smaller, and contain at most 5,000 pages.
- Imported page IDs are remapped to avoid collisions.
- Profile metadata is only restored when the current profile is still default.

### `import_backup_content`

Imports backup JSON already loaded as a string.

Request:

```ts
{
  content: string;
  importedAt?: string;
  imported_at?: string;
}
```

Response: `number`

Example:

```ts
await invoke("import_backup_content", {
  content: rawBackupJson,
  importedAt: new Date().toISOString(),
});
```

## Studio Document Endpoints

### `list_studio_documents`

Lists Studio PDF documents.

Request: `undefined`

Response: `StudioDocument[]`

Ordering: most recently opened first, then newest first.

### `import_studio_document`

Copies a PDF into Shelf storage, creates its primary note page, and creates a primary page link.

Request:

```ts
{
  documentId?: string;
  document_id?: string;
  notePageId?: string;
  note_page_id?: string;
  sourcePath?: string;
  source_path?: string;
  importedAt?: string;
  imported_at?: string;
}
```

Response: `StudioDocument`

Example:

```ts
const document = await window.openNotion!.importStudioDocument!({
  documentId: crypto.randomUUID(),
  notePageId: crypto.randomUUID(),
  importedAt: new Date().toISOString(),
});
```

Constraints:

- Direct renderer calls with `sourcePath` are blocked. Use `window.openNotion.importStudioDocument()` to select the PDF through a native dialog.
- Source must be a valid `.pdf` file with `%PDF-` header.
- PDF size limit is 512 MB.
- Document ID and note page ID must not already exist.
- The stored file lives under Shelf's application support directory.

### `replace_studio_document_file`

Replaces the stored PDF for an existing Studio document.

Request:

```ts
{
  id: string;
  sourcePath?: string;
  source_path?: string;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `StudioDocument`

Constraints:

- Direct renderer calls with `sourcePath` are blocked. Use `window.openNotion.replaceStudioDocumentFile()`.
- Document must exist.
- Replacement file must be a valid PDF and 512 MB or smaller.

### `update_studio_document_viewer_state`

Stores viewer state for a Studio document.

Request:

```ts
{
  id: string;
  updates: {
    viewer_zoom?: number;
    viewer_page?: number;
    panel_layout?: "pdf-left" | "note-left";
    last_opened_at?: string;
  };
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- `viewer_zoom` is clamped to 25-300.
- `viewer_page` is clamped to at least 1.
- Invalid `panel_layout` values are ignored.

### `rename_studio_document`

Renames a Studio document and its primary note page.

Request:

```ts
{
  id: string;
  title: string;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- Title cannot be empty after trimming.
- Document must exist.

### `delete_studio_document`

Deletes a Studio document, all its page links, its primary note page subtree, and its stored PDF.

Request:

```ts
{ id: string }
```

Response: `void`

Constraints:

- Document must exist.
- Stored PDF cleanup is restricted to the managed Studio documents directory.

### `open_studio_document_file`

Opens the managed PDF in the operating system.

Request:

```ts
{ id: string }
```

Response: `void`

### `reveal_studio_document_file`

Reveals the managed PDF in the operating system file manager.

Request:

```ts
{ id: string }
```

Response: `void`

## Studio Project Endpoints

### `list_studio_projects`

Lists Studio projects.

Request: `undefined`

Response: `StudioProject[]`

Ordering: `sort_order ASC`, then name.

### `create_studio_project`

Creates a Studio project.

Request:

```ts
{
  id: string;
  name: string;
  parentId?: string | null;
  parent_id?: string | null;
  createdAt?: string;
  created_at?: string;
}
```

Response: `StudioProject`

Constraints:

- Name cannot be empty after trimming.
- Parent project must exist when provided.
- In unified Studio mode, a mirrored project page is also created.

### `rename_studio_project`

Renames a Studio project.

Request:

```ts
{
  id: string;
  name: string;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- Name cannot be empty.
- Project must exist.
- In unified Studio mode, the mirrored project page title is updated.

### `update_studio_project_parent`

Moves a Studio project under another Studio project or to root.

Request:

```ts
{
  id: string;
  parentId?: string | null;
  parent_id?: string | null;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- Project cannot be its own parent.
- Parent must exist when provided.
- Project cycles are rejected.

### `delete_studio_project`

Deletes a Studio project and detaches its child projects and documents.

Request:

```ts
{
  id: string;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- Project must exist.
- Documents assigned to the project are moved to no project.
- Child Studio projects are moved to root.

### `update_studio_document_project`

Assigns a Studio document to a Studio project.

Request:

```ts
{
  id: string;
  projectId?: string | null;
  project_id?: string | null;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- Document must exist.
- Non-null project must exist.
- In unified Studio mode, the primary note page parent is mirrored.

## Studio Page Link Endpoints

### `list_all_studio_document_page_links`

Lists all links between Studio documents and pages.

Request: `undefined`

Response: `StudioDocumentPageLink[]`

### `list_studio_document_page_links`

Lists links for one Studio document.

Request:

```ts
{
  documentId?: string;
  document_id?: string;
}
```

Response: `StudioDocumentPageLink[]`

### `link_studio_document_page`

Links a page to a Studio document.

Request:

```ts
{
  id: string;
  documentId?: string;
  document_id?: string;
  pageId?: string;
  page_id?: string;
  pdfPage?: number | null;
  pdf_page?: number | null;
  label?: string | null;
  createdAt?: string;
  created_at?: string;
}
```

Response: `StudioDocumentPageLink`

Example:

```ts
const link = await invoke("link_studio_document_page", {
  id: crypto.randomUUID(),
  documentId: "doc-1",
  pageId: "page-1",
  pdfPage: 12,
  label: "Chapter notes",
  createdAt: new Date().toISOString(),
});
```

Constraints:

- Document and page must exist.
- `pdfPage` is rounded and clamped to at least 1, or stored as `null`.
- Linking the same document/page again updates `pdf_page` and `label`.

### `update_studio_document_page_link`

Updates a Studio page link.

Request:

```ts
{
  id: string;
  pdfPage?: number | null;
  pdf_page?: number | null;
  label?: string | null;
  updatedAt?: string;
  updated_at?: string;
}
```

Response: `void`

Constraints:

- Link must exist.
- Invalid non-null `pdfPage` values are rejected.

### `unlink_studio_document_page`

Deletes a Studio page link.

Request:

```ts
{ id: string }
```

Response: `void`

Constraints:

- Link must exist.

## Studio Migration Endpoints

### `preview_studio_page_unification`

Previews whether legacy Studio projects/documents can be unified into the page tree.

Request: `undefined`

Response:

```ts
interface StudioPageUnificationPreview {
  schema_version: string;
  project_count: number;
  nested_project_count: number;
  document_count: number;
  document_without_project_count: number;
  link_count: number;
  linked_regular_page_count: number;
  linked_studio_note_count: number;
  missing_primary_page_count: number;
  missing_primary_link_count: number;
  orphan_link_count: number;
  blockers: string[];
  can_migrate: boolean;
}
```

### `migrate_studio_page_unification`

Runs the Studio page unification migration.

Request:

```ts
{
  migratedAt?: string;
  migrated_at?: string;
}
```

Response: `StudioPageUnificationPreview`

Constraints:

- Migration only proceeds when the preview reports `can_migrate: true`.
- The operation is intended to be idempotent and schema-version gated.

## Asset Endpoints

### `import_cover_image`

Copies a cover image into managed Shelf storage.

Request:

```ts
{
  pageId?: string;
  page_id?: string;
  sourcePath?: string;
  source_path?: string;
}
```

Response:

```ts
string // stored absolute file path
```

Constraints:

- Direct renderer calls with `sourcePath` are blocked. Use `window.openNotion.importCoverImage()`.
- Supported formats: PNG, JPG/JPEG, WebP, GIF.
- File size limit: 10 MB.
- Magic bytes must match the file extension.

### `import_editor_image`

Stores an editor image either from bytes or a trusted native-dialog source path.

Request:

```ts
{
  pageId?: string;
  page_id?: string;
  fileName?: string;
  file_name?: string;
  bytes?: number[] | Uint8Array;
  sourcePath?: string;
  source_path?: string;
}
```

Response: `string`

Example:

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const storedPath = await invoke("import_editor_image", {
  pageId: "page-1",
  fileName: file.name,
  bytes,
});
```

Constraints:

- Supported formats: PNG, JPG/JPEG, WebP, GIF.
- Byte upload size limit: 10 MB.
- Source-path imports must come from trusted dialog helpers.

### `import_editor_video`

Stores an editor video either from bytes or a trusted native-dialog source path.

Request:

```ts
{
  pageId?: string;
  page_id?: string;
  fileName?: string;
  file_name?: string;
  bytes?: number[] | Uint8Array;
  sourcePath?: string;
  source_path?: string;
}
```

Response: `string`

Constraints:

- Supported formats: MP4, M4V, MOV, WebM.
- File size limit: 512 MB.
- Video headers are validated.
- Source-path imports must come from trusted dialog helpers.

### `import_profile_avatar`

Copies a profile avatar into managed Shelf storage and updates profile metadata.

Request:

```ts
{
  sourcePath?: string;
  source_path?: string;
}
```

Response: `string`

Constraints:

- Direct renderer calls with `sourcePath` are blocked. Use `window.openNotion.importProfileAvatar()`.
- Supported formats and size limit match cover images.
- Previous managed avatar files are removed best-effort.

## Profile Endpoints

### `get_workspace_profile`

Reads workspace profile metadata.

Request: `undefined`

Response: `WorkspaceProfile`

Default response:

```ts
{
  name: "",
  workspaceName: "Shelf",
  avatarPath: null
}
```

### `update_workspace_profile`

Updates workspace profile metadata.

Request:

```ts
{
  name?: string;
  workspaceName?: string;
  avatarPath?: null;
}
```

Response: `WorkspaceProfile`

Constraints:

- `name` and `workspaceName` must be strings no longer than 120 characters.
- Passing `avatarPath: null` clears the avatar and removes the managed avatar file best-effort.
- Setting an arbitrary avatar path through this endpoint is not supported.

## Update Endpoints

### `open_external_url`

Opens a trusted external URL in the OS browser.

Request:

```ts
{ url: string }
```

Response: `void`

Constraints:

- URL validation is handled in the backend. Invalid or untrusted schemes are rejected.

### `fetch_update_manifest`

Fetches and verifies a signed update manifest.

Request:

```ts
{ url: string }
```

Response:

```ts
unknown // verified manifest payload with downloadToken fields added
```

Constraints:

- Manifest URL must use HTTPS.
- Manifest URL must be in the trusted manifest URL allowlist.
- Manifest response must be 64 KB or smaller.
- Signature algorithm is Ed25519.
- Valid downloads receive one-use `downloadToken` values.

### `download_update_artifact`

Downloads, verifies, saves, and opens an update artifact.

Request:

```ts
{
  url: string;
  sha256: string;
  downloadToken?: string;
  download_token?: string;
}
```

Response:

```ts
{
  path: string;
  bytes: number;
  sha256: string;
}
```

Constraints:

- Must use a one-use token returned by `fetch_update_manifest`.
- URL and checksum must match the verified manifest download.
- URL must match the trusted download URL pattern.
- Download size limit is 512 MB.
- SHA-256 is verified before the file is renamed into place.

### `show_character_palette`

Shows the OS emoji/character palette when available.

Request: `undefined`

Response: `null`

## Bridge-Only Methods

These methods are exposed by `window.openNotion` but are not command-registry endpoints.

### `open(options?)`

Shows a native open-file dialog.

Request:

```ts
{
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}
```

Response:

```ts
string | string[] | null
```

Constraints:

- Up to 10 filters.
- Up to 20 extensions per filter.
- Extension strings must be alphanumeric.
- Filter names are truncated to 80 characters.

### `save(options?)`

Shows a native save dialog.

Request:

```ts
{
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}
```

Response:

```ts
string | null
```

### `exportBackup(options?)`

Trusted-dialog wrapper around `export_backup`.

Request:

```ts
{
  defaultPath?: string;
  exportedAt?: string;
}
```

Response:

```ts
number | null
```

Returns `null` when the user cancels.

### `importBackup(options?)`

Trusted-dialog wrapper around `import_backup`.

Request:

```ts
{ importedAt?: string }
```

Response:

```ts
number | null
```

### `importStudioDocument(options)`

Trusted-dialog wrapper around `import_studio_document`.

Request:

```ts
{
  documentId: string;
  notePageId: string;
  importedAt?: string;
}
```

Response:

```ts
StudioDocument | null
```

### `replaceStudioDocumentFile(options)`

Trusted-dialog wrapper around `replace_studio_document_file`.

Request:

```ts
{
  id: string;
  updatedAt?: string;
}
```

Response:

```ts
StudioDocument | null
```

### `importCoverImage(options)`

Trusted-dialog wrapper around `import_cover_image`.

Request:

```ts
{ pageId: string }
```

Response:

```ts
string | null
```

### `importProfileAvatar()`

Trusted-dialog wrapper around `import_profile_avatar`.

Request: `undefined`

Response:

```ts
string | null
```

### `importEditorMediaFiles(options)`

Imports one or more editor media files selected through a native dialog.

Request:

```ts
{
  kind: "image" | "video";
  pageId: string;
}
```

Response:

```ts
Array<{ sourceName: string; path: string }>
```

### `exportFiles(options)`

Writes generated files to a user-selected destination.

Request:

```ts
{
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  files: Array<{
    relativePath: string;
    content: string;
  }>;
}
```

Response:

```ts
{
  path: string;
  fileCount: number;
} | null
```

Constraints:

- Export paths must be relative and cannot escape the selected root.
- Maximum 2,000 files.
- Maximum total exported content size is 100 MB.

### `importPageFile(options?)`

Reads one user-selected file.

Request:

```ts
{
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}
```

Response:

```ts
{
  path: string;
  content: string;
} | null
```

Constraints:

- Imported file size limit is 25 MB.

### `fileSrc(filePath)`

Converts a managed local file path into an app-safe URL.

Request:

```ts
filePath: string
```

Response:

```ts
string
```

Constraints:

- Used for managed assets such as covers, editor media, and avatars.
- Invalid or unmanaged paths are rejected by the backend.

### `studioPdfSrc(documentId)`

Returns a local HTTP URL for a managed Studio PDF.

Request:

```ts
documentId: string
```

Response:

```ts
string
```

Constraints:

- Requires a valid document ID.
- Uses a loopback PDF server with access-token checks and range request support.

### `onDesktopUpdate(callback)`

Subscribes to legacy desktop updater events.

Request:

```ts
(eventName: DesktopUpdateEventName, payload: unknown) => void
```

Response:

```ts
() => void // unsubscribe
```

Supported event names:

```ts
"desktop-update-checking"
"desktop-update-available"
"desktop-update-not-available"
"desktop-update-download-progress"
"desktop-update-downloaded"
"desktop-update-error"
```

### `autoUpdateActive()`

Reports whether the legacy desktop auto-updater is active.

Request: `undefined`

Response:

```ts
boolean
```

Current behavior: returns `false`; current builds use the signed manifest update flow.

### `installUpdateNow()`

Legacy restart-to-update hook.

Request: `undefined`

Response: rejects with an error.

Current behavior: always throws because desktop auto-update is disabled.

## Security and Trust Boundaries

- Renderer IPC calls must originate from a trusted renderer origin.
- Persistence flows through `window.openNotion`; renderer code does not access SQLite directly.
- Commands that accept arbitrary filesystem paths are blocked from direct renderer `invoke` calls.
- File imports that need source paths should use trusted native-dialog wrappers.
- Managed file serving validates paths and restricts access to Shelf-controlled storage.
- Update artifacts require a verified signed manifest and one-use download token.
- Dialog options are normalized and limited before reaching Electron APIs.

## Data and Storage Constraints

- SQLite database path: `~/Library/Application Support/org.opennotion.desktop/opennotion.db`.
- Schema changes are handled at startup with idempotent `CREATE TABLE IF NOT EXISTS` and best-effort `ALTER TABLE ADD COLUMN`.
- Backup max size: 50 MB.
- Backup max pages: 5,000.
- Page ID max length: 512 characters.
- Page title max length: 512 characters.
- Page content/search text max length: 1 MB each.
- Page metadata fields such as `database_schema` and `properties` max length: 1 MB each.
- Cover/avatar/editor image max size: 10 MB.
- Studio PDFs and editor videos max size: 512 MB.
- Studio PDF viewer zoom is clamped to 25-300.
- Studio UI limits PDF rendering to safe canvas sizes; frontend constant `MAX_STUDIO_PDF_PAGES` is 1,000.

## Recommended Usage Patterns

Use typed wrappers rather than raw commands:

```ts
import { createPage, updatePage } from "../lib/db";
import { listStudioDocuments } from "../lib/studio";

const page = await createPage("Meeting notes");
await updatePage(page.id, { icon: "📝" });
const documents = await listStudioDocuments();
```

Use optimistic store actions from `src/store/useAppStore.ts` for UI workflows. Store actions update local state first, call the typed API wrapper, and roll back with a notice/error on failure.

Use dialog wrappers for filesystem operations:

```ts
const imported = await window.openNotion!.importStudioDocument!({
  documentId: crypto.randomUUID(),
  notePageId: crypto.randomUUID(),
  importedAt: new Date().toISOString(),
});
```

Avoid:

```ts
await window.openNotion!.invoke("import_studio_document", {
  sourcePath: "/Users/me/Desktop/file.pdf",
});
```

That direct source-path pattern is rejected by the main process because it bypasses trusted native file selection.
