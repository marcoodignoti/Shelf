use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};
#[cfg(test)]
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;
use uuid::Uuid;

pub const AI_PROVIDER_OPENROUTER: &str = "openrouter";
pub const AI_MODEL_KIMI_FREE: &str = "moonshotai/kimi-k2.6:free";
pub const AI_MODEL_DEEPSEEK_FREE: &str = "deepseek/deepseek-v4-flash:free";
const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const OPENROUTER_CHAT_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const AI_MAX_CONTENT_BLOCKS: usize = 80;
const AI_MAX_CONTENT_BYTES: usize = 256 * 1024;
const AI_MAX_ROW_PROPERTIES_BYTES: usize = 64 * 1024;
const AI_MAX_PROPERTY_VALUE_CHARS: usize = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiSettings {
    pub provider: String,
    pub model: String,
    pub trusted_mode_enabled: bool,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiModelInfo {
    pub id: String,
    pub label: String,
    pub context_length: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiSettingsUpdate {
    pub provider: String,
    pub model: String,
    pub trusted_mode_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiPlanRequest {
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub current_page_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiActionPlan {
    pub version: i64,
    pub summary: String,
    pub requires_confirmation: bool,
    pub actions: Vec<AiAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(clippy::enum_variant_names)]
#[serde(tag = "type")]
pub enum AiAction {
    #[serde(rename = "create_page")]
    CreatePage {
        title: String,
        parent_id: Option<String>,
        content_blocks: Option<serde_json::Value>,
    },
    #[serde(rename = "create_subpages")]
    CreateSubpages {
        parent_id: String,
        pages: Vec<AiSubpage>,
    },
    #[serde(rename = "create_database")]
    CreateDatabase {
        title: String,
        parent_id: Option<String>,
        properties: Vec<AiDatabaseProperty>,
        starter_rows: Option<Vec<AiDatabaseRow>>,
    },
    #[serde(rename = "create_database_rows")]
    CreateDatabaseRows {
        database_page_id: String,
        rows: Vec<AiDatabaseRow>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiSubpage {
    pub title: String,
    pub content_blocks: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiDatabaseProperty {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub property_type: String,
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiDatabaseRow {
    pub title: String,
    pub properties: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiApplyResult {
    pub created_page_ids: Vec<String>,
    pub updated_page_ids: Vec<String>,
    pub primary_page_id: Option<String>,
}

pub trait SecretStore: Send + Sync {
    fn set_secret(&self, provider: &str, value: &str) -> Result<(), String>;
    fn get_secret(&self, provider: &str) -> Result<Option<String>, String>;
    fn delete_secret(&self, provider: &str) -> Result<(), String>;
}

#[cfg(test)]
#[derive(Default)]
pub struct MemorySecretStore {
    secrets: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn set_secret(&self, provider: &str, value: &str) -> Result<(), String> {
        self.secrets
            .lock()
            .map_err(|_| "secret store locked".to_string())?
            .insert(provider.to_string(), value.to_string());
        Ok(())
    }

    fn get_secret(&self, provider: &str) -> Result<Option<String>, String> {
        Ok(self
            .secrets
            .lock()
            .map_err(|_| "secret store locked".to_string())?
            .get(provider)
            .cloned())
    }

    fn delete_secret(&self, provider: &str) -> Result<(), String> {
        self.secrets
            .lock()
            .map_err(|_| "secret store locked".to_string())?
            .remove(provider);
        Ok(())
    }
}

pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn set_secret(&self, provider: &str, value: &str) -> Result<(), String> {
        let entry =
            keyring::Entry::new("OpenNotion AI", provider).map_err(|error| error.to_string())?;
        entry.set_password(value).map_err(|error| error.to_string())
    }

    fn get_secret(&self, provider: &str) -> Result<Option<String>, String> {
        let entry =
            keyring::Entry::new("OpenNotion AI", provider).map_err(|error| error.to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn delete_secret(&self, provider: &str) -> Result<(), String> {
        let entry =
            keyring::Entry::new("OpenNotion AI", provider).map_err(|error| error.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[derive(Clone)]
pub struct AiRuntime {
    pub secret_store: Arc<dyn SecretStore>,
}

pub fn is_allowed_model(model: &str) -> bool {
    matches!(model, AI_MODEL_KIMI_FREE | AI_MODEL_DEEPSEEK_FREE)
        || (is_safe_openrouter_model_id(model) && model.ends_with(":free"))
}

pub fn validate_provider_model(provider: &str, model: &str) -> Result<(), String> {
    if provider != AI_PROVIDER_OPENROUTER {
        return Err("Unsupported AI provider".to_string());
    }

    if !is_allowed_model(model) {
        return Err("Unsupported AI model".to_string());
    }

    Ok(())
}

pub fn fallback_ai_models() -> Vec<AiModelInfo> {
    vec![
        AiModelInfo {
            id: AI_MODEL_KIMI_FREE.to_string(),
            label: "Kimi K2.6 Free".to_string(),
            context_length: None,
        },
        AiModelInfo {
            id: AI_MODEL_DEEPSEEK_FREE.to_string(),
            label: "DeepSeek V4 Flash Free".to_string(),
            context_length: None,
        },
    ]
}

pub async fn migrate_ai_settings(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ai_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            trusted_mode_enabled INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );",
    )
    .execute(db)
    .await?;

    sqlx::query(
        "INSERT INTO ai_settings (id, provider, model, trusted_mode_enabled, updated_at)
         VALUES (1, ?, ?, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(AI_PROVIDER_OPENROUTER)
    .bind(AI_MODEL_KIMI_FREE)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn read_ai_settings(db: &SqlitePool, runtime: &AiRuntime) -> Result<AiSettings, String> {
    let row: (String, String, i64) = sqlx::query_as(
        "SELECT provider, model, trusted_mode_enabled FROM ai_settings WHERE id = 1",
    )
    .fetch_one(db)
    .await
    .map_err(|error| error.to_string())?;

    validate_provider_model(&row.0, &row.1)?;
    let has_api_key = runtime.secret_store.get_secret(&row.0)?.is_some();

    Ok(AiSettings {
        provider: row.0,
        model: row.1,
        trusted_mode_enabled: row.2 == 1,
        has_api_key,
    })
}

pub async fn update_ai_settings_record(
    db: &SqlitePool,
    runtime: &AiRuntime,
    settings: AiSettingsUpdate,
) -> Result<AiSettings, String> {
    validate_provider_model(&settings.provider, &settings.model)?;
    sqlx::query(
        "UPDATE ai_settings
         SET provider = ?, model = ?, trusted_mode_enabled = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = 1",
    )
    .bind(&settings.provider)
    .bind(&settings.model)
    .bind(if settings.trusted_mode_enabled { 1 } else { 0 })
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;

    read_ai_settings(db, runtime).await
}

fn normalize_ai_json_response(raw: &str) -> &str {
    let trimmed = raw.trim();
    if !trimmed.starts_with("```") {
        return trimmed;
    }

    let without_opening_ticks = &trimmed[3..];
    let Some(opening_line_end) = without_opening_ticks.find('\n') else {
        return trimmed;
    };
    let fenced_body = &without_opening_ticks[opening_line_end + 1..];
    let Some(closing_ticks_start) = fenced_body.rfind("```") else {
        return trimmed;
    };

    fenced_body[..closing_ticks_start].trim()
}

pub fn parse_ai_action_plan(raw: &str) -> Result<AiActionPlan, String> {
    let raw = normalize_ai_json_response(raw);
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "AI returned invalid JSON".to_string())?;

    if let Some(actions) = value.get("actions").and_then(|value| value.as_array()) {
        for action in actions {
            let action_type = action
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if !matches!(
                action_type,
                "create_page" | "create_subpages" | "create_database" | "create_database_rows"
            ) {
                return Err(format!("Unsupported AI action type: {}", action_type));
            }
        }
    }

    let plan: AiActionPlan =
        serde_json::from_value(value).map_err(|error| format!("Invalid AI plan: {}", error))?;
    validate_ai_action_plan(&plan)?;
    Ok(plan)
}

pub fn validate_ai_action_plan(plan: &AiActionPlan) -> Result<(), String> {
    if plan.version != 1 {
        return Err("Unsupported AI plan version".to_string());
    }

    if plan.summary.trim().is_empty() {
        return Err("AI plan summary cannot be empty".to_string());
    }

    if plan.actions.is_empty() {
        return Err("AI plan has no actions".to_string());
    }

    if plan.actions.len() > 12 {
        return Err("AI plan has too many actions".to_string());
    }

    for action in &plan.actions {
        match action {
            AiAction::CreatePage {
                title,
                content_blocks,
                ..
            } => {
                validate_title(title)?;
                validate_content_blocks(content_blocks.as_ref())?;
            }
            AiAction::CreateSubpages { parent_id, pages } => {
                validate_id(parent_id)?;
                if pages.len() > 12 {
                    return Err("AI plan has too many subpages".to_string());
                }
                for page in pages {
                    validate_title(&page.title)?;
                    validate_content_blocks(page.content_blocks.as_ref())?;
                }
            }
            AiAction::CreateDatabase {
                title,
                properties,
                starter_rows,
                ..
            } => {
                validate_title(title)?;
                validate_database_properties(properties)?;
                if starter_rows.as_ref().map_or(0, Vec::len) > 50 {
                    return Err("AI plan has too many rows".to_string());
                }
                for row in starter_rows.as_deref().unwrap_or(&[]) {
                    validate_title(&row.title)?;
                    validate_row_properties(row.properties.as_ref())?;
                }
            }
            AiAction::CreateDatabaseRows {
                database_page_id,
                rows,
            } => {
                validate_id(database_page_id)?;
                if rows.len() > 50 {
                    return Err("AI plan has too many rows".to_string());
                }
                for row in rows {
                    validate_title(&row.title)?;
                    validate_row_properties(row.properties.as_ref())?;
                }
            }
        }
    }

    Ok(())
}

fn validate_title(title: &str) -> Result<(), String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("AI action title cannot be empty".to_string());
    }
    if trimmed.chars().count() > 120 {
        return Err("AI action title is too long".to_string());
    }
    Ok(())
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.chars().count() > 512 {
        return Err("AI action id is invalid".to_string());
    }
    Ok(())
}

fn validate_content_blocks(value: Option<&serde_json::Value>) -> Result<(), String> {
    if let Some(value) = value {
        let Some(blocks) = value.as_array() else {
            return Err("AI content blocks must be an array".to_string());
        };
        if blocks.len() > AI_MAX_CONTENT_BLOCKS {
            return Err("AI content blocks are too large".to_string());
        }
        let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        if bytes.len() > AI_MAX_CONTENT_BYTES {
            return Err("AI content blocks are too large".to_string());
        }
    }
    Ok(())
}

fn validate_row_properties(value: Option<&serde_json::Value>) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let Some(properties) = value.as_object() else {
        return Err("AI row properties must be an object".to_string());
    };
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.len() > AI_MAX_ROW_PROPERTIES_BYTES {
        return Err("AI row properties are too large".to_string());
    }

    for (key, value) in properties {
        validate_id(key)?;
        match value {
            serde_json::Value::String(text) => {
                if text.chars().count() > AI_MAX_PROPERTY_VALUE_CHARS {
                    return Err("AI row property value is too long".to_string());
                }
            }
            serde_json::Value::Bool(_) | serde_json::Value::Null => {}
            _ => return Err("AI row property value is invalid".to_string()),
        }
    }

    Ok(())
}

fn validate_database_properties(properties: &[AiDatabaseProperty]) -> Result<(), String> {
    if properties.is_empty() || properties.len() > 20 {
        return Err("AI database property count is invalid".to_string());
    }

    for property in properties {
        validate_id(&property.id)?;
        validate_title(&property.name)?;
        if !matches!(
            property.property_type.as_str(),
            "text" | "checkbox" | "select" | "date"
        ) {
            return Err("AI database property type is invalid".to_string());
        }
        if property.property_type == "select" && property.options.as_ref().is_none_or(Vec::is_empty)
        {
            return Err("AI select properties need options".to_string());
        }
    }

    Ok(())
}

async fn ensure_ai_parent_exists(
    tx: &mut Transaction<'_, Sqlite>,
    parent_id: Option<&str>,
) -> Result<(), String> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM pages
         WHERE id = ?
           AND is_deleted = 0",
    )
    .bind(parent_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    if count == 0 {
        return Err("AI parent page not found".to_string());
    }

    Ok(())
}

async fn ensure_ai_database_exists(
    tx: &mut Transaction<'_, Sqlite>,
    database_page_id: &str,
) -> Result<(), String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM pages
         WHERE id = ?
           AND is_deleted = 0
           AND is_database = 1",
    )
    .bind(database_page_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    if count == 0 {
        return Err("AI target database not found".to_string());
    }

    Ok(())
}

pub async fn apply_ai_action_plan_to_db(
    db: &SqlitePool,
    plan: AiActionPlan,
    now: &str,
) -> Result<AiApplyResult, String> {
    validate_ai_action_plan(&plan)?;
    let mut tx = db.begin().await.map_err(|error| error.to_string())?;
    let mut created_page_ids = Vec::new();

    for action in plan.actions {
        match action {
            AiAction::CreatePage {
                title,
                parent_id,
                content_blocks,
            } => {
                let id = Uuid::new_v4().to_string();
                insert_ai_page(
                    &mut tx,
                    InsertAiPageRecord {
                        id: &id,
                        title: &title,
                        parent_id: parent_id.as_deref(),
                        content_blocks,
                        is_database: false,
                        database_schema: None,
                        properties: None,
                        now,
                    },
                )
                .await?;
                created_page_ids.push(id);
            }
            AiAction::CreateSubpages { parent_id, pages } => {
                for page in pages {
                    let id = Uuid::new_v4().to_string();
                    insert_ai_page(
                        &mut tx,
                        InsertAiPageRecord {
                            id: &id,
                            title: &page.title,
                            parent_id: Some(&parent_id),
                            content_blocks: page.content_blocks,
                            is_database: false,
                            database_schema: None,
                            properties: None,
                            now,
                        },
                    )
                    .await?;
                    created_page_ids.push(id);
                }
            }
            AiAction::CreateDatabase {
                title,
                parent_id,
                properties,
                starter_rows,
            } => {
                let database_id = Uuid::new_v4().to_string();
                let schema = serde_json::json!({ "properties": properties }).to_string();
                insert_ai_page(
                    &mut tx,
                    InsertAiPageRecord {
                        id: &database_id,
                        title: &title,
                        parent_id: parent_id.as_deref(),
                        content_blocks: None,
                        is_database: true,
                        database_schema: Some(schema),
                        properties: None,
                        now,
                    },
                )
                .await?;
                created_page_ids.push(database_id.clone());

                for row in starter_rows.unwrap_or_default() {
                    let row_id = Uuid::new_v4().to_string();
                    insert_ai_page(
                        &mut tx,
                        InsertAiPageRecord {
                            id: &row_id,
                            title: &row.title,
                            parent_id: Some(&database_id),
                            content_blocks: None,
                            is_database: false,
                            database_schema: None,
                            properties: row.properties.map(|value| value.to_string()),
                            now,
                        },
                    )
                    .await?;
                    created_page_ids.push(row_id);
                }
            }
            AiAction::CreateDatabaseRows {
                database_page_id,
                rows,
            } => {
                ensure_ai_database_exists(&mut tx, &database_page_id).await?;
                for row in rows {
                    let row_id = Uuid::new_v4().to_string();
                    insert_ai_page(
                        &mut tx,
                        InsertAiPageRecord {
                            id: &row_id,
                            title: &row.title,
                            parent_id: Some(&database_page_id),
                            content_blocks: None,
                            is_database: false,
                            database_schema: None,
                            properties: row.properties.map(|value| value.to_string()),
                            now,
                        },
                    )
                    .await?;
                    created_page_ids.push(row_id);
                }
            }
        }
    }

    tx.commit().await.map_err(|error| error.to_string())?;
    let primary_page_id = created_page_ids.first().cloned();
    Ok(AiApplyResult {
        created_page_ids,
        updated_page_ids: Vec::new(),
        primary_page_id,
    })
}

/// Extract plain, searchable text from a BlockNote-style content-block array.
/// Mirrors the frontend `pageContentToSearchText` so AI pages index plain text
/// instead of raw JSON.
fn search_text_from_content_blocks(value: &serde_json::Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(blocks) = value.as_array() {
        for block in blocks {
            collect_block_text(block, &mut parts);
        }
    }
    parts
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn collect_block_text(block: &serde_json::Value, parts: &mut Vec<String>) {
    let serde_json::Value::Object(record) = block else {
        return;
    };

    if let Some(content) = record.get("content") {
        let inline = inline_block_text(content);
        if !inline.is_empty() {
            parts.push(inline);
        }
        collect_table_text(content, parts);
    }

    if record.get("type").and_then(serde_json::Value::as_str) == Some("formula") {
        if let Some(formula) = record
            .get("props")
            .and_then(|props| props.get("formula"))
            .and_then(serde_json::Value::as_str)
        {
            if !formula.is_empty() {
                parts.push(formula.to_string());
            }
        }
    }

    if let Some(children) = record.get("children").and_then(serde_json::Value::as_array) {
        for child in children {
            collect_block_text(child, parts);
        }
    }
}

fn inline_block_text(content: &serde_json::Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }

    let Some(items) = content.as_array() else {
        return String::new();
    };

    items
        .iter()
        .filter_map(|item| {
            if let Some(text) = item.as_str() {
                return Some(text.to_string());
            }
            let object = item.as_object()?;
            if let Some(text) = object.get("text").and_then(serde_json::Value::as_str) {
                return Some(text.to_string());
            }
            if object.get("type").and_then(serde_json::Value::as_str) == Some("math") {
                return object
                    .get("props")
                    .and_then(|props| props.get("formula"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
            }
            None
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn collect_table_text(content: &serde_json::Value, parts: &mut Vec<String>) {
    let Some(object) = content.as_object() else {
        return;
    };
    if object.get("type").and_then(serde_json::Value::as_str) != Some("tableContent") {
        return;
    }
    let Some(rows) = object.get("rows").and_then(serde_json::Value::as_array) else {
        return;
    };

    for row in rows {
        let Some(cells) = row.get("cells").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for cell in cells {
            let text = if cell.is_string() || cell.is_array() {
                inline_block_text(cell)
            } else {
                cell.get("content")
                    .map(inline_block_text)
                    .unwrap_or_default()
            };
            if !text.is_empty() {
                parts.push(text);
            }
        }
    }
}

struct InsertAiPageRecord<'a> {
    id: &'a str,
    title: &'a str,
    parent_id: Option<&'a str>,
    content_blocks: Option<serde_json::Value>,
    is_database: bool,
    database_schema: Option<String>,
    properties: Option<String>,
    now: &'a str,
}

async fn insert_ai_page(
    tx: &mut Transaction<'_, Sqlite>,
    record: InsertAiPageRecord<'_>,
) -> Result<(), String> {
    ensure_ai_parent_exists(tx, record.parent_id).await?;

    let search_text = record
        .content_blocks
        .as_ref()
        .map(search_text_from_content_blocks)
        .filter(|text| !text.is_empty());
    let content = record.content_blocks.map(|value| value.to_string());
    let sort_order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MIN(sort_order), 0) - 1
         FROM pages
         WHERE is_deleted = 0
           AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)",
    )
    .bind(record.parent_id)
    .bind(record.parent_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)",
    )
    .bind(record.id)
    .bind(record.title.trim())
    .bind(record.parent_id)
    .bind(&content)
    .bind(&search_text)
    .bind(if record.is_database { 1 } else { 0 })
    .bind(record.database_schema)
    .bind(record.properties)
    .bind(sort_order)
    .bind(record.now)
    .bind(record.now)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn build_openrouter_request_body(
    model: &str,
    prompt: &str,
    context: Option<&str>,
    structured_json: bool,
) -> serde_json::Value {
    let system_prompt = r#"You create OpenNotion workspace structures.
Return only valid JSON. No markdown fences, no prose.
Schema:
{
  "version": 1,
  "summary": "short user-facing summary",
  "requires_confirmation": true,
  "actions": [
    {"type":"create_page","title":"Page title","parent_id":null,"content_blocks":[]},
    {"type":"create_subpages","parent_id":"existing-page-id","pages":[{"title":"Subpage title","content_blocks":[]}]},
    {"type":"create_database","title":"Database title","parent_id":null,"properties":[{"id":"status","name":"Status","type":"select","options":["Todo","Done"]}],"starter_rows":[{"title":"First row","properties":{"status":"Todo"}}]},
    {"type":"create_database_rows","database_page_id":"existing-database-id","rows":[{"title":"Row title","properties":{"done":false}}]}
  ]
}
Allowed actions only: create_page, create_subpages, create_database, create_database_rows.
Allowed property types only: text, checkbox, select, date.
Never delete, rename, overwrite, move, or modify existing content.
Use content_blocks as a BlockNote-style JSON array. Keep content concise.
Set requires_confirmation true unless the request is clearly low-risk create-only."#;

    let mut body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": format!("Context:\n{}\n\nRequest:\n{}", context.unwrap_or("No page context."), prompt)
            }
        ],
        "temperature": 0.2
    });

    if structured_json {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }

    body
}

#[derive(Debug)]
struct OpenRouterRequestError {
    status: reqwest::StatusCode,
    message: String,
}

impl fmt::Display for OpenRouterRequestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "AI provider returned {}: {}",
            self.status, self.message
        )
    }
}

fn truncate_provider_error(message: &str) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(500).collect()
}

fn summarize_openrouter_error(raw: &str) -> String {
    let parsed = serde_json::from_str::<serde_json::Value>(raw).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(|error| error.get("message").or_else(|| error.get("metadata")))
        .and_then(|value| value.as_str())
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("message"))
                .and_then(|value| value.as_str())
        })
        .unwrap_or(raw);

    truncate_provider_error(message)
}

fn should_retry_without_response_format(error: &OpenRouterRequestError) -> bool {
    matches!(
        error.status,
        reqwest::StatusCode::BAD_REQUEST | reqwest::StatusCode::UNPROCESSABLE_ENTITY
    ) && {
        let message = error.message.to_lowercase();
        message.contains("response_format")
            || message.contains("json_object")
            || message.contains("structured")
    }
}

async fn send_openrouter_chat_request(
    client: &reqwest::Client,
    api_key: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, OpenRouterRequestError> {
    let response = client
        .post(OPENROUTER_CHAT_URL)
        .bearer_auth(api_key)
        .header("HTTP-Referer", "https://opennotion.local")
        .header("X-Title", "OpenNotion")
        .json(&body)
        .send()
        .await
        .map_err(|error| OpenRouterRequestError {
            status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("AI request failed: {}", error),
        })?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|error| OpenRouterRequestError {
            status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("AI response was invalid: {}", error),
        })?;

    if !status.is_success() {
        return Err(OpenRouterRequestError {
            status,
            message: summarize_openrouter_error(&body_text),
        });
    }

    serde_json::from_str::<serde_json::Value>(&body_text).map_err(|error| OpenRouterRequestError {
        status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("AI response was invalid: {}", error),
    })
}

#[derive(Debug, Deserialize)]
struct OpenRouterModelsResponse {
    data: Vec<OpenRouterModel>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterModel {
    id: String,
    name: Option<String>,
    context_length: Option<i64>,
    pricing: Option<OpenRouterPricing>,
    architecture: Option<OpenRouterArchitecture>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterArchitecture {
    input_modalities: Option<Vec<String>>,
    output_modalities: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterPricing {
    prompt: Option<String>,
    completion: Option<String>,
    request: Option<String>,
    image: Option<String>,
}

fn is_safe_openrouter_model_id(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 200
        && model.contains('/')
        && !model.contains("..")
        && !model.starts_with('/')
        && !model.ends_with('/')
        && model
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '-' | '_' | '.' | ':'))
}

fn is_zero_pricing_value(value: Option<&str>) -> bool {
    value
        .and_then(|value| value.parse::<f64>().ok())
        .is_some_and(|parsed| parsed == 0.0)
}

fn is_free_pricing(pricing: Option<&OpenRouterPricing>) -> bool {
    let Some(pricing) = pricing else {
        return false;
    };

    is_zero_pricing_value(pricing.prompt.as_deref())
        && is_zero_pricing_value(pricing.completion.as_deref())
        && pricing
            .request
            .as_deref()
            .is_none_or(|value| is_zero_pricing_value(Some(value)))
        && pricing
            .image
            .as_deref()
            .is_none_or(|value| is_zero_pricing_value(Some(value)))
}

fn supports_text_chat(architecture: Option<&OpenRouterArchitecture>) -> bool {
    let Some(architecture) = architecture else {
        return true;
    };

    let input_ok = architecture
        .input_modalities
        .as_ref()
        .is_none_or(|modalities| modalities.iter().any(|modality| modality == "text"));
    let output_ok = architecture
        .output_modalities
        .as_ref()
        .is_none_or(|modalities| modalities.iter().any(|modality| modality == "text"));

    input_ok && output_ok
}

fn openrouter_model_label(id: &str, name: Option<&str>) -> String {
    if let Some(name) = name {
        let trimmed = name.trim();
        if !trimmed.is_empty() && trimmed.len() <= 120 {
            return trimmed.to_string();
        }
    }

    id.split('/')
        .next_back()
        .unwrap_or(id)
        .replace(":free", " Free")
        .replace('-', " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn free_openrouter_models_from_payload(payload: OpenRouterModelsResponse) -> Vec<AiModelInfo> {
    let mut models = payload
        .data
        .into_iter()
        .filter(|model| {
            is_safe_openrouter_model_id(&model.id)
                && (model.id.ends_with(":free") || is_free_pricing(model.pricing.as_ref()))
                && supports_text_chat(model.architecture.as_ref())
        })
        .map(|model| AiModelInfo {
            label: openrouter_model_label(&model.id, model.name.as_deref()),
            id: model.id,
            context_length: model.context_length,
        })
        .collect::<Vec<_>>();

    models.sort_by(|first, second| {
        let first_rank = match first.id.as_str() {
            AI_MODEL_KIMI_FREE => 0,
            AI_MODEL_DEEPSEEK_FREE => 1,
            _ => 2,
        };
        let second_rank = match second.id.as_str() {
            AI_MODEL_KIMI_FREE => 0,
            AI_MODEL_DEEPSEEK_FREE => 1,
            _ => 2,
        };
        first_rank
            .cmp(&second_rank)
            .then_with(|| first.label.to_lowercase().cmp(&second.label.to_lowercase()))
            .then_with(|| first.id.cmp(&second.id))
    });
    models.dedup_by(|first, second| first.id == second.id);

    if models.is_empty() {
        fallback_ai_models()
    } else {
        models
    }
}

pub async fn list_openrouter_models(runtime: &AiRuntime) -> Result<Vec<AiModelInfo>, String> {
    let client = reqwest::Client::new();
    let mut request = client
        .get(OPENROUTER_MODELS_URL)
        .header("HTTP-Referer", "https://opennotion.local")
        .header("X-Title", "OpenNotion");

    if let Some(api_key) = runtime.secret_store.get_secret(AI_PROVIDER_OPENROUTER)? {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("AI model list failed: {}", error))?;

    if !response.status().is_success() {
        return Err(format!("AI provider returned {}", response.status()));
    }

    let payload = response
        .json::<OpenRouterModelsResponse>()
        .await
        .map_err(|error| format!("AI model list was invalid: {}", error))?;

    Ok(free_openrouter_models_from_payload(payload))
}

pub async fn generate_openrouter_plan(
    runtime: &AiRuntime,
    request: AiPlanRequest,
    context: Option<String>,
) -> Result<AiActionPlan, String> {
    validate_provider_model(&request.provider, &request.model)?;
    let api_key = runtime
        .secret_store
        .get_secret(&request.provider)?
        .ok_or_else(|| "Missing AI API key".to_string())?;

    let client = reqwest::Client::new();
    let structured_body =
        build_openrouter_request_body(&request.model, &request.prompt, context.as_deref(), true);
    let payload = match send_openrouter_chat_request(&client, &api_key, structured_body).await {
        Ok(payload) => payload,
        Err(error) if should_retry_without_response_format(&error) => {
            let plain_json_body = build_openrouter_request_body(
                &request.model,
                &request.prompt,
                context.as_deref(),
                false,
            );
            send_openrouter_chat_request(&client, &api_key, plain_json_body)
                .await
                .map_err(|retry_error| retry_error.to_string())?
        }
        Err(error) => return Err(error.to_string()),
    };

    let content = payload
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .ok_or_else(|| "AI response did not include content".to_string())?;

    parse_ai_action_plan(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("db");
        migrate_ai_settings(&db).await.expect("migrate ai");
        db
    }

    async fn create_pages_table(db: &SqlitePool) {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS pages (
                id TEXT PRIMARY KEY,
                title TEXT,
                parent_id TEXT,
                content TEXT,
                search_text TEXT,
                icon TEXT,
                cover_url TEXT,
                is_deleted INTEGER DEFAULT 0,
                is_favorite INTEGER DEFAULT 0,
                is_template INTEGER DEFAULT 0,
                is_database INTEGER DEFAULT 0,
                database_schema TEXT,
                properties TEXT,
                sort_order INTEGER DEFAULT 0,
                page_kind TEXT DEFAULT 'note',
                created_at TEXT,
                updated_at TEXT
            );",
        )
        .execute(db)
        .await
        .expect("pages table");
    }

    async fn insert_test_page(db: &SqlitePool, id: &str, is_database: i64) {
        sqlx::query(
            "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
             VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, ?, NULL, NULL, 0, 'note', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z')",
        )
        .bind(id)
        .bind(id)
        .bind(is_database)
        .execute(db)
        .await
        .expect("insert test page");
    }

    #[test]
    fn only_free_openrouter_models_are_allowed() {
        assert!(is_allowed_model(AI_MODEL_KIMI_FREE));
        assert!(is_allowed_model(AI_MODEL_DEEPSEEK_FREE));
        assert!(is_allowed_model("qwen/qwen3-235b-a22b:free"));
        assert!(!is_allowed_model("openai/gpt-5"));
        assert!(!is_allowed_model("../bad:free"));
    }

    #[test]
    fn rejects_unknown_provider() {
        assert_eq!(
            validate_provider_model("openai", AI_MODEL_KIMI_FREE),
            Err("Unsupported AI provider".to_string())
        );
    }

    #[test]
    fn memory_secret_store_round_trips_key() {
        let store = MemorySecretStore::default();
        store
            .set_secret(AI_PROVIDER_OPENROUTER, "sk-or-test")
            .expect("save");
        assert_eq!(
            store.get_secret(AI_PROVIDER_OPENROUTER).expect("read"),
            Some("sk-or-test".to_string())
        );
        store.delete_secret(AI_PROVIDER_OPENROUTER).expect("delete");
        assert_eq!(
            store.get_secret(AI_PROVIDER_OPENROUTER).expect("read"),
            None
        );
    }

    #[test]
    fn extracts_free_openrouter_models_from_payload() {
        let payload = OpenRouterModelsResponse {
            data: vec![
                OpenRouterModel {
                    id: "openai/gpt-5".to_string(),
                    name: Some("GPT 5".to_string()),
                    context_length: Some(200_000),
                    architecture: None,
                    pricing: Some(OpenRouterPricing {
                        prompt: Some("0.000001".to_string()),
                        completion: Some("0.000001".to_string()),
                        request: None,
                        image: None,
                    }),
                },
                OpenRouterModel {
                    id: "qwen/qwen3-235b-a22b:free".to_string(),
                    name: Some("Qwen3 Free".to_string()),
                    context_length: Some(40_960),
                    architecture: Some(OpenRouterArchitecture {
                        input_modalities: Some(vec!["text".to_string()]),
                        output_modalities: Some(vec!["text".to_string()]),
                    }),
                    pricing: Some(OpenRouterPricing {
                        prompt: Some("0".to_string()),
                        completion: Some("0".to_string()),
                        request: Some("0".to_string()),
                        image: None,
                    }),
                },
            ],
        };

        let models = free_openrouter_models_from_payload(payload);

        assert_eq!(
            models,
            vec![AiModelInfo {
                id: "qwen/qwen3-235b-a22b:free".to_string(),
                label: "Qwen3 Free".to_string(),
                context_length: Some(40_960),
            }]
        );
    }

    #[test]
    fn excludes_non_text_openrouter_models() {
        let payload = OpenRouterModelsResponse {
            data: vec![
                OpenRouterModel {
                    id: "vendor/audio-only:free".to_string(),
                    name: Some("Audio Only".to_string()),
                    context_length: Some(8_192),
                    architecture: Some(OpenRouterArchitecture {
                        input_modalities: Some(vec!["audio".to_string()]),
                        output_modalities: Some(vec!["text".to_string()]),
                    }),
                    pricing: Some(OpenRouterPricing {
                        prompt: Some("0".to_string()),
                        completion: Some("0".to_string()),
                        request: None,
                        image: None,
                    }),
                },
                OpenRouterModel {
                    id: "vendor/text-good:free".to_string(),
                    name: Some("Text Good".to_string()),
                    context_length: Some(8_192),
                    architecture: Some(OpenRouterArchitecture {
                        input_modalities: Some(vec!["text".to_string()]),
                        output_modalities: Some(vec!["text".to_string()]),
                    }),
                    pricing: Some(OpenRouterPricing {
                        prompt: Some("0".to_string()),
                        completion: Some("0".to_string()),
                        request: None,
                        image: None,
                    }),
                },
            ],
        };

        let models = free_openrouter_models_from_payload(payload);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "vendor/text-good:free");
    }

    #[test]
    fn settings_persist_without_api_key() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            let runtime = AiRuntime {
                secret_store: Arc::new(MemorySecretStore::default()),
            };
            let settings = read_ai_settings(&db, &runtime).await.expect("settings");

            assert_eq!(settings.provider, AI_PROVIDER_OPENROUTER);
            assert_eq!(settings.model, AI_MODEL_KIMI_FREE);
            assert!(!settings.trusted_mode_enabled);
            assert!(!settings.has_api_key);
        });
    }

    #[test]
    fn rejects_unknown_ai_action_type() {
        let raw = r#"{"version":1,"summary":"bad","requires_confirmation":true,"actions":[{"type":"delete_page","id":"x"}]}"#;
        assert_eq!(
            parse_ai_action_plan(raw),
            Err("Unsupported AI action type: delete_page".to_string())
        );
    }

    #[test]
    fn accepts_create_database_plan() {
        let raw = r#"{
          "version": 1,
          "summary": "Create tracker",
          "requires_confirmation": true,
          "actions": [{
            "type": "create_database",
            "title": "Exams",
            "properties": [{"id":"status","name":"Status","type":"select","options":["Todo","Done"]}],
            "starter_rows": [{"title":"Physics","properties":{"status":"Todo"}}]
          }]
        }"#;

        let plan = parse_ai_action_plan(raw).expect("valid plan");
        assert_eq!(plan.actions.len(), 1);
    }

    #[test]
    fn rejects_large_content_blocks_and_invalid_row_properties() {
        let oversized_blocks = serde_json::json!(
            (0..(AI_MAX_CONTENT_BLOCKS + 1))
                .map(|index| serde_json::json!({"type":"paragraph","content":[{"type":"text","text":format!("Block {}", index),"styles":{}}]}))
                .collect::<Vec<_>>()
        );
        let oversized_plan = AiActionPlan {
            version: 1,
            summary: "Too much".to_string(),
            requires_confirmation: true,
            actions: vec![AiAction::CreatePage {
                title: "Large".to_string(),
                parent_id: None,
                content_blocks: Some(oversized_blocks),
            }],
        };

        assert_eq!(
            validate_ai_action_plan(&oversized_plan),
            Err("AI content blocks are too large".to_string())
        );

        let invalid_row_plan = AiActionPlan {
            version: 1,
            summary: "Bad row".to_string(),
            requires_confirmation: true,
            actions: vec![AiAction::CreateDatabase {
                title: "Tracker".to_string(),
                parent_id: None,
                properties: vec![AiDatabaseProperty {
                    id: "done".to_string(),
                    name: "Done".to_string(),
                    property_type: "checkbox".to_string(),
                    options: None,
                }],
                starter_rows: Some(vec![AiDatabaseRow {
                    title: "Row".to_string(),
                    properties: Some(serde_json::json!({ "done": { "bad": true } })),
                }]),
            }],
        };

        assert_eq!(
            validate_ai_action_plan(&invalid_row_plan),
            Err("AI row property value is invalid".to_string())
        );
    }

    #[test]
    fn accepts_fenced_json_plan_from_ai_response() {
        let raw = r#"```json
        {
          "version": 1,
          "summary": "Create study page",
          "requires_confirmation": true,
          "actions": [{"type":"create_page","title":"Study Plan"}]
        }
        ```"#;

        let plan = parse_ai_action_plan(raw).expect("valid fenced plan");

        assert_eq!(plan.summary, "Create study page");
        assert_eq!(plan.actions.len(), 1);
    }

    #[test]
    fn extracts_plain_search_text_from_content_blocks() {
        let blocks = serde_json::json!([
            {"type":"heading","content":[{"type":"text","text":"Gauss law","styles":{}}]},
            {"type":"paragraph","content":[
                {"type":"text","text":"Flux is","styles":{}},
                {"type":"math","props":{"formula":"E=mc^2"}}
            ]},
            {"type":"formula","props":{"formula":"\\nabla \\cdot E"}},
            {"type":"table","content":{"type":"tableContent","rows":[
                {"cells":[{"type":"tableCell","content":[{"type":"text","text":"Cell A","styles":{}}]}]}
            ]}}
        ]);

        let text = search_text_from_content_blocks(&blocks);

        assert_eq!(text, "Gauss law Flux is E=mc^2 \\nabla \\cdot E Cell A");
        assert!(!text.contains("paragraph"));
        assert!(!text.contains("styles"));
    }

    #[test]
    fn create_page_stores_plain_text_search_index_not_json() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_pages_table(&db).await;

            let plan = parse_ai_action_plan(
                r#"{"version":1,"summary":"Add notes","requires_confirmation":true,"actions":[{"type":"create_page","title":"Notes","content_blocks":[{"type":"paragraph","content":[{"type":"text","text":"Hello world","styles":{}}]}]}]}"#,
            )
            .expect("plan");
            apply_ai_action_plan_to_db(&db, plan, "2026-05-31T00:00:00.000Z")
                .await
                .expect("apply");

            let (content, search_text): (Option<String>, Option<String>) =
                sqlx::query_as("SELECT content, search_text FROM pages WHERE title = 'Notes'")
                    .fetch_one(&db)
                    .await
                    .expect("row");

            assert_eq!(search_text.as_deref(), Some("Hello world"));
            assert!(content.expect("content").contains("paragraph"));
        });
    }

    #[test]
    fn applies_create_database_plan_transactionally() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_pages_table(&db).await;

            let plan = parse_ai_action_plan(
                r#"{"version":1,"summary":"Create tracker","requires_confirmation":true,"actions":[{"type":"create_database","title":"Exams","properties":[{"id":"status","name":"Status","type":"select","options":["Todo","Done"]}],"starter_rows":[{"title":"Physics","properties":{"status":"Todo"}}]}]}"#,
            )
            .expect("plan");
            let result = apply_ai_action_plan_to_db(&db, plan, "2026-05-31T00:00:00.000Z")
                .await
                .expect("apply");

            assert_eq!(result.created_page_ids.len(), 2);
            let database_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pages WHERE title = 'Exams' AND is_database = 1",
            )
            .fetch_one(&db)
            .await
            .expect("database count");
            let row_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM pages WHERE title = 'Physics'")
                    .fetch_one(&db)
                    .await
                    .expect("row count");

            assert_eq!(database_count, 1);
            assert_eq!(row_count, 1);
        });
    }

    #[test]
    fn rejects_create_page_with_missing_parent_without_inserting_orphan() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_pages_table(&db).await;

            let plan = AiActionPlan {
                version: 1,
                summary: "Create child".to_string(),
                requires_confirmation: true,
                actions: vec![AiAction::CreatePage {
                    title: "Child".to_string(),
                    parent_id: Some("missing-parent".to_string()),
                    content_blocks: None,
                }],
            };

            let error = apply_ai_action_plan_to_db(&db, plan, "2026-05-31T00:00:00.000Z")
                .await
                .expect_err("reject missing parent");
            let page_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pages")
                .fetch_one(&db)
                .await
                .expect("page count");

            assert_eq!(error, "AI parent page not found");
            assert_eq!(page_count, 0);
        });
    }

    #[test]
    fn rejects_database_rows_for_non_database_page() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_pages_table(&db).await;
            insert_test_page(&db, "plain-page", 0).await;

            let plan = AiActionPlan {
                version: 1,
                summary: "Create rows".to_string(),
                requires_confirmation: true,
                actions: vec![AiAction::CreateDatabaseRows {
                    database_page_id: "plain-page".to_string(),
                    rows: vec![AiDatabaseRow {
                        title: "Row".to_string(),
                        properties: None,
                    }],
                }],
            };

            let error = apply_ai_action_plan_to_db(&db, plan, "2026-05-31T00:00:00.000Z")
                .await
                .expect_err("reject non-database target");
            let row_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM pages WHERE title = 'Row'")
                    .fetch_one(&db)
                    .await
                    .expect("row count");

            assert_eq!(error, "AI target database not found");
            assert_eq!(row_count, 0);
        });
    }

    #[test]
    fn openrouter_request_includes_model_and_json_instruction() {
        let body = build_openrouter_request_body(
            AI_MODEL_KIMI_FREE,
            "Create exam tracker",
            Some("Current page: Physics"),
            true,
        );
        let serialized = serde_json::to_string(&body).expect("serialize");

        assert!(serialized.contains(AI_MODEL_KIMI_FREE));
        assert!(serialized.contains("Return only valid JSON"));
        assert!(serialized.contains("json_object"));
        assert!(serialized.contains("Create exam tracker"));
    }

    #[test]
    fn openrouter_request_can_skip_structured_response_format() {
        let body = build_openrouter_request_body(AI_MODEL_KIMI_FREE, "Create page", None, false);

        assert!(body.get("response_format").is_none());
        assert_eq!(
            body.get("model").and_then(|value| value.as_str()),
            Some(AI_MODEL_KIMI_FREE)
        );
    }

    #[test]
    fn summarizes_openrouter_error_body() {
        let error = summarize_openrouter_error(
            r#"{"error":{"message":"No endpoints found for model deepseek/deepseek-v4-flash:free"}}"#,
        );

        assert_eq!(
            error,
            "No endpoints found for model deepseek/deepseek-v4-flash:free"
        );
    }

    #[test]
    fn retries_without_response_format_only_for_structured_output_errors() {
        let error = OpenRouterRequestError {
            status: reqwest::StatusCode::BAD_REQUEST,
            message: "response_format is not supported by this model".to_string(),
        };
        assert!(should_retry_without_response_format(&error));

        let unavailable = OpenRouterRequestError {
            status: reqwest::StatusCode::NOT_FOUND,
            message: "No endpoints found for model".to_string(),
        };
        assert!(!should_retry_without_response_format(&unavailable));
    }
}
