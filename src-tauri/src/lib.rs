use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{FromRow, SqlitePool};
use std::fs::create_dir_all;
use std::str::FromStr;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
    icon: Option<String>,
    cover_url: Option<String>,
    is_deleted: i64,
    is_favorite: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, FromRow, Serialize)]
struct SearchResult {
    id: String,
    title: String,
    parent_id: Option<String>,
    content: Option<String>,
    icon: Option<String>,
    cover_url: Option<String>,
    is_deleted: i64,
    is_favorite: i64,
    created_at: String,
    updated_at: String,
    matched_content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PageUpdates {
    title: Option<String>,
    parent_id: Option<String>,
    content: Option<String>,
    icon: Option<String>,
    cover_url: Option<String>,
    is_deleted: Option<i64>,
    is_favorite: Option<i64>,
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

    Ok(())
}

async fn create_page_record(
    db: &SqlitePool,
    id: &str,
    title: &str,
    parent_id: Option<&str>,
    created_at: &str,
) -> Result<Page, sqlx::Error> {
    sqlx::query(
        "INSERT INTO pages (id, title, parent_id, content, icon, cover_url, is_deleted, is_favorite, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, ?, ?)",
    )
    .bind(id)
    .bind(title)
    .bind(parent_id)
    .bind(created_at)
    .bind(created_at)
    .execute(db)
    .await?;

    Ok(Page {
        id: id.to_string(),
        title: title.to_string(),
        parent_id: parent_id.map(str::to_string),
        content: None,
        icon: None,
        cover_url: None,
        is_deleted: 0,
        is_favorite: 0,
        created_at: created_at.to_string(),
        updated_at: created_at.to_string(),
    })
}

async fn get_page_record(db: &SqlitePool, id: &str) -> Result<Option<Page>, sqlx::Error> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, icon, cover_url, is_deleted, is_favorite, created_at, updated_at
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
    updated_at: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE pages SET content = ?, updated_at = ? WHERE id = ?")
        .bind(content)
        .bind(updated_at)
        .bind(id)
        .execute(db)
        .await?;

    Ok(())
}

#[tauri::command]
async fn list_pages(state: tauri::State<'_, AppState>) -> Result<Vec<Page>, String> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, icon, cover_url, is_deleted, is_favorite, created_at, updated_at
         FROM pages
         WHERE is_deleted = 0
         ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_all_pages(state: tauri::State<'_, AppState>) -> Result<Vec<Page>, String> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, icon, cover_url, is_deleted, is_favorite, created_at, updated_at
         FROM pages
         ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn search_pages(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();

    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let pattern = format!("%{}%", trimmed.to_lowercase());

    sqlx::query_as::<_, SearchResult>(
        "SELECT id, title, parent_id, content, icon, cover_url, is_deleted, is_favorite, created_at, updated_at,
                CASE
                  WHEN lower(coalesce(content, '')) LIKE ? THEN content
                  ELSE NULL
                END AS matched_content
         FROM pages
         WHERE is_deleted = 0
           AND (lower(coalesce(title, '')) LIKE ? OR lower(coalesce(content, '')) LIKE ?)
         ORDER BY
           CASE WHEN lower(coalesce(title, '')) LIKE ? THEN 0 ELSE 1 END,
           updated_at DESC
         LIMIT 50",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .fetch_all(&state.db)
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
        update_page_content(&state.db, &id, &content, &updated_at)
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

    Ok(())
}

#[tauri::command]
async fn delete_page(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    sqlx::query(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE id = ?
            UNION ALL
            SELECT pages.id FROM pages
            JOIN descendants ON pages.parent_id = descendants.id
         )
         UPDATE pages
         SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id IN (SELECT id FROM descendants)",
    )
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn list_deleted_pages(state: tauri::State<'_, AppState>) -> Result<Vec<Page>, String> {
    sqlx::query_as::<_, Page>(
        "SELECT id, title, parent_id, content, icon, cover_url, is_deleted, is_favorite, created_at, updated_at
         FROM pages
         WHERE is_deleted = 1
         ORDER BY updated_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn restore_page(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    sqlx::query(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE id = ?
            UNION ALL
            SELECT pages.id FROM pages
            JOIN descendants ON pages.parent_id = descendants.id
         )
         UPDATE pages
         SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id IN (SELECT id FROM descendants)",
    )
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn hard_delete_page(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
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
    .execute(&state.db)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_path = app.path().app_config_dir()?;
            create_dir_all(&app_path)?;
            let db_path = app_path.join("opennotion.db");
            let db_url = format!("sqlite:{}", db_path.display());
            let options = SqliteConnectOptions::from_str(&db_url)?.create_if_missing(true);
            let db = tauri::async_runtime::block_on(async {
                let db = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect_with(options)
                    .await?;
                run_migrations(&db).await?;
                Ok::<_, sqlx::Error>(db)
            })?;

            app.manage(AppState { db });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            list_pages,
            list_all_pages,
            search_pages,
            get_page,
            create_page,
            update_page,
            delete_page,
            list_deleted_pages,
            restore_page,
            hard_delete_page,
            toggle_favorite
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");

        run_migrations(&db).await.expect("run migrations");
        db
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

            update_page_content(&db, page_id, content, "2026-05-18T00:01:00.000Z")
                .await
                .expect("save content");

            let reloaded = get_page_record(&db, page_id)
                .await
                .expect("reload page")
                .expect("page exists");
            assert_eq!(reloaded.content.as_deref(), Some(content));
        });
    }
}
