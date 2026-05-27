# Studio Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build persistent Tauri Studio mode for imported PDFs plus one linked hidden note per PDF.

**Architecture:** Add Tauri-backed `studio_documents` storage and mark linked note pages with `page_kind = 'studio_note'`. Frontend gets typed Studio API, Zustand state, contextual `Note | Studio` sidebar, and split PDF/note view. Viewer stays simple: local asset URL, zoom/page state persisted through toolbar controls, clean path to later PDF.js.

**Tech Stack:** Tauri 2, Rust, sqlx SQLite, React 19, Zustand, BlockNote, Tailwind CSS, Vitest, Playwright.

---

## File Structure

- Modify `src-tauri/src/lib.rs`: schema, structs, helpers, commands, Rust tests.
- Modify `src/lib/db.ts`: add `page_kind` to `Page`.
- Create `src/lib/studio.ts`: typed Studio API over Tauri commands.
- Create `src/lib/studioDocuments.ts`: pure sort/filter/layout helpers.
- Create `src/lib/studioDocuments.test.ts`: helper tests.
- Modify `src/store/useAppStore.ts`: workspace mode, Studio documents, import/open/update actions.
- Create `src/components/SidebarModeSwitch.tsx`: `Note | Studio` switch.
- Create `src/components/StudioSidebar.tsx`: import button, Recenti, Tutti i documenti.
- Modify `src/components/Sidebar.tsx`: glass shell, contextual Note/Studio contents.
- Create `src/components/StudioWorkspace.tsx`: split PDF/note workspace.
- Modify `src/components/PageEditor.tsx`: Studio note variant that hides normal page chrome.
- Modify `src/components/Layout.tsx`: keep sidebar toggle placement stable with glass sidebar.
- Modify `src/components/HomeView.tsx`, `src/lib/homeSections.ts`, `src/lib/commandPaletteSections.ts`: keep Studio notes out of Note surfaces.
- Modify tests in `src/lib/*.test.ts`: include `page_kind` fixtures.
- Create `tests/e2e/studio.e2e.ts`: browser QA mock for Studio flow.
- Modify `src/index.css`: controlled glass sidebar classes and Studio viewer classes.

## Task 0: Isolation Guard

**Files:**
- Read: `git status`
- Read: `docs/superpowers/specs/2026-05-27-studio-mode-design.md`

- [ ] **Step 1: Confirm branch and dirty state**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/Refctor`; many existing dirty files may be present. Do not stage or revert unrelated dirty files.

- [ ] **Step 2: Confirm spec is committed**

Run:

```bash
git log --oneline -3
```

Expected: includes `2c0820f Add Studio mode design spec`.

- [ ] **Step 3: Commit discipline**

Use path-limited commits only. Example:

```bash
git add src-tauri/src/lib.rs src/lib/db.ts
git commit -m "Add Studio document schema"
```

Expected: commit includes only files from current task.

## Task 1: Backend Schema And Hidden Studio Notes

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/db.ts`
- Modify: existing TS tests with `Page` fixtures

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/lib.rs` test module:

```rust
#[test]
fn migrations_create_studio_documents_and_page_kind() {
    tauri::async_runtime::block_on(async {
        let db = test_db().await;

        let page_columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('pages')")
            .fetch_all(&db)
            .await
            .expect("list page columns");
        assert!(page_columns.contains(&"page_kind".to_string()));

        let studio_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('studio_documents')")
                .fetch_all(&db)
                .await
                .expect("list studio document columns");
        assert!(studio_columns.contains(&"note_page_id".to_string()));
        assert!(studio_columns.contains(&"panel_layout".to_string()));
    });
}

#[test]
fn list_pages_hides_studio_notes() {
    tauri::async_runtime::block_on(async {
        let db = test_db().await;
        create_page_record(&db, "note", "Normal", None, "2026-05-27T00:00:00.000Z")
            .await
            .expect("create normal note");
        create_studio_note_record(&db, "studio-note", "PDF Notes", "2026-05-27T00:01:00.000Z")
            .await
            .expect("create studio note");

        let visible_ids: Vec<String> = list_page_records(&db)
            .await
            .expect("list pages")
            .into_iter()
            .map(|page| page.id)
            .collect();

        assert_eq!(visible_ids, vec!["note"]);
        assert!(get_page_record(&db, "studio-note")
            .await
            .expect("get studio note")
            .is_some());
    });
}
```

- [ ] **Step 2: Run failing Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml migrations_create_studio_documents_and_page_kind list_pages_hides_studio_notes
```

Expected: FAIL because `page_kind`, `studio_documents`, and `create_studio_note_record` do not exist.

- [ ] **Step 3: Add backend schema fields**

In `Page` and `SearchResult`, add:

```rust
page_kind: String,
```

In `PageUpdates`, add:

```rust
page_kind: Option<String>,
```

In `run_migrations`, after `properties`, add:

```rust
if !columns.iter().any(|column| column == "page_kind") {
    sqlx::query("ALTER TABLE pages ADD COLUMN page_kind TEXT NOT NULL DEFAULT 'note'")
        .execute(db)
        .await?;
}

sqlx::query(
    "CREATE TABLE IF NOT EXISTS studio_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        stored_file_path TEXT NOT NULL,
        note_page_id TEXT NOT NULL UNIQUE,
        last_opened_at TEXT NOT NULL,
        viewer_zoom INTEGER NOT NULL DEFAULT 100,
        viewer_page INTEGER NOT NULL DEFAULT 1,
        panel_layout TEXT NOT NULL DEFAULT 'pdf-left',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );",
)
.execute(db)
.await?;

sqlx::query(
    "CREATE INDEX IF NOT EXISTS idx_studio_documents_last_opened
     ON studio_documents (last_opened_at DESC)",
)
.execute(db)
.await?;
```

- [ ] **Step 4: Update page SELECT and INSERT statements**

Every `SELECT ... FROM pages` that maps to `Page` or `SearchResult` must include `page_kind`.

Example:

```rust
"SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at
 FROM pages
 WHERE id = ?"
```

Normal page inserts must set `'note'`:

```rust
"INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
 VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'note', ?, ?)"
```

`list_page_records` and `search_page_records` must filter:

```sql
WHERE is_deleted = 0
  AND page_kind = 'note'
```

- [ ] **Step 5: Add Studio note helper**

Add near `create_page_record`:

```rust
async fn create_studio_note_record(
    db: &SqlitePool,
    id: &str,
    title: &str,
    created_at: &str,
) -> Result<Page, sqlx::Error> {
    sqlx::query(
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, 'studio_note', ?, ?)",
    )
    .bind(id)
    .bind(title)
    .bind(created_at)
    .bind(created_at)
    .execute(db)
    .await?;

    Ok(Page {
        id: id.to_string(),
        title: title.to_string(),
        parent_id: None,
        content: None,
        search_text: None,
        icon: None,
        cover_url: None,
        is_deleted: 0,
        is_favorite: 0,
        is_template: 0,
        is_database: 0,
        database_schema: None,
        properties: None,
        sort_order: 0,
        page_kind: "studio_note".to_string(),
        created_at: created_at.to_string(),
        updated_at: created_at.to_string(),
    })
}
```

- [ ] **Step 6: Update TS `Page` type and fixtures**

In `src/lib/db.ts`:

```ts
export type PageKind = "note" | "studio_note";
```

Add to `Page`:

```ts
page_kind: PageKind;
```

Add `page_kind: "note"` to every test fixture creating `Page`.

- [ ] **Step 7: Run schema tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml migrations_create_studio_documents_and_page_kind list_pages_hides_studio_notes
npm run test -- src/lib/navigation.test.ts src/lib/homeSections.test.ts src/lib/commandPaletteSections.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src/lib/db.ts src/lib/*.test.ts
git commit -m "Add Studio document schema"
```

## Task 2: Backend Studio Commands And PDF Import

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add:

```rust
#[test]
fn studio_pdf_validation_accepts_pdf_magic_and_rejects_text() {
    let pdf_path = temp_path("sample.pdf");
    write(&pdf_path, b"%PDF-1.7\nbody").expect("write pdf");
    assert_eq!(validated_pdf_file(&pdf_path).as_deref(), Ok("pdf"));
    let _ = remove_file(&pdf_path);

    let text_path = temp_path("sample.pdf");
    write(&text_path, b"not a pdf").expect("write text");
    let error = validated_pdf_file(&text_path).expect_err("reject text");
    assert_eq!(error, "PDF content is not valid");
    let _ = remove_file(&text_path);
}

#[test]
fn import_studio_document_records_document_and_note() {
    tauri::async_runtime::block_on(async {
        let db = test_db().await;
        let stored_path = "/tmp/opennotion-studio/doc-1/source.pdf";

        let document = import_studio_document_record(
            &db,
            ImportStudioDocumentRecord {
                document_id: "doc-1",
                note_page_id: "note-1",
                title: "Sample",
                original_filename: "sample.pdf",
                stored_file_path: stored_path,
                imported_at: "2026-05-27T00:00:00.000Z",
            },
        )
        .await
        .expect("import studio document");

        assert_eq!(document.id, "doc-1");
        assert_eq!(document.note_page_id, "note-1");
        assert_eq!(document.viewer_zoom, 100);
        assert_eq!(document.viewer_page, 1);
        assert_eq!(document.panel_layout, "pdf-left");

        let note = get_page_record(&db, "note-1")
            .await
            .expect("load linked note")
            .expect("note exists");
        assert_eq!(note.page_kind, "studio_note");
    });
}
```

- [ ] **Step 2: Run failing tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml studio_pdf_validation_accepts_pdf_magic_and_rejects_text import_studio_document_records_document_and_note
```

Expected: FAIL because helpers and structs do not exist.

- [ ] **Step 3: Add constants and structs**

Add near existing constants:

```rust
const STUDIO_PDF_MAX_BYTES: u64 = 200 * 1024 * 1024;
```

Add structs:

```rust
#[derive(Debug, FromRow, Serialize)]
struct StudioDocument {
    id: String,
    title: String,
    original_filename: String,
    stored_file_path: String,
    note_page_id: String,
    last_opened_at: String,
    viewer_zoom: i64,
    viewer_page: i64,
    panel_layout: String,
    created_at: String,
    updated_at: String,
}

struct ImportStudioDocumentRecord<'a> {
    document_id: &'a str,
    note_page_id: &'a str,
    title: &'a str,
    original_filename: &'a str,
    stored_file_path: &'a str,
    imported_at: &'a str,
}

#[derive(Debug, Deserialize)]
struct StudioViewerUpdates {
    viewer_zoom: Option<i64>,
    viewer_page: Option<i64>,
    panel_layout: Option<String>,
    last_opened_at: Option<String>,
}
```

- [ ] **Step 4: Add PDF validation and destination helpers**

Add near cover helpers:

```rust
fn validated_pdf_file(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .filter(|value| value == "pdf")
        .ok_or_else(|| "file must be a PDF".to_string())?;

    let file_size = metadata(path).map_err(|error| error.to_string())?.len();
    if file_size > STUDIO_PDF_MAX_BYTES {
        return Err("PDF must be 200 MB or smaller".to_string());
    }

    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 5];
    let bytes_read = file.read(&mut header).map_err(|error| error.to_string())?;
    if bytes_read < 5 || &header != b"%PDF-" {
        return Err("PDF content is not valid".to_string());
    }

    Ok(Box::leak(extension.into_boxed_str()))
}

fn safe_storage_id(id: &str) -> String {
    id.chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect()
}

fn studio_pdf_destination<R: Runtime>(
    app: &tauri::AppHandle<R>,
    document_id: &str,
) -> Result<PathBuf, String> {
    let studio_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("studio-documents")
        .join(safe_storage_id(document_id));
    ensure_private_directory(&studio_dir).map_err(|error| error.to_string())?;
    Ok(studio_dir.join("source.pdf"))
}
```

- [ ] **Step 5: Add record helpers**

Add:

```rust
async fn list_studio_document_records(db: &SqlitePool) -> Result<Vec<StudioDocument>, sqlx::Error> {
    sqlx::query_as::<_, StudioDocument>(
        "SELECT id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at
         FROM studio_documents
         ORDER BY last_opened_at DESC, created_at DESC",
    )
    .fetch_all(db)
    .await
}

async fn import_studio_document_record(
    db: &SqlitePool,
    input: ImportStudioDocumentRecord<'_>,
) -> Result<StudioDocument, sqlx::Error> {
    let mut transaction = db.begin().await?;

    sqlx::query(
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, 'studio_note', ?, ?)",
    )
    .bind(input.note_page_id)
    .bind(format!("{} Notes", input.title))
    .bind(input.imported_at)
    .bind(input.imported_at)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        "INSERT INTO studio_documents (id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 100, 1, 'pdf-left', ?, ?)",
    )
    .bind(input.document_id)
    .bind(input.title)
    .bind(input.original_filename)
    .bind(input.stored_file_path)
    .bind(input.note_page_id)
    .bind(input.imported_at)
    .bind(input.imported_at)
    .bind(input.imported_at)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    sqlx::query_as::<_, StudioDocument>(
        "SELECT id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at
         FROM studio_documents
         WHERE id = ?",
    )
    .bind(input.document_id)
    .fetch_one(db)
    .await
}
```

- [ ] **Step 6: Add Tauri commands**

Add:

```rust
#[tauri::command]
async fn list_studio_documents(state: tauri::State<'_, AppState>) -> Result<Vec<StudioDocument>, String> {
    list_studio_document_records(&state.db)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn import_studio_document<R: Runtime>(
    document_id: String,
    note_page_id: String,
    source_path: String,
    imported_at: String,
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<StudioDocument, String> {
    let source = Path::new(&source_path);
    validated_pdf_file(source)?;
    let original_filename = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "PDF file name is invalid".to_string())?
        .to_string();
    let title = source
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Imported PDF")
        .to_string();
    let destination = studio_pdf_destination(&app, &document_id)?;

    copy(source, &destination).map_err(|error| error.to_string())?;

    match import_studio_document_record(
        &state.db,
        ImportStudioDocumentRecord {
            document_id: &document_id,
            note_page_id: &note_page_id,
            title: &title,
            original_filename: &original_filename,
            stored_file_path: &destination.to_string_lossy(),
            imported_at: &imported_at,
        },
    )
    .await
    {
        Ok(document) => Ok(document),
        Err(error) => {
            let _ = remove_file(&destination);
            Err(error.to_string())
        }
    }
}
```

Add `remove_file` import at top:

```rust
use std::fs::{copy, create_dir_all, metadata, remove_file, set_permissions, File, Permissions};
```

Add command names to `generate_handler!`.

- [ ] **Step 7: Run backend tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml studio
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Add Studio PDF import commands"
```

## Task 3: Frontend Studio API And Pure Helpers

**Files:**
- Create: `src/lib/studio.ts`
- Create: `src/lib/studioDocuments.ts`
- Create: `src/lib/studioDocuments.test.ts`

- [ ] **Step 1: Create failing helper tests**

Create `src/lib/studioDocuments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allStudioDocuments, normalizePanelLayout, recentStudioDocuments } from "./studioDocuments";
import { StudioDocument } from "./studio";

function doc(id: string, lastOpenedAt: string): StudioDocument {
  return {
    id,
    title: id,
    original_filename: `${id}.pdf`,
    stored_file_path: `/tmp/${id}.pdf`,
    note_page_id: `${id}-note`,
    last_opened_at: lastOpenedAt,
    viewer_zoom: 100,
    viewer_page: 1,
    panel_layout: "pdf-left",
    created_at: lastOpenedAt,
    updated_at: lastOpenedAt,
  };
}

describe("studio document helpers", () => {
  it("sorts recent documents by last opened date", () => {
    expect(
      recentStudioDocuments([
        doc("old", "2026-05-27T08:00:00.000Z"),
        doc("new", "2026-05-27T10:00:00.000Z"),
        doc("middle", "2026-05-27T09:00:00.000Z"),
      ]).map((item) => item.id)
    ).toEqual(["new", "middle", "old"]);
  });

  it("sorts all documents by title", () => {
    expect(allStudioDocuments([doc("Bravo", "2026-05-27T08:00:00.000Z"), doc("Alpha", "2026-05-27T08:00:00.000Z")]).map((item) => item.id)).toEqual(["Alpha", "Bravo"]);
  });

  it("normalizes panel layout", () => {
    expect(normalizePanelLayout("note-left")).toBe("note-left");
    expect(normalizePanelLayout("bad")).toBe("pdf-left");
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npm run test -- src/lib/studioDocuments.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Create `src/lib/studio.ts`**

```ts
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type StudioPanelLayout = "pdf-left" | "note-left";

export interface StudioDocument {
  id: string;
  title: string;
  original_filename: string;
  stored_file_path: string;
  note_page_id: string;
  last_opened_at: string;
  viewer_zoom: number;
  viewer_page: number;
  panel_layout: StudioPanelLayout;
  created_at: string;
  updated_at: string;
}

export interface StudioViewerUpdates {
  viewer_zoom?: number;
  viewer_page?: number;
  panel_layout?: StudioPanelLayout;
  last_opened_at?: string;
}

export async function listStudioDocuments(): Promise<StudioDocument[]> {
  return await invoke<StudioDocument[]>("list_studio_documents");
}

export async function importStudioDocument(sourcePath: string): Promise<StudioDocument> {
  return await invoke<StudioDocument>("import_studio_document", {
    documentId: crypto.randomUUID(),
    notePageId: crypto.randomUUID(),
    sourcePath,
    importedAt: new Date().toISOString(),
  });
}

export async function updateStudioDocumentViewerState(id: string, updates: StudioViewerUpdates): Promise<void> {
  await invoke("update_studio_document_viewer_state", {
    id,
    updates,
    updatedAt: new Date().toISOString(),
  });
}

export function studioPdfSrc(document: StudioDocument): string {
  const hash = `page=${Math.max(1, document.viewer_page)}&zoom=${Math.max(25, Math.min(300, document.viewer_zoom))}`;
  return `${convertFileSrc(document.stored_file_path)}#${hash}`;
}
```

- [ ] **Step 4: Create `src/lib/studioDocuments.ts`**

```ts
import { StudioDocument, StudioPanelLayout } from "./studio";

export function recentStudioDocuments(documents: StudioDocument[], limit = 6): StudioDocument[] {
  return [...documents]
    .sort((a, b) => new Date(b.last_opened_at).getTime() - new Date(a.last_opened_at).getTime())
    .slice(0, limit);
}

export function allStudioDocuments(documents: StudioDocument[]): StudioDocument[] {
  return [...documents].sort((a, b) => a.title.localeCompare(b.title));
}

export function normalizePanelLayout(value: string): StudioPanelLayout {
  return value === "note-left" ? "note-left" : "pdf-left";
}
```

- [ ] **Step 5: Run helper tests**

```bash
npm run test -- src/lib/studioDocuments.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/studio.ts src/lib/studioDocuments.ts src/lib/studioDocuments.test.ts
git commit -m "Add Studio frontend API helpers"
```

## Task 4: Store State And Note Surface Filtering

**Files:**
- Modify: `src/store/useAppStore.ts`
- Modify: `src/lib/homeSections.ts`
- Modify: `src/lib/commandPaletteSections.ts`
- Modify: tests for changed helpers

- [ ] **Step 1: Add failing tests for Studio note filtering**

In `src/lib/homeSections.test.ts`, add fixture `pageKind` parameter and test:

```ts
it("excludes Studio notes from recent and pinned pages", () => {
  const pages = [
    page("normal", "2026-05-27T09:00:00.000Z", 1, "note"),
    page("studio", "2026-05-27T10:00:00.000Z", 1, "studio_note"),
  ];

  expect(recentPages(pages).map((item) => item.id)).toEqual(["normal"]);
  expect(pinnedPages(pages).map((item) => item.id)).toEqual(["normal"]);
});
```

Use fixture signature:

```ts
function page(id: string, updatedAt: string, isFavorite = 0, pageKind: Page["page_kind"] = "note"): Page {
  return {
    id,
    title: id,
    parent_id: null,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: isFavorite,
    is_template: 0,
    is_database: 0,
    database_schema: null,
    properties: null,
    sort_order: 0,
    page_kind: pageKind,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}
```

- [ ] **Step 2: Run failing helper tests**

```bash
npm run test -- src/lib/homeSections.test.ts src/lib/commandPaletteSections.test.ts
```

Expected: FAIL until helpers filter `page_kind`.

- [ ] **Step 3: Filter helpers**

In `src/lib/homeSections.ts`:

```ts
function notePages(pages: Page[]): Page[] {
  return pages.filter((page) => page.page_kind === "note");
}

export function recentPages(pages: Page[], limit = 6): Page[] {
  return notePages(pages)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, limit);
}

export function pinnedPages(pages: Page[]): Page[] {
  return notePages(pages).filter((page) => page.is_favorite === 1);
}
```

- [ ] **Step 4: Extend Zustand state**

In `src/store/useAppStore.ts`, add imports:

```ts
import { open } from "@tauri-apps/plugin-dialog";
import { importStudioDocument, listStudioDocuments, StudioDocument, StudioPanelLayout, updateStudioDocumentViewerState } from "../lib/studio";
```

Add types:

```ts
type WorkspaceMode = "notes" | "studio";
```

Add state fields and actions:

```ts
workspaceMode: WorkspaceMode;
studioDocuments: StudioDocument[];
currentStudioDocumentId: string | null;
fetchStudioDocuments: () => Promise<void>;
setWorkspaceMode: (mode: WorkspaceMode) => void;
setCurrentStudioDocumentId: (id: string | null) => void;
importStudioPdfAction: () => Promise<StudioDocument | null>;
updateStudioViewerAction: (id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: StudioPanelLayout }) => Promise<void>;
```

Add stored getters:

```ts
function getStoredWorkspaceMode(): WorkspaceMode {
  return localStorage.getItem("opennotion-workspace-mode") === "studio" ? "studio" : "notes";
}

function getStoredStudioDocumentId(): string | null {
  return localStorage.getItem("opennotion-current-studio-document-id");
}
```

Add implementation inside `create<AppState>`:

```ts
workspaceMode: getStoredWorkspaceMode(),
studioDocuments: [],
currentStudioDocumentId: getStoredStudioDocumentId(),
fetchStudioDocuments: async () => {
  try {
    const studioDocuments = await listStudioDocuments();
    set((state) => {
      const currentStudioDocumentId = studioDocuments.some((document) => document.id === state.currentStudioDocumentId)
        ? state.currentStudioDocumentId
        : studioDocuments[0]?.id ?? null;
      if (currentStudioDocumentId) {
        localStorage.setItem("opennotion-current-studio-document-id", currentStudioDocumentId);
      }
      return { studioDocuments, currentStudioDocumentId, error: null };
    });
  } catch (error: unknown) {
    const message = userMessageForError(error);
    set({ error: message, notice: { kind: "error", message } });
  }
},
setWorkspaceMode: (mode) => {
  localStorage.setItem("opennotion-workspace-mode", mode);
  set({ workspaceMode: mode });
},
setCurrentStudioDocumentId: (id) => {
  if (id) {
    localStorage.setItem("opennotion-current-studio-document-id", id);
  } else {
    localStorage.removeItem("opennotion-current-studio-document-id");
  }
  set({ currentStudioDocumentId: id });
},
importStudioPdfAction: async () => {
  try {
    const path = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path || Array.isArray(path)) return null;
    const document = await importStudioDocument(path);
    set((state) => ({
      studioDocuments: [document, ...state.studioDocuments.filter((candidate) => candidate.id !== document.id)],
      currentStudioDocumentId: document.id,
      workspaceMode: "studio",
      error: null,
    }));
    localStorage.setItem("opennotion-workspace-mode", "studio");
    localStorage.setItem("opennotion-current-studio-document-id", document.id);
    return document;
  } catch (error: unknown) {
    const message = userMessageForError(error);
    set({ error: message, notice: { kind: "error", message } });
    return null;
  }
},
updateStudioViewerAction: async (id, updates) => {
  const last_opened_at = new Date().toISOString();
  set((state) => ({
    studioDocuments: state.studioDocuments.map((document) =>
      document.id === id ? { ...document, ...updates, last_opened_at } : document
    ),
  }));
  await updateStudioDocumentViewerState(id, { ...updates, last_opened_at });
},
```

- [ ] **Step 5: Run tests**

```bash
npm run test -- src/lib/homeSections.test.ts src/lib/commandPaletteSections.test.ts src/lib/studioDocuments.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.ts src/lib/homeSections.ts src/lib/homeSections.test.ts src/lib/commandPaletteSections.ts src/lib/commandPaletteSections.test.ts
git commit -m "Add Studio app state"
```

## Task 5: Contextual Glass Sidebar

**Files:**
- Create: `src/components/SidebarModeSwitch.tsx`
- Create: `src/components/StudioSidebar.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Create `SidebarModeSwitch.tsx`**

```tsx
type SidebarModeSwitchProps = {
  mode: "notes" | "studio";
  onChange: (mode: "notes" | "studio") => void;
};

export function SidebarModeSwitch({ mode, onChange }: SidebarModeSwitchProps) {
  return (
    <div className="on-mode-switch" aria-label="Workspace mode">
      <button
        type="button"
        className={`on-mode-switch-segment ${mode === "notes" ? "on-mode-switch-segment-active" : ""}`}
        onClick={() => onChange("notes")}
      >
        Note
      </button>
      <button
        type="button"
        className={`on-mode-switch-segment ${mode === "studio" ? "on-mode-switch-segment-active" : ""}`}
        onClick={() => onChange("studio")}
      >
        Studio
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `StudioSidebar.tsx`**

```tsx
import { FileText, Upload } from "lucide-react";
import { StudioDocument } from "../lib/studio";
import { allStudioDocuments, recentStudioDocuments } from "../lib/studioDocuments";

type StudioSidebarProps = {
  documents: StudioDocument[];
  currentDocumentId: string | null;
  isLoading: boolean;
  onImport: () => void;
  onSelectDocument: (id: string) => void;
};

function StudioDocumentRow({ document, active, onSelect }: { document: StudioDocument; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`on-shell-row on-sidebar-page-row mb-[1px] justify-between py-[3px] text-[13px] ${active ? "on-shell-row-active" : ""}`}
      onClick={onSelect}
      title={document.original_filename}
    >
      <div className="flex min-w-0 items-center">
        <FileText className="mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{document.title}</span>
      </div>
    </button>
  );
}

export function StudioSidebar({ documents, currentDocumentId, isLoading, onImport, onSelectDocument }: StudioSidebarProps) {
  const recent = recentStudioDocuments(documents);
  const all = allStudioDocuments(documents);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2">
        <button type="button" className="on-studio-import-button" onClick={onImport}>
          <Upload className="h-4 w-4" />
          <span>Import PDF</span>
        </button>
      </div>
      <div className="mt-4 flex-1 overflow-y-auto px-2 pb-20">
        {isLoading && <div className="px-3 py-4 text-xs text-muted-foreground">Loading Studio...</div>}
        {!isLoading && documents.length === 0 && (
          <div className="mx-1 rounded-xl border border-dashed border-border/70 bg-background/35 p-3 text-xs text-muted-foreground">
            Import a PDF to start Studio notes.
          </div>
        )}
        {recent.length > 0 && (
          <section className="mb-4">
            <div className="on-section-label mb-1">Recenti</div>
            {recent.map((document) => (
              <StudioDocumentRow key={`recent-${document.id}`} document={document} active={document.id === currentDocumentId} onSelect={() => onSelectDocument(document.id)} />
            ))}
          </section>
        )}
        {all.length > 0 && (
          <section>
            <div className="on-section-label mb-1">Tutti i documenti</div>
            {all.map((document) => (
              <StudioDocumentRow key={`all-${document.id}`} document={document} active={document.id === currentDocumentId} onSelect={() => onSelectDocument(document.id)} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Modify `Sidebar.tsx` shell**

Import:

```tsx
import { SidebarModeSwitch } from "./SidebarModeSwitch";
import { StudioSidebar } from "./StudioSidebar";
```

Get store fields:

```tsx
const {
  workspaceMode,
  setWorkspaceMode,
  studioDocuments,
  currentStudioDocumentId,
  setCurrentStudioDocumentId,
  fetchStudioDocuments,
  importStudioPdfAction,
} = useAppStore();
```

Add effect:

```tsx
useEffect(() => {
  if (workspaceMode === "studio") {
    void fetchStudioDocuments();
  }
}, [fetchStudioDocuments, workspaceMode]);
```

Change root class:

```tsx
className="on-glass-sidebar relative flex h-full shrink-0 flex-col overflow-hidden text-secondary-foreground outline-none ring-0 focus:outline-none focus:ring-0"
```

Place switch below drag spacer:

```tsx
<div className="px-2 pb-2">
  <SidebarModeSwitch mode={workspaceMode} onChange={setWorkspaceMode} />
</div>
```

Wrap existing Note nav/tree in:

```tsx
{workspaceMode === "notes" ? (
  <>
    {/* existing Note sidebar body */}
  </>
) : (
  <StudioSidebar
    documents={studioDocuments}
    currentDocumentId={currentStudioDocumentId}
    isLoading={isLoading}
    onImport={() => void importStudioPdfAction()}
    onSelectDocument={setCurrentStudioDocumentId}
  />
)}
```

- [ ] **Step 4: Add CSS glass classes**

In `src/index.css` component layer:

```css
.on-glass-sidebar {
  border-right: 1px solid hsl(var(--border) / 0.72);
  background: hsl(var(--secondary) / 0.78);
  backdrop-filter: blur(22px) saturate(1.15);
  box-shadow: inset -1px 0 0 hsl(0 0% 100% / 0.22), 18px 0 44px hsl(222 28% 12% / 0.07);
}

.dark .on-glass-sidebar {
  background: hsl(var(--secondary) / 0.72);
  box-shadow: inset -1px 0 0 hsl(0 0% 100% / 0.06), 18px 0 44px hsl(0 0% 0% / 0.22);
}

@supports not ((backdrop-filter: blur(1px))) {
  .on-glass-sidebar {
    background: hsl(var(--secondary));
  }
}

.on-mode-switch {
  display: flex;
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.65);
  background: hsl(var(--background) / 0.42);
  padding: 3px;
}

.on-mode-switch-segment {
  flex: 1;
  border-radius: 0.55rem;
  padding: 0.35rem 0.5rem;
  font-size: 0.78rem;
  color: hsl(var(--muted-foreground));
  transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
}

.on-mode-switch-segment:hover {
  background: hsl(var(--accent) / 0.55);
  color: hsl(var(--foreground));
}

.on-mode-switch-segment-active {
  background: hsl(var(--background) / 0.88);
  color: hsl(var(--foreground));
  box-shadow: 0 1px 8px hsl(222 28% 12% / 0.08);
}

.on-studio-import-button {
  @apply inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-secondary disabled:pointer-events-none disabled:opacity-50;
}
```

- [ ] **Step 5: Run frontend build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SidebarModeSwitch.tsx src/components/StudioSidebar.tsx src/components/Sidebar.tsx src/index.css
git commit -m "Add Studio sidebar mode"
```

## Task 6: Studio Workspace Split View

**Files:**
- Create: `src/components/StudioWorkspace.tsx`
- Modify: `src/components/PageEditor.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Modify `PageEditor.tsx` props**

Change props:

```tsx
export function Editor({
  page,
  pages,
  onSelectPage,
  variant = "page",
}: {
  page: Page;
  pages: Page[];
  onSelectPage: (id: string) => void;
  variant?: "page" | "studio";
}) {
```

Add:

```tsx
const isStudioVariant = variant === "studio";
```

Hide normal page chrome:

```tsx
{!isStudioVariant && (
  <div className="mb-8 flex min-h-7 items-center gap-1 overflow-hidden pr-40 text-xs text-muted-foreground">
    {/* existing breadcrumbs */}
  </div>
)}
```

Wrap page actions, cover, icon picker, template badge, database panel, subpages in `!isStudioVariant` checks. Keep title input and BlockNote editor visible.

Change outer content width:

```tsx
className={`relative mx-auto flex flex-1 flex-col overflow-y-auto px-8 pb-16 pt-3 ${isStudioVariant ? "w-full max-w-none" : "w-full max-w-3xl"}`}
```

- [ ] **Step 2: Create `StudioWorkspace.tsx`**

```tsx
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo } from "react";
import { Page } from "../lib/db";
import { StudioDocument, studioPdfSrc } from "../lib/studio";
import { Editor } from "./PageEditor";

type StudioWorkspaceProps = {
  document: StudioDocument;
  note: Page | null;
  pages: Page[];
  onSelectPage: (id: string) => void;
  onUpdateViewer: (id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: "pdf-left" | "note-left" }) => void;
};

export function StudioWorkspace({ document, note, pages, onSelectPage, onUpdateViewer }: StudioWorkspaceProps) {
  const pdfSrc = useMemo(() => studioPdfSrc(document), [document]);
  const pdfPanel = (
    <section className="on-studio-panel min-w-0">
      <iframe key={pdfSrc} title={document.title} src={pdfSrc} className="h-full w-full bg-background" />
    </section>
  );
  const notePanel = (
    <section className="on-studio-panel min-w-0 overflow-hidden">
      {note ? (
        <Editor page={note} pages={pages} onSelectPage={onSelectPage} variant="studio" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Linked note missing.</div>
      )}
    </section>
  );
  const nextLayout = document.panel_layout === "pdf-left" ? "note-left" : "pdf-left";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border/70 px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{document.title}</div>
          <div className="truncate text-xs text-muted-foreground">{document.original_filename}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="on-icon-button" title="Zoom out" onClick={() => onUpdateViewer(document.id, { viewer_zoom: Math.max(25, document.viewer_zoom - 25) })}>
            <ZoomOut className="h-4 w-4" />
          </button>
          <div className="w-12 text-center text-xs text-muted-foreground">{document.viewer_zoom}%</div>
          <button className="on-icon-button" title="Zoom in" onClick={() => onUpdateViewer(document.id, { viewer_zoom: Math.min(300, document.viewer_zoom + 25) })}>
            <ZoomIn className="h-4 w-4" />
          </button>
          <button className="on-icon-button" title="Swap panels" onClick={() => onUpdateViewer(document.id, { panel_layout: nextLayout })}>
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-border/70">
        {document.panel_layout === "pdf-left" ? (
          <>
            {pdfPanel}
            {notePanel}
          </>
        ) : (
          <>
            {notePanel}
            {pdfPanel}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire `App.tsx`**

Import:

```tsx
import { StudioWorkspace } from "./components/StudioWorkspace";
```

Read store:

```tsx
const {
  pages,
  currentPageId,
  theme,
  isLoading,
  addPage,
  setCurrentPageId,
  workspaceMode,
  studioDocuments,
  currentStudioDocumentId,
  updateStudioViewerAction,
} = useAppStore();
```

Before Note rendering:

```tsx
const currentStudioDocument = studioDocuments.find((document) => document.id === currentStudioDocumentId) ?? null;
const currentStudioNote = currentStudioDocument ? pages.find((page) => page.id === currentStudioDocument.note_page_id) ?? null : null;
```

Render Studio branch before Home branch:

```tsx
) : workspaceMode === "studio" ? (
  currentStudioDocument ? (
    <StudioWorkspace
      document={currentStudioDocument}
      note={currentStudioNote}
      pages={pages}
      onSelectPage={setCurrentPageId}
      onUpdateViewer={(id, updates) => void updateStudioViewerAction(id, updates)}
    />
  ) : (
    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
      Import a PDF from the Studio sidebar to start.
    </div>
  )
```

- [ ] **Step 4: Add CSS panels**

In `src/index.css`:

```css
.on-studio-panel {
  background: hsl(var(--background));
  min-height: 0;
}
```

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/StudioWorkspace.tsx src/components/PageEditor.tsx src/components/App.tsx src/index.css
git commit -m "Add Studio workspace view"
```

## Task 7: Backend Viewer State Update

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing test**

```rust
#[test]
fn update_studio_document_viewer_state_persists_preferences() {
    tauri::async_runtime::block_on(async {
        let db = test_db().await;
        import_studio_document_record(
            &db,
            ImportStudioDocumentRecord {
                document_id: "doc-1",
                note_page_id: "note-1",
                title: "Sample",
                original_filename: "sample.pdf",
                stored_file_path: "/tmp/sample.pdf",
                imported_at: "2026-05-27T00:00:00.000Z",
            },
        )
        .await
        .expect("create document");

        update_studio_document_viewer_state_record(
            &db,
            "doc-1",
            StudioViewerUpdates {
                viewer_zoom: Some(150),
                viewer_page: Some(3),
                panel_layout: Some("note-left".to_string()),
                last_opened_at: Some("2026-05-27T00:10:00.000Z".to_string()),
            },
            "2026-05-27T00:10:00.000Z",
        )
        .await
        .expect("update viewer state");

        let document = list_studio_document_records(&db)
            .await
            .expect("list documents")
            .remove(0);
        assert_eq!(document.viewer_zoom, 150);
        assert_eq!(document.viewer_page, 3);
        assert_eq!(document.panel_layout, "note-left");
    });
}
```

- [ ] **Step 2: Add helper and command**

```rust
async fn update_studio_document_viewer_state_record(
    db: &SqlitePool,
    id: &str,
    updates: StudioViewerUpdates,
    updated_at: &str,
) -> Result<(), String> {
    let viewer_zoom = updates.viewer_zoom.unwrap_or(100).clamp(25, 300);
    let viewer_page = updates.viewer_page.unwrap_or(1).max(1);
    let panel_layout = match updates.panel_layout.as_deref() {
        Some("note-left") => "note-left",
        _ => "pdf-left",
    };
    let last_opened_at = updates.last_opened_at.as_deref().unwrap_or(updated_at);

    sqlx::query(
        "UPDATE studio_documents
         SET viewer_zoom = ?, viewer_page = ?, panel_layout = ?, last_opened_at = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(viewer_zoom)
    .bind(viewer_page)
    .bind(panel_layout)
    .bind(last_opened_at)
    .bind(updated_at)
    .bind(id)
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn update_studio_document_viewer_state(
    id: String,
    updates: StudioViewerUpdates,
    updated_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    update_studio_document_viewer_state_record(&state.db, &id, updates, &updated_at).await
}
```

Add command to `generate_handler!`.

- [ ] **Step 3: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml update_studio_document_viewer_state_persists_preferences
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Persist Studio viewer state"
```

## Task 8: E2E Studio Flow

**Files:**
- Create: `tests/e2e/studio.e2e.ts`

- [ ] **Step 1: Create e2e test**

```ts
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const documentsKey = "opennotion-e2e-studio-documents";
    const pagesKey = "opennotion-e2e-pages";
    const load = <T,>(key: string): T[] => JSON.parse(window.localStorage.getItem(key) ?? "[]");
    const save = <T,>(key: string, value: T[]) => window.localStorage.setItem(key, JSON.stringify(value));
    let callbackCounter = 0;

    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => {
        callbackCounter += 1;
        return callbackCounter;
      },
      unregisterCallback: () => undefined,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "list_pages") return load(pagesKey);
        if (cmd === "list_studio_documents") return load(documentsKey);
        if (cmd === "plugin:dialog|open") return "/tmp/civil-law.pdf";
        if (cmd === "import_studio_document") {
          const document = {
            id: args.documentId as string,
            title: "civil-law",
            original_filename: "civil-law.pdf",
            stored_file_path: "/tmp/civil-law.pdf",
            note_page_id: args.notePageId as string,
            last_opened_at: args.importedAt as string,
            viewer_zoom: 100,
            viewer_page: 1,
            panel_layout: "pdf-left",
            created_at: args.importedAt as string,
            updated_at: args.importedAt as string,
          };
          const note = {
            id: args.notePageId as string,
            title: "civil-law Notes",
            parent_id: null,
            content: null,
            search_text: null,
            icon: null,
            cover_url: null,
            is_deleted: 0,
            is_favorite: 0,
            is_template: 0,
            is_database: 0,
            database_schema: null,
            properties: null,
            sort_order: 0,
            page_kind: "studio_note",
            created_at: args.importedAt as string,
            updated_at: args.importedAt as string,
          };
          save(documentsKey, [document]);
          save(pagesKey, [note]);
          return document;
        }
        if (cmd === "update_studio_document_viewer_state") {
          const documents = load<any>(documentsKey);
          save(documentsKey, documents.map((document) => document.id === args.id ? { ...document, ...(args.updates as object) } : document));
          return null;
        }
        if (cmd === "update_page") return null;
        if (cmd === "search_pages") return [];
        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
    };
  });
});

test("imports PDF and opens Studio split view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  await expect(page.getByText("civil-law")).toBeVisible();
  await expect(page.frameLocator("iframe[title='civil-law']").locator("body")).toBeAttached();
  await expect(page.locator("input[placeholder='Untitled']")).toHaveValue("civil-law Notes");

  await page.getByTitle("Swap panels").click();
  await expect(page.getByText("100%")).toBeVisible();
});
```

- [ ] **Step 2: Run e2e**

```bash
npm run e2e -- tests/e2e/studio.e2e.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/studio.e2e.ts
git commit -m "Add Studio e2e coverage"
```

## Task 9: Final Verification

**Files:**
- All changed implementation files

- [ ] **Step 1: Run focused checks**

```bash
cargo test --manifest-path src-tauri/Cargo.toml studio
npm run test -- src/lib/studioDocuments.test.ts src/lib/homeSections.test.ts src/lib/commandPaletteSections.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run Tauri gate**

```bash
npm run check:tauri
```

Expected: PASS. If `npm audit --audit-level=moderate` fails for existing advisories, record exact advisory and run all other `check:tauri` subcommands separately.

- [ ] **Step 3: Manual browser QA**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:1420/`.

Verify:

- `Note | Studio` switch visible.
- Note mode still shows existing pages.
- Studio mode shows `Import PDF`, `Recenti`, `Tutti i documenti`.
- Imported PDF appears in both Studio sections.
- Split opens with PDF left and note right.
- Swap button persists `note-left`.
- Zoom buttons update percentage and PDF hash.
- Studio note absent from Note sidebar.
- Glass sidebar readable in light and dark modes.
- Hover states visible on switch, rows, import button, toolbar buttons.

- [ ] **Step 4: Commit verification-only fixes**

If verification requires fixes, commit them path-limited:

```bash
git add <exact-files>
git commit -m "Fix Studio verification issues"
```

Expected: final `git status --short` shows only unrelated pre-existing dirty files.
