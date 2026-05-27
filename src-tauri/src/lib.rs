use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{FromRow, SqlitePool};
use std::fs::{
    copy, create_dir_all, metadata, remove_dir_all, remove_file, set_permissions, write, File,
    Permissions,
};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

const APP_SQLITE_MAX_CONNECTIONS: u32 = 2;
const COVER_IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;
const STUDIO_PDF_MAX_BYTES: u64 = 512 * 1024 * 1024;
const APP_SCHEMA_VERSION: &str = "1";
const IMAGE_MAGIC_HEADERS: &[(&str, &[u8])] = &[
    ("png", &[137, 80, 78, 71, 13, 10, 26, 10]),
    ("jpg", &[255, 216, 255]),
    ("gif", b"GIF87a"),
    ("gif", b"GIF89a"),
    ("webp", b"RIFF"),
];

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
}

#[derive(Debug, FromRow, Serialize)]
struct Page {
    id: String,
    title: String,
    parent_id: Option<String>,
    content: Option<String>,
    search_text: Option<String>,
    icon: Option<String>,
    cover_url: Option<String>,
    is_deleted: i64,
    is_favorite: i64,
    is_template: i64,
    is_database: i64,
    database_schema: Option<String>,
    properties: Option<String>,
    sort_order: i64,
    page_kind: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct ImportedPage {
    id: String,
    title: String,
    parent_id: Option<String>,
    content: Option<String>,
    search_text: Option<String>,
    icon: Option<String>,
    cover_url: Option<String>,
    is_deleted: i64,
    is_favorite: i64,
    is_template: Option<i64>,
    is_database: Option<i64>,
    database_schema: Option<String>,
    properties: Option<String>,
    sort_order: Option<i64>,
    page_kind: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, FromRow, Serialize)]
struct SearchResult {
    id: String,
    title: String,
    parent_id: Option<String>,
    content: Option<String>,
    search_text: Option<String>,
    icon: Option<String>,
    cover_url: Option<String>,
    is_deleted: i64,
    is_favorite: i64,
    is_template: i64,
    is_database: i64,
    database_schema: Option<String>,
    properties: Option<String>,
    sort_order: i64,
    page_kind: String,
    created_at: String,
    updated_at: String,
    matched_content: Option<String>,
}

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
struct PageUpdates {
    title: Option<String>,
    parent_id: Option<String>,
    content: Option<String>,
    search_text: Option<String>,
    icon: Option<String>,
    cover_url: Option<String>,
    is_deleted: Option<i64>,
    is_favorite: Option<i64>,
    is_template: Option<i64>,
    is_database: Option<i64>,
    database_schema: Option<String>,
    properties: Option<String>,
    page_kind: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StudioViewerUpdates {
    viewer_zoom: Option<i64>,
    viewer_page: Option<i64>,
    panel_layout: Option<String>,
    last_opened_at: Option<String>,
}

async fn run_migrations(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
    .execute(db)
    .await?;

    sqlx::query(
        "INSERT INTO app_metadata (key, value)
         VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(APP_SCHEMA_VERSION)
    .execute(db)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS pages (
            id TEXT PRIMARY KEY,
            title TEXT,
            parent_id TEXT,
            content TEXT,
            icon TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .execute(db)
    .await?;

    let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('pages')")
        .fetch_all(db)
        .await?;

    if !columns.iter().any(|column| column == "cover_url") {
        sqlx::query("ALTER TABLE pages ADD COLUMN cover_url TEXT")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "search_text") {
        sqlx::query("ALTER TABLE pages ADD COLUMN search_text TEXT")
            .execute(db)
            .await?;
        sqlx::query("UPDATE pages SET search_text = content WHERE search_text IS NULL")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "is_deleted") {
        sqlx::query("ALTER TABLE pages ADD COLUMN is_deleted INTEGER DEFAULT 0")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "is_favorite") {
        sqlx::query("ALTER TABLE pages ADD COLUMN is_favorite INTEGER DEFAULT 0")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "sort_order") {
        sqlx::query("ALTER TABLE pages ADD COLUMN sort_order INTEGER DEFAULT 0")
            .execute(db)
            .await?;
        sqlx::query("UPDATE pages SET sort_order = rowid WHERE sort_order = 0")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "is_template") {
        sqlx::query("ALTER TABLE pages ADD COLUMN is_template INTEGER DEFAULT 0")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "is_database") {
        sqlx::query("ALTER TABLE pages ADD COLUMN is_database INTEGER DEFAULT 0")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "database_schema") {
        sqlx::query("ALTER TABLE pages ADD COLUMN database_schema TEXT")
            .execute(db)
            .await?;
    }

    if !columns.iter().any(|column| column == "properties") {
        sqlx::query("ALTER TABLE pages ADD COLUMN properties TEXT")
            .execute(db)
            .await?;
    }

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

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_pages_active_parent_sort
         ON pages (is_deleted, parent_id, sort_order)",
    )
    .execute(db)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_pages_active_updated_at
         ON pages (is_deleted, updated_at)",
    )
    .execute(db)
    .await?;

    Ok(())
}

async fn configure_sqlite_database(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("PRAGMA journal_mode = WAL").execute(db).await?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(db)
        .await?;

    Ok(())
}

async fn create_page_record(
    db: &SqlitePool,
    id: &str,
    title: &str,
    parent_id: Option<&str>,
    created_at: &str,
) -> Result<Page, sqlx::Error> {
    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MIN(sort_order), 0) - 1
         FROM pages
         WHERE is_deleted = 0
           AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)",
    )
    .bind(parent_id)
    .bind(parent_id)
    .fetch_one(db)
    .await?;

    sqlx::query(
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'note', ?, ?)",
    )
    .bind(id)
    .bind(title)
    .bind(parent_id)
    .bind(sort_order)
    .bind(created_at)
    .bind(created_at)
    .execute(db)
    .await?;

    Ok(Page {
        id: id.to_string(),
        title: title.to_string(),
        parent_id: parent_id.map(str::to_string),
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
        sort_order,
        page_kind: "note".to_string(),
        created_at: created_at.to_string(),
        updated_at: created_at.to_string(),
    })
}

#[allow(dead_code)]
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

async fn get_page_record(db: &SqlitePool, id: &str) -> Result<Option<Page>, sqlx::Error> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at
         FROM pages
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await
}

async fn update_page_content(
    db: &SqlitePool,
    id: &str,
    content: &str,
    search_text: &str,
    updated_at: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE pages SET content = ?, search_text = ?, updated_at = ? WHERE id = ?")
        .bind(content)
        .bind(search_text)
        .bind(updated_at)
        .bind(id)
        .execute(db)
        .await?;

    Ok(())
}

async fn list_page_records(db: &SqlitePool) -> Result<Vec<Page>, sqlx::Error> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at
         FROM pages
         WHERE is_deleted = 0
           AND page_kind = 'note'
         ORDER BY sort_order ASC, created_at DESC",
    )
    .fetch_all(db)
    .await
}

async fn list_all_page_records(db: &SqlitePool) -> Result<Vec<Page>, sqlx::Error> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at
         FROM pages
         ORDER BY sort_order ASC, created_at DESC",
    )
    .fetch_all(db)
    .await
}

async fn search_page_records(
    query: &str,
    db: &SqlitePool,
) -> Result<Vec<SearchResult>, sqlx::Error> {
    let trimmed = query.trim();

    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let pattern = format!("%{}%", trimmed.to_lowercase());

    sqlx::query_as::<_, SearchResult>(
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at,
                CASE
                  WHEN lower(coalesce(search_text, '')) LIKE ? THEN search_text
                  ELSE NULL
                END AS matched_content
         FROM pages
         WHERE is_deleted = 0
           AND page_kind = 'note'
           AND (lower(coalesce(title, '')) LIKE ? OR lower(coalesce(search_text, '')) LIKE ?)
         ORDER BY
           CASE WHEN lower(coalesce(title, '')) LIKE ? THEN 0 ELSE 1 END,
           updated_at DESC
         LIMIT 50",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .fetch_all(db)
    .await
}

async fn hard_delete_page_tree(db: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE id = ?
            UNION ALL
            SELECT pages.id FROM pages
            JOIN descendants ON pages.parent_id = descendants.id
         )
         DELETE FROM pages
         WHERE id IN (SELECT id FROM descendants)",
    )
    .bind(id)
    .execute(db)
    .await?;

    Ok(())
}

async fn import_page_records(db: &SqlitePool, pages: &[ImportedPage]) -> Result<u64, sqlx::Error> {
    let mut imported_count = 0;
    let mut transaction = db.begin().await?;

    for page in pages {
        let result = sqlx::query(
            "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&page.id)
        .bind(&page.title)
        .bind(&page.parent_id)
        .bind(&page.content)
        .bind(&page.search_text)
        .bind(&page.icon)
        .bind(&page.cover_url)
        .bind(page.is_deleted)
        .bind(page.is_favorite)
        .bind(page.is_template.unwrap_or(0))
        .bind(page.is_database.unwrap_or(0))
        .bind(&page.database_schema)
        .bind(&page.properties)
        .bind(page.sort_order.unwrap_or(0))
        .bind(page.page_kind.as_deref().unwrap_or("note"))
        .bind(&page.created_at)
        .bind(&page.updated_at)
        .execute(&mut *transaction)
        .await?;

        imported_count += result.rows_affected();
    }

    transaction.commit().await?;

    Ok(imported_count)
}

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

async fn update_studio_document_viewer_state_record(
    db: &SqlitePool,
    id: &str,
    updates: StudioViewerUpdates,
    updated_at: &str,
) -> Result<(), String> {
    let current = sqlx::query_as::<_, StudioDocument>(
        "SELECT id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at
         FROM studio_documents
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|error| error.to_string())?;
    let viewer_zoom = updates
        .viewer_zoom
        .unwrap_or(current.viewer_zoom)
        .clamp(25, 300);
    let viewer_page = updates.viewer_page.unwrap_or(current.viewer_page).max(1);
    let panel_layout = match updates.panel_layout.as_deref() {
        Some("note-left") => "note-left",
        Some("pdf-left") => "pdf-left",
        _ => current.panel_layout.as_str(),
    };
    let last_opened_at = updates
        .last_opened_at
        .as_deref()
        .unwrap_or(current.last_opened_at.as_str());

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

async fn rename_studio_document_record(
    db: &SqlitePool,
    id: &str,
    title: &str,
    updated_at: &str,
) -> Result<(), String> {
    let current = sqlx::query_as::<_, StudioDocument>(
        "SELECT id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at
         FROM studio_documents
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|error| error.to_string())?;

    let mut transaction = db.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("UPDATE studio_documents SET title = ?, updated_at = ? WHERE id = ?")
        .bind(title)
        .bind(updated_at)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?")
        .bind(format!("{} Notes", title))
        .bind(updated_at)
        .bind(current.note_page_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

async fn delete_studio_document_record(db: &SqlitePool, id: &str) -> Result<String, String> {
    let current = sqlx::query_as::<_, StudioDocument>(
        "SELECT id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at
         FROM studio_documents
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await
    .map_err(|error| error.to_string())?;
    let stored_file_path = current.stored_file_path.clone();

    let mut transaction = db.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM studio_documents WHERE id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM pages WHERE id = ?")
        .bind(current.note_page_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;

    Ok(stored_file_path)
}

fn remove_stored_studio_document_file(stored_file_path: &str) -> Result<(), String> {
    let stored_path = Path::new(stored_file_path);
    match remove_file(stored_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    let Some(parent) = stored_path.parent() else {
        return Ok(());
    };
    let is_expected_studio_copy = stored_path
        .file_name()
        .is_some_and(|name| name == std::ffi::OsStr::new("source.pdf"))
        && parent
            .parent()
            .and_then(|ancestor| ancestor.file_name())
            .is_some_and(|name| name == std::ffi::OsStr::new("studio-documents"));

    if !is_expected_studio_copy {
        return Ok(());
    }

    match remove_dir_all(parent) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

async fn create_page_from_template_record(
    db: &SqlitePool,
    id: &str,
    template_id: &str,
    parent_id: Option<&str>,
    created_at: &str,
) -> Result<Page, sqlx::Error> {
    let template = get_page_record(db, template_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MIN(sort_order), 0) - 1
         FROM pages
         WHERE is_deleted = 0
           AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)",
    )
    .bind(parent_id)
    .bind(parent_id)
    .fetch_one(db)
    .await?;

    sqlx::query(
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)",
    )
    .bind(id)
    .bind(&template.title)
    .bind(parent_id)
    .bind(&template.content)
    .bind(&template.search_text)
    .bind(&template.icon)
    .bind(&template.cover_url)
    .bind(template.is_database)
    .bind(&template.database_schema)
    .bind(&template.properties)
    .bind(sort_order)
    .bind(created_at)
    .bind(created_at)
    .execute(db)
    .await?;

    Ok(Page {
        id: id.to_string(),
        title: template.title,
        parent_id: parent_id.map(str::to_string),
        content: template.content,
        search_text: template.search_text,
        icon: template.icon,
        cover_url: template.cover_url,
        is_deleted: 0,
        is_favorite: 0,
        is_template: 0,
        is_database: template.is_database,
        database_schema: template.database_schema,
        properties: template.properties,
        sort_order,
        page_kind: "note".to_string(),
        created_at: created_at.to_string(),
        updated_at: created_at.to_string(),
    })
}

async fn duplicate_page_record(
    db: &SqlitePool,
    id: &str,
    source_id: &str,
    created_at: &str,
) -> Result<Page, sqlx::Error> {
    let source = get_page_record(db, source_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    let title = format!("Copy of {}", source.title);

    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MIN(sort_order), 0) - 1
         FROM pages
         WHERE is_deleted = 0
           AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)",
    )
    .bind(source.parent_id.as_deref())
    .bind(source.parent_id.as_deref())
    .fetch_one(db)
    .await?;

    sqlx::query(
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)",
    )
    .bind(id)
    .bind(&title)
    .bind(&source.parent_id)
    .bind(&source.content)
    .bind(&source.search_text)
    .bind(&source.icon)
    .bind(&source.cover_url)
    .bind(source.is_database)
    .bind(&source.database_schema)
    .bind(&source.properties)
    .bind(sort_order)
    .bind(created_at)
    .bind(created_at)
    .execute(db)
    .await?;

    Ok(Page {
        id: id.to_string(),
        title,
        parent_id: source.parent_id,
        content: source.content,
        search_text: source.search_text,
        icon: source.icon,
        cover_url: source.cover_url,
        is_deleted: 0,
        is_favorite: 0,
        is_template: 0,
        is_database: source.is_database,
        database_schema: source.database_schema,
        properties: source.properties,
        sort_order,
        page_kind: "note".to_string(),
        created_at: created_at.to_string(),
        updated_at: created_at.to_string(),
    })
}

async fn reorder_page_records(
    db: &SqlitePool,
    parent_id: Option<&str>,
    ordered_ids: &[String],
    updated_at: &str,
) -> Result<(), String> {
    if ordered_ids.is_empty() {
        return Ok(());
    }

    let mut transaction = db.begin().await.map_err(|error| error.to_string())?;

    for (index, id) in ordered_ids.iter().enumerate() {
        let result = sqlx::query(
            "UPDATE pages
             SET sort_order = ?, updated_at = ?
             WHERE id = ?
               AND is_deleted = 0
               AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)",
        )
        .bind(index as i64)
        .bind(updated_at)
        .bind(id)
        .bind(parent_id)
        .bind(parent_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;

        if result.rows_affected() == 0 {
            return Err("page order contains invalid page".to_string());
        }
    }

    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

async fn move_page_record(
    db: &SqlitePool,
    id: &str,
    parent_id: Option<&str>,
    updated_at: &str,
) -> Result<(), String> {
    if let Some(parent_id) = parent_id {
        if parent_id == id {
            return Err("page cannot be moved under itself".to_string());
        }

        let parent_exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM pages WHERE id = ? AND is_deleted = 0")
                .bind(parent_id)
                .fetch_optional(db)
                .await
                .map_err(|error| error.to_string())?;

        if parent_exists.is_none() {
            return Err("target parent page does not exist".to_string());
        }

        let descendant_match: Option<String> = sqlx::query_scalar(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM pages WHERE parent_id = ?
                UNION ALL
                SELECT pages.id FROM pages
                JOIN descendants ON pages.parent_id = descendants.id
             )
             SELECT id FROM descendants WHERE id = ? LIMIT 1",
        )
        .bind(id)
        .bind(parent_id)
        .fetch_optional(db)
        .await
        .map_err(|error| error.to_string())?;

        if descendant_match.is_some() {
            return Err("page cannot be moved under one of its descendants".to_string());
        }
    }

    let result = sqlx::query("UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?")
        .bind(parent_id)
        .bind(updated_at)
        .bind(id)
        .execute(db)
        .await
        .map_err(|error| error.to_string())?;

    if result.rows_affected() == 0 {
        return Err("page does not exist".to_string());
    }

    Ok(())
}

fn allowed_cover_extension(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_string_lossy().to_lowercase().as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        _ => None,
    }
}

fn cover_extension_from_magic(header: &[u8]) -> Option<&'static str> {
    if header.len() >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        return Some("webp");
    }

    for (extension, magic) in IMAGE_MAGIC_HEADERS {
        if header.starts_with(magic) {
            return Some(extension);
        }
    }

    None
}

fn validated_pdf_file(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .filter(|value| value == "pdf")
        .ok_or_else(|| "file must be a PDF".to_string())?;

    let file_size = metadata(path).map_err(|error| error.to_string())?.len();
    if file_size > STUDIO_PDF_MAX_BYTES {
        return Err("PDF must be 512 MB or smaller".to_string());
    }

    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 5];
    let bytes_read = file.read(&mut header).map_err(|error| error.to_string())?;
    if bytes_read < 5 || &header != b"%PDF-" {
        return Err("PDF content is not valid".to_string());
    }

    let _ = extension;
    Ok("pdf")
}

fn safe_storage_id(id: &str) -> String {
    let safe_id: String = id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();

    if safe_id.is_empty() {
        "document".to_string()
    } else {
        safe_id
    }
}

fn validated_cover_extension(path: &Path, max_bytes: u64) -> Result<&'static str, String> {
    let extension = allowed_cover_extension(path)
        .ok_or_else(|| "cover image must be PNG, JPG, WebP, or GIF".to_string())?;
    let file_size = metadata(path).map_err(|error| error.to_string())?.len();

    if file_size > max_bytes {
        return Err("cover image must be 10 MB or smaller".to_string());
    }

    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 12];
    let bytes_read = file.read(&mut header).map_err(|error| error.to_string())?;
    let detected_extension = cover_extension_from_magic(&header[..bytes_read])
        .ok_or_else(|| "cover image content is not a supported image".to_string())?;

    if detected_extension != extension {
        return Err("cover image content does not match its extension".to_string());
    }

    Ok(extension)
}

fn cover_destination(
    covers_dir: &Path,
    page_id: &str,
    source_path: &Path,
) -> Result<PathBuf, String> {
    let extension = allowed_cover_extension(source_path)
        .ok_or_else(|| "cover image must be PNG, JPG, WebP, or GIF".to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let safe_page_id: String = page_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();
    let file_name = format!("{}-{}.{}", safe_page_id, timestamp, extension);

    Ok(covers_dir.join(file_name))
}

fn safe_file_stem(file_name: &str) -> String {
    let stem = file_name
        .rsplit_once('.')
        .map_or(file_name, |(stem, _)| stem);
    let safe_name: String = stem
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .collect();

    if safe_name.is_empty() {
        "image".to_string()
    } else {
        safe_name
    }
}

fn validated_editor_image_extension(file_name: &str, bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.len() as u64 > COVER_IMAGE_MAX_BYTES {
        return Err("image must be 10 MB or smaller".to_string());
    }

    let extension = Path::new(file_name)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .and_then(|value| match value.as_str() {
            "png" => Some("png"),
            "jpg" | "jpeg" => Some("jpg"),
            "webp" => Some("webp"),
            "gif" => Some("gif"),
            _ => None,
        })
        .ok_or_else(|| "image must be PNG, JPG, WebP, or GIF".to_string())?;
    let detected_extension = cover_extension_from_magic(bytes)
        .ok_or_else(|| "image content is not a supported image".to_string())?;

    if detected_extension != extension {
        return Err("image content does not match its extension".to_string());
    }

    Ok(extension)
}

fn editor_image_destination(
    images_dir: &Path,
    page_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let extension = validated_editor_image_extension(file_name, bytes)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let safe_page_id = safe_storage_id(page_id);
    let safe_name = safe_file_stem(file_name);
    let image_dir = images_dir.join(safe_page_id);
    ensure_private_directory(&image_dir).map_err(|error| error.to_string())?;

    Ok(image_dir.join(format!("{}-{}.{}", timestamp, safe_name, extension)))
}

fn ensure_private_directory(path: &Path) -> std::io::Result<()> {
    create_dir_all(path)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        set_permissions(path, Permissions::from_mode(0o700))?;
    }

    Ok(())
}

fn copy_cover_image<R: Runtime>(
    app: &tauri::AppHandle<R>,
    source_path: &Path,
    page_id: &str,
) -> Result<String, String> {
    let covers_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("covers");
    ensure_private_directory(&covers_dir).map_err(|error| error.to_string())?;

    validated_cover_extension(source_path, COVER_IMAGE_MAX_BYTES)?;
    let destination = cover_destination(&covers_dir, page_id, source_path)?;
    copy(source_path, &destination).map_err(|error| error.to_string())?;

    Ok(destination.to_string_lossy().to_string())
}

fn copy_editor_image<R: Runtime>(
    app: &tauri::AppHandle<R>,
    page_id: &str,
    file_name: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let images_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("editor-images");
    let destination = editor_image_destination(&images_dir, page_id, file_name, &bytes)?;
    write(&destination, bytes).map_err(|error| error.to_string())?;

    Ok(destination.to_string_lossy().to_string())
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

#[tauri::command]
async fn list_pages(state: tauri::State<'_, AppState>) -> Result<Vec<Page>, String> {
    list_page_records(&state.db)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_all_pages(state: tauri::State<'_, AppState>) -> Result<Vec<Page>, String> {
    list_all_page_records(&state.db)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn search_pages(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    search_page_records(&query, &state.db)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_page(id: String, state: tauri::State<'_, AppState>) -> Result<Option<Page>, String> {
    get_page_record(&state.db, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_page(
    id: String,
    title: String,
    parent_id: Option<String>,
    created_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<Page, String> {
    create_page_record(&state.db, &id, &title, parent_id.as_deref(), &created_at)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_page(
    id: String,
    updates: PageUpdates,
    updated_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if let Some(title) = updates.title {
        sqlx::query("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(parent_id) = updates.parent_id {
        sqlx::query("UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?")
            .bind(parent_id)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(content) = updates.content {
        let search_text = updates.search_text.unwrap_or_else(|| content.clone());
        update_page_content(&state.db, &id, &content, &search_text, &updated_at)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(icon) = updates.icon {
        sqlx::query("UPDATE pages SET icon = ?, updated_at = ? WHERE id = ?")
            .bind(icon)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(cover_url) = updates.cover_url {
        sqlx::query("UPDATE pages SET cover_url = ?, updated_at = ? WHERE id = ?")
            .bind(cover_url)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(is_deleted) = updates.is_deleted {
        sqlx::query("UPDATE pages SET is_deleted = ?, updated_at = ? WHERE id = ?")
            .bind(is_deleted)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(is_favorite) = updates.is_favorite {
        sqlx::query("UPDATE pages SET is_favorite = ?, updated_at = ? WHERE id = ?")
            .bind(is_favorite)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(is_template) = updates.is_template {
        sqlx::query("UPDATE pages SET is_template = ?, updated_at = ? WHERE id = ?")
            .bind(is_template)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(is_database) = updates.is_database {
        sqlx::query("UPDATE pages SET is_database = ?, updated_at = ? WHERE id = ?")
            .bind(is_database)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(database_schema) = updates.database_schema {
        sqlx::query("UPDATE pages SET database_schema = ?, updated_at = ? WHERE id = ?")
            .bind(database_schema)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(properties) = updates.properties {
        sqlx::query("UPDATE pages SET properties = ?, updated_at = ? WHERE id = ?")
            .bind(properties)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    if let Some(page_kind) = updates.page_kind {
        sqlx::query("UPDATE pages SET page_kind = ?, updated_at = ? WHERE id = ?")
            .bind(page_kind)
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn delete_page(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    hard_delete_page_tree(&state.db, &id)
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn move_page(
    id: String,
    parent_id: Option<String>,
    updated_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    move_page_record(&state.db, &id, parent_id.as_deref(), &updated_at).await
}

#[tauri::command]
async fn reorder_pages(
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
    updated_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    reorder_page_records(&state.db, parent_id.as_deref(), &ordered_ids, &updated_at).await
}

#[tauri::command]
async fn import_pages(
    pages: Vec<ImportedPage>,
    state: tauri::State<'_, AppState>,
) -> Result<u64, String> {
    import_page_records(&state.db, &pages)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_studio_documents(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<StudioDocument>, String> {
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
    let stored_file_path = destination.to_string_lossy().to_string();

    match import_studio_document_record(
        &state.db,
        ImportStudioDocumentRecord {
            document_id: &document_id,
            note_page_id: &note_page_id,
            title: &title,
            original_filename: &original_filename,
            stored_file_path: &stored_file_path,
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

#[tauri::command]
async fn update_studio_document_viewer_state(
    id: String,
    updates: StudioViewerUpdates,
    updated_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    update_studio_document_viewer_state_record(&state.db, &id, updates, &updated_at).await
}

#[tauri::command]
async fn rename_studio_document(
    id: String,
    title: String,
    updated_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("title cannot be empty".to_string());
    }

    rename_studio_document_record(&state.db, &id, title, &updated_at).await
}

#[tauri::command]
async fn delete_studio_document(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let stored_file_path = delete_studio_document_record(&state.db, &id).await?;
    remove_stored_studio_document_file(&stored_file_path)
}

#[tauri::command]
async fn toggle_favorite(
    id: String,
    is_favorite: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query("UPDATE pages SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(if is_favorite { 1 } else { 0 })
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn toggle_template(
    id: String,
    is_template: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query("UPDATE pages SET is_template = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(if is_template { 1 } else { 0 })
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn create_page_from_template(
    id: String,
    template_id: String,
    parent_id: Option<String>,
    created_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<Page, String> {
    create_page_from_template_record(
        &state.db,
        &id,
        &template_id,
        parent_id.as_deref(),
        &created_at,
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn duplicate_page(
    id: String,
    source_id: String,
    created_at: String,
    state: tauri::State<'_, AppState>,
) -> Result<Page, String> {
    duplicate_page_record(&state.db, &id, &source_id, &created_at)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn import_cover_image<R: Runtime>(
    source_path: String,
    page_id: String,
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    copy_cover_image(&app, Path::new(&source_path), &page_id)
}

#[tauri::command]
async fn import_editor_image<R: Runtime>(
    page_id: String,
    file_name: String,
    bytes: Vec<u8>,
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    copy_editor_image(&app, &page_id, &file_name, bytes)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn show_character_palette<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    app.run_on_main_thread(|| {
        if let Some(marker) = objc2::MainThreadMarker::new() {
            let application = objc2_app_kit::NSApplication::sharedApplication(marker);
            application.orderFrontCharacterPalette(None);
        }
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn show_character_palette<R: Runtime>(_app: tauri::AppHandle<R>) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_path = app.path().app_config_dir()?;
            ensure_private_directory(&app_path)?;
            let db_path = app_path.join("opennotion.db");
            let db_url = format!("sqlite:{}", db_path.display());
            let options = SqliteConnectOptions::from_str(&db_url)?
                .create_if_missing(true)
                .pragma("journal_mode", "WAL")
                .pragma("synchronous", "NORMAL");
            let db = tauri::async_runtime::block_on(async {
                let db = SqlitePoolOptions::new()
                    .max_connections(APP_SQLITE_MAX_CONNECTIONS)
                    .connect_with(options)
                    .await?;
                configure_sqlite_database(&db).await?;
                run_migrations(&db).await?;
                Ok::<_, sqlx::Error>(db)
            })?;

            app.manage(AppState { db });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_pages,
            list_all_pages,
            search_pages,
            get_page,
            create_page,
            update_page,
            delete_page,
            move_page,
            reorder_pages,
            import_pages,
            list_studio_documents,
            import_studio_document,
            update_studio_document_viewer_state,
            rename_studio_document,
            delete_studio_document,
            toggle_favorite,
            toggle_template,
            create_page_from_template,
            duplicate_page,
            import_cover_image,
            import_editor_image,
            show_character_palette
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{remove_dir_all, remove_file, write};
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    async fn test_db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");

        run_migrations(&db).await.expect("run migrations");
        db
    }

    fn temp_path(name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("opennotion-test-{}-{}", timestamp, name))
    }

    #[test]
    fn app_sqlite_pool_size_is_small_for_local_single_user_database() {
        assert_eq!(APP_SQLITE_MAX_CONNECTIONS, 2);
    }

    #[test]
    fn migrations_create_page_lookup_indexes() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            let indexes: Vec<String> =
                sqlx::query_scalar("SELECT name FROM pragma_index_list('pages')")
                    .fetch_all(&db)
                    .await
                    .expect("list page indexes");

            assert!(indexes.contains(&"idx_pages_active_parent_sort".to_string()));
            assert!(indexes.contains(&"idx_pages_active_updated_at".to_string()));
        });
    }

    #[test]
    fn migrations_record_schema_version() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            let schema_version: String =
                sqlx::query_scalar("SELECT value FROM app_metadata WHERE key = 'schema_version'")
                    .fetch_one(&db)
                    .await
                    .expect("fetch schema version");

            assert_eq!(schema_version, APP_SCHEMA_VERSION);
        });
    }

    #[test]
    fn migrations_create_studio_documents_and_page_kind() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;

            let page_columns: Vec<String> =
                sqlx::query_scalar("SELECT name FROM pragma_table_info('pages')")
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

    #[cfg(unix)]
    #[test]
    fn private_directory_uses_owner_only_permissions() {
        let dir = temp_path("private-dir");

        ensure_private_directory(&dir).expect("create private directory");

        let mode = metadata(&dir)
            .expect("directory metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700);

        let _ = remove_dir_all(&dir);
    }

    #[test]
    fn sqlite_file_database_uses_wal_and_normal_synchronous_mode() {
        tauri::async_runtime::block_on(async {
            let db_path = temp_path("wal.sqlite");
            let db_url = format!("sqlite:{}", db_path.display());
            let options = SqliteConnectOptions::from_str(&db_url)
                .expect("sqlite options")
                .create_if_missing(true);
            let db = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .expect("connect file db");

            configure_sqlite_database(&db)
                .await
                .expect("configure sqlite");
            run_migrations(&db).await.expect("run migrations");

            let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
                .fetch_one(&db)
                .await
                .expect("journal mode");
            let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
                .fetch_one(&db)
                .await
                .expect("synchronous mode");

            assert_eq!(journal_mode.to_lowercase(), "wal");
            assert_eq!(synchronous, 1);

            drop(db);
            let _ = remove_file(&db_path);
            let _ = remove_file(db_path.with_extension("sqlite-shm"));
            let _ = remove_file(db_path.with_extension("sqlite-wal"));
        });
    }

    #[test]
    fn create_update_reload_page_content_smoke() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            let page_id = "page-1";
            let created_at = "2026-05-18T00:00:00.000Z";
            let content = r#"[{"id":"block-1","type":"paragraph","props":{},"content":[{"type":"text","text":"hello persisted content","styles":{}}],"children":[]}]"#;

            let created = create_page_record(&db, page_id, "Smoke", None, created_at)
                .await
                .expect("create page");
            assert_eq!(created.id, page_id);
            assert_eq!(created.title, "Smoke");
            assert_eq!(created.content, None);

            update_page_content(
                &db,
                page_id,
                content,
                "hello persisted content",
                "2026-05-18T00:01:00.000Z",
            )
            .await
            .expect("save content");

            let reloaded = get_page_record(&db, page_id)
                .await
                .expect("reload page")
                .expect("page exists");
            assert_eq!(reloaded.content.as_deref(), Some(content));
        });
    }

    #[test]
    fn cover_extension_allows_images_only() {
        assert_eq!(allowed_cover_extension(Path::new("cover.png")), Some("png"));
        assert_eq!(allowed_cover_extension(Path::new("cover.JPG")), Some("jpg"));
        assert_eq!(
            allowed_cover_extension(Path::new("cover.webp")),
            Some("webp")
        );
        assert_eq!(allowed_cover_extension(Path::new("cover.gif")), Some("gif"));
        assert_eq!(allowed_cover_extension(Path::new("cover.txt")), None);
        assert_eq!(allowed_cover_extension(Path::new("cover")), None);
    }

    #[test]
    fn cover_destination_sanitizes_page_id() {
        let destination = cover_destination(
            Path::new("/tmp/covers"),
            "../page-1_$%",
            Path::new("source.jpeg"),
        )
        .expect("build cover destination");

        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .expect("file name");
        assert!(file_name.starts_with("page-1-"));
        assert!(file_name.ends_with(".jpg"));
    }

    #[test]
    fn cover_validation_reads_magic_bytes_and_rejects_mismatched_extension() {
        let png_path = temp_path("cover.png");
        write(&png_path, [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).expect("write png");
        assert_eq!(
            validated_cover_extension(&png_path, COVER_IMAGE_MAX_BYTES).as_deref(),
            Ok("png")
        );
        let _ = remove_file(&png_path);

        let mismatched_path = temp_path("cover.jpg");
        write(
            &mismatched_path,
            [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0],
        )
        .expect("write mismatched image");
        let error = validated_cover_extension(&mismatched_path, COVER_IMAGE_MAX_BYTES)
            .expect_err("reject mismatched extension");
        assert_eq!(error, "cover image content does not match its extension");
        let _ = remove_file(&mismatched_path);
    }

    #[test]
    fn cover_validation_rejects_large_files() {
        let large_path = temp_path("large.png");
        write(
            &large_path,
            vec![0_u8; (COVER_IMAGE_MAX_BYTES + 1) as usize],
        )
        .expect("write large file");

        let error = validated_cover_extension(&large_path, COVER_IMAGE_MAX_BYTES)
            .expect_err("reject large image");
        assert_eq!(error, "cover image must be 10 MB or smaller");

        let _ = remove_file(&large_path);
    }

    #[test]
    fn editor_image_destination_sanitizes_page_id_and_file_name() {
        let root = temp_path("editor-images");
        let destination = editor_image_destination(
            &root,
            "../page",
            "bad/name.png",
            &[137, 80, 78, 71, 13, 10, 26, 10],
        )
        .expect("build editor image destination");
        let path_text = destination.to_string_lossy();

        assert!(path_text.contains("page"));
        assert!(destination
            .file_name()
            .and_then(|name| name.to_str())
            .expect("file name")
            .ends_with("-badname.png"));

        let _ = remove_dir_all(root);
    }

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
    fn studio_pdf_validation_rejects_oversized_pdf() {
        let large_path = temp_path("large.pdf");
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&large_path)
            .expect("create large pdf");
        file.set_len(STUDIO_PDF_MAX_BYTES + 1)
            .expect("make sparse large pdf");

        let error = validated_pdf_file(&large_path).expect_err("reject large pdf");
        assert_eq!(error, "PDF must be 512 MB or smaller");

        let _ = remove_file(&large_path);
    }

    #[test]
    fn safe_storage_id_uses_fallback_when_input_has_no_safe_characters() {
        assert_eq!(safe_storage_id("../../"), "document");
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

    #[test]
    fn rename_studio_document_updates_document_and_note_title() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            import_studio_document_record(
                &db,
                ImportStudioDocumentRecord {
                    document_id: "doc-1",
                    note_page_id: "note-1",
                    title: "Old",
                    original_filename: "old.pdf",
                    stored_file_path: "/tmp/old.pdf",
                    imported_at: "2026-05-27T00:00:00.000Z",
                },
            )
            .await
            .expect("create document");

            rename_studio_document_record(&db, "doc-1", "New Title", "2026-05-27T00:10:00.000Z")
                .await
                .expect("rename document");

            let document = list_studio_document_records(&db)
                .await
                .expect("list documents")
                .remove(0);
            assert_eq!(document.title, "New Title");

            let note = get_page_record(&db, "note-1")
                .await
                .expect("load linked note")
                .expect("note exists");
            assert_eq!(note.title, "New Title Notes");
        });
    }

    #[test]
    fn delete_studio_document_removes_document_and_linked_note() {
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

            let stored_path = delete_studio_document_record(&db, "doc-1")
                .await
                .expect("delete document");

            assert_eq!(stored_path, "/tmp/sample.pdf");
            assert!(list_studio_document_records(&db)
                .await
                .expect("list documents")
                .is_empty());
            assert!(get_page_record(&db, "note-1")
                .await
                .expect("load linked note")
                .is_none());
        });
    }

    #[test]
    fn remove_stored_studio_document_file_deletes_expected_copy_directory() {
        let root = std::env::temp_dir().join(format!(
            "opennotion-studio-delete-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let document_dir = root.join("studio-documents").join("doc-1");
        create_dir_all(&document_dir).expect("create studio document dir");
        let stored_path = document_dir.join("source.pdf");
        File::create(&stored_path).expect("create copied PDF");

        remove_stored_studio_document_file(
            stored_path
                .to_str()
                .expect("temp path should be valid unicode for test"),
        )
        .expect("remove copied PDF");

        assert!(!document_dir.exists());
        assert!(root.join("studio-documents").exists());
        remove_dir_all(root).expect("cleanup temp root");
    }

    #[test]
    fn remove_stored_studio_document_file_does_not_delete_arbitrary_parent() {
        let root = std::env::temp_dir().join(format!(
            "opennotion-studio-delete-guard-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        create_dir_all(&root).expect("create arbitrary dir");
        let stored_path = root.join("sample.pdf");
        File::create(&stored_path).expect("create arbitrary PDF");

        remove_stored_studio_document_file(
            stored_path
                .to_str()
                .expect("temp path should be valid unicode for test"),
        )
        .expect("remove arbitrary PDF");

        assert!(!stored_path.exists());
        assert!(root.exists());
        remove_dir_all(root).expect("cleanup arbitrary dir");
    }

    #[test]
    fn search_pages_matches_title_and_content() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;

            create_page_record(
                &db,
                "page-title",
                "Project Roadmap",
                None,
                "2026-05-18T00:00:00.000Z",
            )
            .await
            .expect("create title match");
            create_page_record(
                &db,
                "page-content",
                "Notes",
                None,
                "2026-05-18T00:01:00.000Z",
            )
            .await
            .expect("create content match");
            create_page_record(
                &db,
                "page-hidden",
                "Archived Roadmap",
                None,
                "2026-05-18T00:02:00.000Z",
            )
            .await
            .expect("create deleted match");

            update_page_content(
                &db,
                "page-content",
                "contains unique search phrase",
                "contains unique search phrase",
                "2026-05-18T00:03:00.000Z",
            )
            .await
            .expect("save searchable content");
            sqlx::query("UPDATE pages SET is_deleted = 1 WHERE id = ?")
                .bind("page-hidden")
                .execute(&db)
                .await
                .expect("hide page");

            let title_results = search_page_records("roadmap", &db)
                .await
                .expect("search by title");
            assert_eq!(title_results.len(), 1);
            assert_eq!(title_results[0].id, "page-title");
            assert_eq!(title_results[0].matched_content, None);

            let content_results = search_page_records("unique search", &db)
                .await
                .expect("search by content");
            assert_eq!(content_results.len(), 1);
            assert_eq!(content_results[0].id, "page-content");
            assert_eq!(
                content_results[0].matched_content.as_deref(),
                Some("contains unique search phrase")
            );

            let empty_results = search_page_records("   ", &db).await.expect("empty search");
            assert!(empty_results.is_empty());
        });
    }

    #[test]
    fn search_pages_uses_clean_search_text_for_content_matches() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            let blocknote_json = r#"[{"type":"paragraph","content":[{"type":"text","text":"Clean searchable phrase","styles":{}}],"children":[]}]"#;

            create_page_record(
                &db,
                "page-json",
                "JSON Note",
                None,
                "2026-05-18T00:00:00.000Z",
            )
            .await
            .expect("create page");

            update_page_content(
                &db,
                "page-json",
                blocknote_json,
                "Clean searchable phrase",
                "2026-05-18T00:01:00.000Z",
            )
            .await
            .expect("save content and search text");

            let results = search_page_records("searchable", &db)
                .await
                .expect("search content");

            assert_eq!(results.len(), 1);
            assert_eq!(
                results[0].matched_content.as_deref(),
                Some("Clean searchable phrase")
            );
        });
    }

    #[test]
    fn hard_delete_applies_to_page_tree() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;

            create_page_record(&db, "parent", "Parent", None, "2026-05-18T00:00:00.000Z")
                .await
                .expect("create parent");
            create_page_record(
                &db,
                "child",
                "Child",
                Some("parent"),
                "2026-05-18T00:01:00.000Z",
            )
            .await
            .expect("create child");
            create_page_record(&db, "sibling", "Sibling", None, "2026-05-18T00:02:00.000Z")
                .await
                .expect("create sibling");

            hard_delete_page_tree(&db, "parent")
                .await
                .expect("hard delete tree");
            assert!(get_page_record(&db, "parent")
                .await
                .expect("fetch parent")
                .is_none());
            assert!(get_page_record(&db, "child")
                .await
                .expect("fetch child")
                .is_none());
            assert!(get_page_record(&db, "sibling")
                .await
                .expect("fetch sibling")
                .is_some());
        });
    }

    #[test]
    fn move_page_reparents_and_rejects_cycles() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;

            create_page_record(&db, "parent", "Parent", None, "2026-05-18T00:00:00.000Z")
                .await
                .expect("create parent");
            create_page_record(
                &db,
                "child",
                "Child",
                Some("parent"),
                "2026-05-18T00:01:00.000Z",
            )
            .await
            .expect("create child");
            create_page_record(
                &db,
                "grandchild",
                "Grandchild",
                Some("child"),
                "2026-05-18T00:02:00.000Z",
            )
            .await
            .expect("create grandchild");
            create_page_record(&db, "target", "Target", None, "2026-05-18T00:03:00.000Z")
                .await
                .expect("create target");

            move_page_record(&db, "child", Some("target"), "2026-05-18T00:04:00.000Z")
                .await
                .expect("move child under target");
            let moved = get_page_record(&db, "child")
                .await
                .expect("fetch child")
                .expect("child exists");
            assert_eq!(moved.parent_id.as_deref(), Some("target"));

            let self_move =
                move_page_record(&db, "child", Some("child"), "2026-05-18T00:05:00.000Z")
                    .await
                    .expect_err("reject self parent");
            assert_eq!(self_move.to_string(), "page cannot be moved under itself");

            let cycle = move_page_record(
                &db,
                "target",
                Some("grandchild"),
                "2026-05-18T00:06:00.000Z",
            )
            .await
            .expect_err("reject descendant parent");
            assert_eq!(
                cycle.to_string(),
                "page cannot be moved under one of its descendants"
            );

            move_page_record(&db, "child", None, "2026-05-18T00:07:00.000Z")
                .await
                .expect("move child to root");
            let root_child = get_page_record(&db, "child")
                .await
                .expect("fetch root child")
                .expect("child exists");
            assert_eq!(root_child.parent_id, None);
        });
    }

    #[test]
    fn reorder_pages_persists_sibling_order() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;

            create_page_record(&db, "one", "One", None, "2026-05-18T00:01:00.000Z")
                .await
                .expect("create one");
            create_page_record(&db, "two", "Two", None, "2026-05-18T00:02:00.000Z")
                .await
                .expect("create two");
            create_page_record(&db, "three", "Three", None, "2026-05-18T00:03:00.000Z")
                .await
                .expect("create three");

            reorder_page_records(
                &db,
                None,
                &["three".to_string(), "one".to_string(), "two".to_string()],
                "2026-05-18T00:04:00.000Z",
            )
            .await
            .expect("reorder root pages");

            let ordered_ids: Vec<String> = list_page_records(&db)
                .await
                .expect("list pages")
                .into_iter()
                .filter(|page| page.parent_id.is_none())
                .map(|page| page.id)
                .collect();

            assert_eq!(ordered_ids, vec!["three", "one", "two"]);
        });
    }

    #[test]
    fn import_page_records_inserts_pages() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            let pages = vec![ImportedPage {
                id: "imported".to_string(),
                title: "Imported".to_string(),
                parent_id: None,
                content: Some("content".to_string()),
                search_text: Some("plain content".to_string()),
                icon: Some("I".to_string()),
                cover_url: None,
                is_deleted: 0,
                is_favorite: 1,
                is_template: Some(1),
                is_database: Some(1),
                database_schema: Some("{\"properties\":[]}".to_string()),
                properties: Some("{\"status\":\"Done\"}".to_string()),
                sort_order: Some(0),
                page_kind: None,
                created_at: "2026-05-18T00:00:00.000Z".to_string(),
                updated_at: "2026-05-18T00:00:00.000Z".to_string(),
            }];

            let count = import_page_records(&db, &pages)
                .await
                .expect("import pages");
            assert_eq!(count, 1);

            let imported = get_page_record(&db, "imported")
                .await
                .expect("fetch imported")
                .expect("imported exists");
            assert_eq!(imported.title, "Imported");
            assert_eq!(imported.search_text.as_deref(), Some("plain content"));
            assert_eq!(imported.is_favorite, 1);
            assert_eq!(imported.is_template, 1);
            assert_eq!(imported.is_database, 1);
            assert_eq!(
                imported.database_schema.as_deref(),
                Some("{\"properties\":[]}")
            );
            assert_eq!(
                imported.properties.as_deref(),
                Some("{\"status\":\"Done\"}")
            );
        });
    }

    #[test]
    fn import_page_records_rolls_back_when_any_page_fails() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_page_record(
                &db,
                "duplicate",
                "Existing",
                None,
                "2026-05-18T00:00:00.000Z",
            )
            .await
            .expect("create existing page");

            let pages = vec![
                ImportedPage {
                    id: "new-good".to_string(),
                    title: "New Good".to_string(),
                    parent_id: None,
                    content: None,
                    search_text: None,
                    icon: None,
                    cover_url: None,
                    is_deleted: 0,
                    is_favorite: 0,
                    is_template: Some(0),
                    is_database: Some(0),
                    database_schema: None,
                    properties: None,
                    sort_order: Some(0),
                    page_kind: None,
                    created_at: "2026-05-18T00:01:00.000Z".to_string(),
                    updated_at: "2026-05-18T00:01:00.000Z".to_string(),
                },
                ImportedPage {
                    id: "duplicate".to_string(),
                    title: "Duplicate".to_string(),
                    parent_id: None,
                    content: None,
                    search_text: None,
                    icon: None,
                    cover_url: None,
                    is_deleted: 0,
                    is_favorite: 0,
                    is_template: Some(0),
                    is_database: Some(0),
                    database_schema: None,
                    properties: None,
                    sort_order: Some(1),
                    page_kind: None,
                    created_at: "2026-05-18T00:02:00.000Z".to_string(),
                    updated_at: "2026-05-18T00:02:00.000Z".to_string(),
                },
            ];

            import_page_records(&db, &pages)
                .await
                .expect_err("duplicate id aborts import");

            assert!(get_page_record(&db, "new-good")
                .await
                .expect("fetch new page")
                .is_none());
        });
    }

    #[test]
    fn create_page_from_template_copies_content_and_metadata() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;

            create_page_record(
                &db,
                "template",
                "Meeting Template",
                None,
                "2026-05-18T00:00:00.000Z",
            )
            .await
            .expect("create template");
            sqlx::query(
                "UPDATE pages SET content = ?, search_text = ?, icon = ?, cover_url = ?, is_favorite = 1, is_template = 1 WHERE id = ?",
            )
            .bind("template content")
            .bind("template search")
            .bind("📄")
            .bind("asset://cover.png")
            .bind("template")
            .execute(&db)
            .await
            .expect("mark template");

            let created = create_page_from_template_record(
                &db,
                "copy",
                "template",
                Some("parent"),
                "2026-05-18T00:01:00.000Z",
            )
            .await
            .expect("create from template");

            assert_eq!(created.title, "Meeting Template");
            assert_eq!(created.parent_id.as_deref(), Some("parent"));
            assert_eq!(created.content.as_deref(), Some("template content"));
            assert_eq!(created.search_text.as_deref(), Some("template search"));
            assert_eq!(created.icon.as_deref(), Some("📄"));
            assert_eq!(created.cover_url.as_deref(), Some("asset://cover.png"));
            assert_eq!(created.is_favorite, 0);
            assert_eq!(created.is_template, 0);
        });
    }

    #[test]
    fn duplicate_page_copies_content_metadata_and_parent_only() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;

            create_page_record(
                &db,
                "source",
                "Original",
                Some("parent"),
                "2026-05-18T00:00:00.000Z",
            )
            .await
            .expect("create source");
            sqlx::query(
                "UPDATE pages SET content = ?, search_text = ?, icon = ?, cover_url = ?, is_favorite = 1, is_template = 1 WHERE id = ?",
            )
            .bind("source content")
            .bind("source search")
            .bind("📌")
            .bind("asset://cover.png")
            .bind("source")
            .execute(&db)
            .await
            .expect("prepare source");

            let duplicated =
                duplicate_page_record(&db, "copy", "source", "2026-05-18T00:01:00.000Z")
                    .await
                    .expect("duplicate page");

            assert_eq!(duplicated.title, "Copy of Original");
            assert_eq!(duplicated.parent_id.as_deref(), Some("parent"));
            assert_eq!(duplicated.content.as_deref(), Some("source content"));
            assert_eq!(duplicated.search_text.as_deref(), Some("source search"));
            assert_eq!(duplicated.icon.as_deref(), Some("📌"));
            assert_eq!(duplicated.cover_url.as_deref(), Some("asset://cover.png"));
            assert_eq!(duplicated.is_favorite, 0);
            assert_eq!(duplicated.is_template, 0);
        });
    }
}
