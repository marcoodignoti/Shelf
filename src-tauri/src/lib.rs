use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{FromRow, SqlitePool};
use std::fs::{copy, create_dir_all, metadata, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, Runtime};

const APP_SQLITE_MAX_CONNECTIONS: u32 = 2;
const COVER_IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;

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
    created_at: String,
    updated_at: String,
    matched_content: Option<String>,
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
}

async fn run_migrations(db: &SqlitePool) -> Result<(), sqlx::Error> {
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
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, ?, ?)",
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
        created_at: created_at.to_string(),
        updated_at: created_at.to_string(),
    })
}

async fn get_page_record(db: &SqlitePool, id: &str) -> Result<Option<Page>, sqlx::Error> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at
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
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at
         FROM pages
         WHERE is_deleted = 0
         ORDER BY sort_order ASC, created_at DESC",
    )
    .fetch_all(db)
    .await
}

async fn list_all_page_records(db: &SqlitePool) -> Result<Vec<Page>, sqlx::Error> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at
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
        "SELECT id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at,
                CASE
                  WHEN lower(coalesce(search_text, '')) LIKE ? THEN search_text
                  ELSE NULL
                END AS matched_content
         FROM pages
         WHERE is_deleted = 0
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

    for page in pages {
        let result = sqlx::query(
            "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        .bind(&page.created_at)
        .bind(&page.updated_at)
        .execute(db)
        .await?;

        imported_count += result.rows_affected();
    }

    Ok(imported_count)
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
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?)",
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
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?)",
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
    if header.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }

    if header.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Some("png");
    }

    if header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a") {
        return Some("gif");
    }

    if header.len() >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        return Some("webp");
    }

    None
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
    create_dir_all(&covers_dir).map_err(|error| error.to_string())?;

    validated_cover_extension(source_path, COVER_IMAGE_MAX_BYTES)?;
    let destination = cover_destination(&covers_dir, page_id, source_path)?;
    copy(source_path, &destination).map_err(|error| error.to_string())?;

    Ok(destination.to_string_lossy().to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_path = app.path().app_config_dir()?;
            create_dir_all(&app_path)?;
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
            toggle_favorite,
            toggle_template,
            create_page_from_template,
            duplicate_page,
            import_cover_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{remove_file, write};

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
