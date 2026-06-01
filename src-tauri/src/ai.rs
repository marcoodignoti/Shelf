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
const AI_MAX_BLOCK_DEPTH: usize = 6;

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
    #[serde(default)]
    pub history: Vec<AiChatTurn>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiChatRequest {
    pub conversation_id: String,
    pub prompt: String,
    pub provider: String,
    pub model: String,
    pub current_page_id: Option<String>,
    #[serde(default)]
    pub regenerate: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct AiChatTurn {
    pub role: String,
    pub content: String,
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
    #[serde(rename = "append_blocks")]
    AppendBlocks {
        page_id: String,
        content_blocks: serde_json::Value,
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

#[derive(Debug, Clone, Serialize, sqlx::FromRow, PartialEq)]
pub struct AiConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiChatStoredMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub plan: Option<AiActionPlan>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiConversationDetail {
    pub conversation: AiConversationSummary,
    pub messages: Vec<AiChatStoredMessage>,
}

pub async fn insert_ai_conversation(
    db: &SqlitePool,
    title: &str,
    now: &str,
) -> Result<AiConversationSummary, String> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO ai_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(title)
    .bind(now)
    .bind(now)
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;
    Ok(AiConversationSummary {
        id,
        title: title.to_string(),
        updated_at: now.to_string(),
    })
}

pub async fn insert_ai_message(
    db: &SqlitePool,
    conversation_id: &str,
    role: &str,
    content: &str,
    plan: Option<&AiActionPlan>,
    now: &str,
) -> Result<AiChatStoredMessage, String> {
    let id = Uuid::new_v4().to_string();
    let seq: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(seq), -1) + 1 FROM ai_messages WHERE conversation_id = ?",
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|error| error.to_string())?;
    let plan_json = plan
        .map(|plan| serde_json::to_string(plan).map_err(|error| error.to_string()))
        .transpose()?;
    sqlx::query(
        "INSERT INTO ai_messages (id, conversation_id, role, content, plan_json, seq, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(conversation_id)
    .bind(role)
    .bind(content)
    .bind(&plan_json)
    .bind(seq)
    .bind(now)
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query("UPDATE ai_conversations SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(conversation_id)
        .execute(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(AiChatStoredMessage {
        id,
        role: role.to_string(),
        content: content.to_string(),
        plan: plan.cloned(),
        created_at: now.to_string(),
    })
}

pub async fn list_ai_conversation_records(
    db: &SqlitePool,
) -> Result<Vec<AiConversationSummary>, String> {
    sqlx::query_as::<_, AiConversationSummary>(
        "SELECT id, title, updated_at FROM ai_conversations ORDER BY updated_at DESC",
    )
    .fetch_all(db)
    .await
    .map_err(|error| error.to_string())
}

pub async fn get_ai_conversation_detail(
    db: &SqlitePool,
    id: &str,
) -> Result<AiConversationDetail, String> {
    let conversation = sqlx::query_as::<_, AiConversationSummary>(
        "SELECT id, title, updated_at FROM ai_conversations WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "Conversation not found".to_string())?;

    let rows: Vec<(String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, role, content, plan_json, created_at
         FROM ai_messages WHERE conversation_id = ? ORDER BY seq ASC",
    )
    .bind(id)
    .fetch_all(db)
    .await
    .map_err(|error| error.to_string())?;

    let messages = rows
        .into_iter()
        .map(
            |(id, role, content, plan_json, created_at)| AiChatStoredMessage {
                id,
                role,
                content,
                plan: plan_json
                    .as_deref()
                    .and_then(|raw| serde_json::from_str::<AiActionPlan>(raw).ok()),
                created_at,
            },
        )
        .collect();

    Ok(AiConversationDetail {
        conversation,
        messages,
    })
}

pub async fn rename_ai_conversation_record(
    db: &SqlitePool,
    id: &str,
    title: &str,
    now: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?")
        .bind(title)
        .bind(now)
        .bind(id)
        .execute(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn delete_ai_conversation_record(db: &SqlitePool, id: &str) -> Result<(), String> {
    let mut tx = db.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM ai_messages WHERE conversation_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM ai_conversations WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(())
}

/// Last turns of a conversation as bounded chat history for the model.
pub async fn conversation_history(
    db: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<AiChatTurn>, String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY seq ASC",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
    .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(role, content)| AiChatTurn { role, content })
        .collect())
}

/// Remove the trailing assistant message (used by regenerate).
pub async fn delete_last_assistant_message(
    db: &SqlitePool,
    conversation_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM ai_messages
         WHERE id = (
            SELECT id FROM ai_messages
            WHERE conversation_id = ? AND role = 'assistant'
            ORDER BY seq DESC LIMIT 1
         )",
    )
    .bind(conversation_id)
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
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

pub async fn migrate_ai_chat(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ai_conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
    .execute(db)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            plan_json TEXT,
            seq INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );",
    )
    .execute(db)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
         ON ai_messages (conversation_id, seq);",
    )
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
                "create_page"
                    | "create_subpages"
                    | "create_database"
                    | "create_database_rows"
                    | "append_blocks"
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
            AiAction::AppendBlocks {
                page_id,
                content_blocks,
            } => {
                validate_id(page_id)?;
                let is_empty = content_blocks.as_array().is_none_or(Vec::is_empty);
                if is_empty {
                    return Err("AI append has no content blocks".to_string());
                }
                validate_content_blocks(Some(content_blocks))?;
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
        for block in blocks {
            validate_block_shape(block, 0)?;
        }
    }
    Ok(())
}

/// Reject content blocks whose shape the BlockNote editor cannot render. Size is
/// checked elsewhere; this guards structure: every block must be an object with
/// a sane `type`, well-typed `props`/`content`, and bounded `children` nesting.
/// Without this a model can emit JSON that passes size limits but corrupts the
/// editor on load.
fn validate_block_shape(block: &serde_json::Value, depth: usize) -> Result<(), String> {
    if depth > AI_MAX_BLOCK_DEPTH {
        return Err("AI content blocks are nested too deeply".to_string());
    }

    let Some(object) = block.as_object() else {
        return Err("AI content block must be an object".to_string());
    };

    let Some(block_type) = object.get("type").and_then(serde_json::Value::as_str) else {
        return Err("AI content block is missing a type".to_string());
    };
    if block_type.is_empty()
        || block_type.len() > 64
        || !block_type
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err("AI content block type is invalid".to_string());
    }

    if let Some(props) = object.get("props") {
        if !props.is_object() {
            return Err("AI content block props must be an object".to_string());
        }
    }

    if let Some(content) = object.get("content") {
        if !(content.is_string() || content.is_array() || content.is_object()) {
            return Err("AI content block content is invalid".to_string());
        }
    }

    if let Some(children) = object.get("children") {
        let Some(children) = children.as_array() else {
            return Err("AI content block children must be an array".to_string());
        };
        for child in children {
            validate_block_shape(child, depth + 1)?;
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
    let mut updated_page_ids = Vec::new();

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
            AiAction::AppendBlocks {
                page_id,
                content_blocks,
            } => {
                append_blocks_to_page(&mut tx, &page_id, content_blocks, now).await?;
                updated_page_ids.push(page_id);
            }
        }
    }

    tx.commit().await.map_err(|error| error.to_string())?;
    let primary_page_id = created_page_ids
        .first()
        .or_else(|| updated_page_ids.first())
        .cloned();
    Ok(AiApplyResult {
        created_page_ids,
        updated_page_ids,
        primary_page_id,
    })
}

/// Append AI-generated blocks to an existing note page, merging into its
/// BlockNote content array and refreshing the plain-text search index. Errors
/// (rather than creating) if the page is missing or is a database, so append
/// never silently overwrites or targets the wrong row.
async fn append_blocks_to_page(
    tx: &mut Transaction<'_, Sqlite>,
    page_id: &str,
    new_blocks: serde_json::Value,
    now: &str,
) -> Result<(), String> {
    let existing: Option<(Option<String>, i64)> = sqlx::query_as(
        "SELECT content, is_database
         FROM pages
         WHERE id = ?
           AND is_deleted = 0",
    )
    .bind(page_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    let Some((content, is_database)) = existing else {
        return Err("AI target page not found".to_string());
    };
    if is_database == 1 {
        return Err("AI cannot append blocks to a database".to_string());
    }

    let mut blocks = content
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();

    if let Some(appended) = new_blocks.as_array() {
        blocks.extend(appended.iter().cloned());
    }

    let merged = serde_json::Value::Array(blocks);
    let search_text = search_text_from_content_blocks(&merged);
    let search_text = (!search_text.is_empty()).then_some(search_text);

    sqlx::query("UPDATE pages SET content = ?, search_text = ?, updated_at = ? WHERE id = ?")
        .bind(merged.to_string())
        .bind(search_text)
        .bind(now)
        .bind(page_id)
        .execute(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
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

/// Bounded snapshot of the workspace handed to the model as planning context.
/// Built backend-side from live DB rows; never deserialized from the model.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AiWorkspaceContext {
    pub current_page: Option<AiContextPage>,
    /// Title of the PDF attached to the current page when it is a Studio note,
    /// so AI prompts run while reading a PDF know what document they concern.
    pub attached_document: Option<String>,
    pub pages: Vec<AiContextPage>,
    pub databases: Vec<AiContextDatabase>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiContextPage {
    pub id: String,
    pub title: String,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiContextDatabase {
    pub id: String,
    pub title: String,
    pub properties: Vec<AiContextProperty>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiContextProperty {
    pub id: String,
    pub name: String,
    pub property_type: String,
}

const AI_CONTEXT_SNIPPET_CHARS: usize = 400;
const AI_CONTEXT_MAX_PAGES: usize = 40;
const AI_CONTEXT_MAX_DATABASES: usize = 25;

fn context_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

fn truncate_snippet(text: &str) -> Option<String> {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    if collapsed.chars().count() <= AI_CONTEXT_SNIPPET_CHARS {
        return Some(collapsed);
    }
    let truncated: String = collapsed.chars().take(AI_CONTEXT_SNIPPET_CHARS).collect();
    Some(format!("{}…", truncated))
}

/// Render the workspace snapshot into a plain-text block the model can use to
/// target real page/database ids. Returns None when nothing useful is known,
/// so the caller keeps the original "No page context." placeholder.
pub fn build_workspace_context_prompt(context: &AiWorkspaceContext) -> Option<String> {
    let mut sections: Vec<String> = Vec::new();

    if let Some(current) = &context.current_page {
        let mut lines = vec![format!(
            "Current page: {} (id: {})",
            context_title(&current.title),
            current.id
        )];
        if let Some(document) = context.attached_document.as_deref() {
            let trimmed = document.trim();
            if !trimmed.is_empty() {
                lines.push(format!("Attached PDF document: {}", context_title(trimmed)));
            }
        }
        if let Some(snippet) = current.snippet.as_deref().and_then(truncate_snippet) {
            lines.push(format!("Current page content: {}", snippet));
        }
        sections.push(lines.join("\n"));
    }

    let pages: Vec<&AiContextPage> = context
        .pages
        .iter()
        .filter(|page| context.current_page.as_ref().map(|c| &c.id) != Some(&page.id))
        .take(AI_CONTEXT_MAX_PAGES)
        .collect();
    if !pages.is_empty() {
        let mut lines = vec!["Existing pages (use an id below for parent_id):".to_string()];
        for page in pages {
            lines.push(format!(
                "- {} (id: {})",
                context_title(&page.title),
                page.id
            ));
        }
        sections.push(lines.join("\n"));
    }

    let databases: Vec<&AiContextDatabase> = context
        .databases
        .iter()
        .take(AI_CONTEXT_MAX_DATABASES)
        .collect();
    if !databases.is_empty() {
        let mut lines =
            vec!["Existing databases (use an id below for database_page_id):".to_string()];
        for database in databases {
            let props = database
                .properties
                .iter()
                .map(|prop| format!("{}[{}]", prop.id, prop.property_type))
                .collect::<Vec<_>>()
                .join(", ");
            if props.is_empty() {
                lines.push(format!(
                    "- {} (id: {})",
                    context_title(&database.title),
                    database.id
                ));
            } else {
                lines.push(format!(
                    "- {} (id: {}) properties: {}",
                    context_title(&database.title),
                    database.id,
                    props
                ));
            }
        }
        sections.push(lines.join("\n"));
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}

const AI_MAX_HISTORY_TURNS: usize = 10;
const AI_MAX_HISTORY_CHARS: usize = 2_000;

/// Convert recent chat turns into OpenRouter messages, bounded by turn count and
/// per-turn length so a long conversation cannot blow the token budget. Keeps
/// only the most recent turns and drops anything that is not a user/assistant
/// text turn.
fn chat_history_messages(history: &[AiChatTurn]) -> Vec<serde_json::Value> {
    let valid: Vec<serde_json::Value> = history
        .iter()
        .filter(|turn| matches!(turn.role.as_str(), "user" | "assistant"))
        .filter_map(|turn| {
            let content = turn.content.trim();
            if content.is_empty() {
                return None;
            }
            let content: String = content.chars().take(AI_MAX_HISTORY_CHARS).collect();
            Some(serde_json::json!({ "role": turn.role, "content": content }))
        })
        .collect();
    let start = valid.len().saturating_sub(AI_MAX_HISTORY_TURNS);
    valid[start..].to_vec()
}

pub fn build_openrouter_request_body(
    model: &str,
    prompt: &str,
    context: Option<&str>,
    history: &[AiChatTurn],
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
    {"type":"create_database_rows","database_page_id":"existing-database-id","rows":[{"title":"Row title","properties":{"done":false}}]},
    {"type":"append_blocks","page_id":"existing-page-id","content_blocks":[{"type":"paragraph","content":[{"type":"text","text":"New text","styles":{}}]}]}
  ]
}
Allowed actions only: create_page, create_subpages, create_database, create_database_rows, append_blocks.
Use append_blocks to add content to an existing page (e.g. "continue writing", "summarize into this page"); its page_id must come from the Context. append_blocks adds to the end and never removes existing content.
Allowed property types only: text, checkbox, select, date.
Only use a parent_id or database_page_id that appears in the Context. To add under the current page, use its id. Never invent ids.
For create_database_rows, the row "properties" keys must be property ids listed for that database in the Context.
Never delete, rename, overwrite, move, or modify existing content.
Use content_blocks as a BlockNote-style JSON array. Keep content concise.
Set requires_confirmation true unless the request is clearly low-risk create-only."#;

    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": system_prompt
    })];
    messages.extend(chat_history_messages(history));
    messages.push(serde_json::json!({
        "role": "user",
        "content": format!("Context:\n{}\n\nRequest:\n{}", context.unwrap_or("No page context."), prompt)
    }));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2
    });

    if structured_json {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }

    body
}

fn build_chat_request_body(
    model: &str,
    prompt: &str,
    context: Option<&str>,
    history: &[AiChatTurn],
) -> serde_json::Value {
    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": CHAT_SYSTEM_PROMPT
    })];
    messages.extend(chat_history_messages(history));
    messages.push(serde_json::json!({
        "role": "user",
        "content": format!("Context:\n{}\n\nMessage:\n{}", context.unwrap_or("No page context."), prompt)
    }));
    serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "stream": true
    })
}

pub const CHAT_ACTIONS_FENCE: &str = "```opennotion-actions";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AiChatReply {
    pub content: String,
    pub plan: Option<AiActionPlan>,
}

/// Drive an OpenRouter SSE response into a chat reply: accumulate prose, emit
/// token deltas, race each chunk against `cancel`, then split any embedded
/// action fence. Returns the prose plus an optional plan.
async fn consume_chat_stream(
    response: reqwest::Response,
    on_delta: impl Fn(&str) + Send,
    cancel: impl std::future::Future<Output = ()> + Send,
) -> Result<AiChatReply, String> {
    use futures_util::StreamExt;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(OpenRouterRequestError {
            status,
            message: summarize_openrouter_error(&text),
        }
        .to_string());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut content = String::new();
    let mut done = false;

    tokio::pin!(cancel);

    loop {
        let chunk = tokio::select! {
            biased;
            _ = &mut cancel => return Err("AI generation cancelled".to_string()),
            chunk = stream.next() => chunk,
        };
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|error| format!("AI stream failed: {}", error))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline).collect();
            match parse_sse_line(&line) {
                SseLine::Delta(text) => {
                    on_delta(&text);
                    content.push_str(&text);
                }
                SseLine::Done => {
                    done = true;
                    break;
                }
                SseLine::Other => {}
            }
        }
        if done {
            break;
        }
    }

    if !done {
        if let SseLine::Delta(text) = parse_sse_line(&buffer) {
            on_delta(&text);
            content.push_str(&text);
        }
    }

    if content.trim().is_empty() {
        return Err("AI response did not include content".to_string());
    }

    let (prose, plan) = split_chat_actions(&content);
    Ok(AiChatReply {
        content: prose,
        plan,
    })
}

/// Split a chat completion into visible prose and an optional embedded action
/// plan. The model is told to append at most one ```opennotion-actions fenced
/// JSON block (the AiActionPlan schema) at the very end. A malformed or invalid
/// fence is dropped so the prose still renders.
pub fn split_chat_actions(raw: &str) -> (String, Option<AiActionPlan>) {
    let Some(marker) = raw.find(CHAT_ACTIONS_FENCE) else {
        return (raw.trim().to_string(), None);
    };

    let prose = raw[..marker].trim().to_string();
    let after = &raw[marker + CHAT_ACTIONS_FENCE.len()..];
    // Body runs from the newline after the opening fence to the closing ```.
    let body = after
        .find('\n')
        .map(|nl| &after[nl + 1..])
        .and_then(|rest| rest.find("```").map(|end| &rest[..end]))
        .unwrap_or("");

    let plan = parse_ai_action_plan(body).ok();
    (prose, plan)
}

const CHAT_SYSTEM_PROMPT: &str = r#"You are OpenNotion's in-app assistant.
Answer the user conversationally in GitHub-flavored Markdown. Be concise.
You can also create workspace structures. When (and only when) creating
something helps, append exactly one fenced block at the very end of your reply:
```opennotion-actions
{"version":1,"summary":"short summary","requires_confirmation":true,"actions":[...]}
```
Action schema and rules:
- Allowed actions only: create_page, create_subpages, create_database, create_database_rows, append_blocks.
- Allowed property types only: text, checkbox, select, date.
- Only use a parent_id, database_page_id, or page_id that appears in the Context. To act on the current page, use its id. Never invent ids.
- append_blocks adds to the end of an existing page and never removes content.
- content_blocks is a BlockNote-style JSON array. Keep content concise.
- Never delete, rename, overwrite, or move existing content.
- Set requires_confirmation true unless the request is clearly low-risk create-only.
If no action is needed, do not include the fenced block."#;

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

/// HTTP client for OpenRouter calls with bounded timeouts. Without these a
/// stalled connection makes the Tauri command await forever, which the UI shows
/// as a permanent "Generating..." state with no error.
fn openrouter_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| format!("AI HTTP client could not be created: {}", error))
}

pub async fn list_openrouter_models(runtime: &AiRuntime) -> Result<Vec<AiModelInfo>, String> {
    let client = openrouter_http_client()?;
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

    let client = openrouter_http_client()?;
    let structured_body = build_openrouter_request_body(
        &request.model,
        &request.prompt,
        context.as_deref(),
        &request.history,
        true,
    );
    let payload = match send_openrouter_chat_request(&client, &api_key, structured_body).await {
        Ok(payload) => payload,
        Err(error) if should_retry_without_response_format(&error) => {
            let plain_json_body = build_openrouter_request_body(
                &request.model,
                &request.prompt,
                context.as_deref(),
                &request.history,
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

#[derive(Debug, PartialEq)]
enum SseLine {
    Delta(String),
    Done,
    Other,
}

/// Parse one Server-Sent-Events line from OpenRouter's streaming chat endpoint.
/// Payload lines start with `data:`; `data: [DONE]` ends the stream; every other
/// data line is JSON whose `choices[0].delta.content` holds the next token chunk.
fn parse_sse_line(line: &str) -> SseLine {
    let Some(payload) = line.trim().strip_prefix("data:") else {
        return SseLine::Other;
    };
    let payload = payload.trim();
    if payload == "[DONE]" {
        return SseLine::Done;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return SseLine::Other;
    };
    value
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(|content| content.as_str())
        .filter(|text| !text.is_empty())
        .map(|text| SseLine::Delta(text.to_string()))
        .unwrap_or(SseLine::Other)
}

/// Streaming sibling of `generate_openrouter_plan`: requests `stream: true`,
/// feeds each token chunk to `on_delta` (e.g. to emit UI progress), accumulates
/// the full body, then parses it into a plan exactly like the non-streaming path.
/// `cancel` resolves when the user aborts; resolving it drops the HTTP response
/// so the request is torn down instead of finishing in the background.
pub async fn stream_openrouter_plan(
    runtime: &AiRuntime,
    request: AiPlanRequest,
    context: Option<String>,
    on_delta: impl Fn(&str) + Send,
    cancel: impl std::future::Future<Output = ()> + Send,
) -> Result<AiActionPlan, String> {
    validate_provider_model(&request.provider, &request.model)?;
    let api_key = runtime
        .secret_store
        .get_secret(&request.provider)?
        .ok_or_else(|| "Missing AI API key".to_string())?;

    let client = openrouter_http_client()?;
    let mut body = build_openrouter_request_body(
        &request.model,
        &request.prompt,
        context.as_deref(),
        &request.history,
        true,
    );
    body["stream"] = serde_json::Value::Bool(true);

    let response = client
        .post(OPENROUTER_CHAT_URL)
        .bearer_auth(&api_key)
        .header("HTTP-Referer", "https://opennotion.local")
        .header("X-Title", "OpenNotion")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {}", error))?;

    consume_plan_stream(response, on_delta, cancel).await
}

/// Drive an OpenRouter SSE response to a parsed plan. Split out from
/// `stream_openrouter_plan` so the streaming/cancel logic can be tested against
/// a local mock server without a live API key. Races each stream chunk against
/// `cancel`; if cancel wins, the response is dropped (aborting the request) and
/// an `"AI generation cancelled"` error is returned.
async fn consume_plan_stream(
    response: reqwest::Response,
    on_delta: impl Fn(&str) + Send,
    cancel: impl std::future::Future<Output = ()> + Send,
) -> Result<AiActionPlan, String> {
    use futures_util::StreamExt;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(OpenRouterRequestError {
            status,
            message: summarize_openrouter_error(&text),
        }
        .to_string());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut content = String::new();
    let mut done = false;

    tokio::pin!(cancel);

    loop {
        let chunk = tokio::select! {
            biased;
            _ = &mut cancel => return Err("AI generation cancelled".to_string()),
            chunk = stream.next() => chunk,
        };

        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(|error| format!("AI stream failed: {}", error))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline).collect();
            match parse_sse_line(&line) {
                SseLine::Delta(text) => {
                    on_delta(&text);
                    content.push_str(&text);
                }
                SseLine::Done => {
                    done = true;
                    break;
                }
                SseLine::Other => {}
            }
        }

        if done {
            break;
        }
    }

    // Flush a trailing line with no newline terminator.
    if !done {
        if let SseLine::Delta(text) = parse_sse_line(&buffer) {
            on_delta(&text);
            content.push_str(&text);
        }
    }

    if content.trim().is_empty() {
        return Err("AI response did not include content".to_string());
    }

    parse_ai_action_plan(&content)
}

/// Streaming chat completion: builds the chat body, sends it, and drives the
/// response through consume_chat_stream. `history` is the prior conversation
/// turns; `cancel` aborts the in-flight request.
#[allow(clippy::too_many_arguments)]
pub async fn stream_openrouter_chat(
    runtime: &AiRuntime,
    provider: &str,
    model: &str,
    prompt: &str,
    context: Option<String>,
    history: Vec<AiChatTurn>,
    on_delta: impl Fn(&str) + Send,
    cancel: impl std::future::Future<Output = ()> + Send,
) -> Result<AiChatReply, String> {
    validate_provider_model(provider, model)?;
    let api_key = runtime
        .secret_store
        .get_secret(provider)?
        .ok_or_else(|| "Missing AI API key".to_string())?;

    let client = openrouter_http_client()?;
    let body = build_chat_request_body(model, prompt, context.as_deref(), &history);

    let response = client
        .post(OPENROUTER_CHAT_URL)
        .bearer_auth(&api_key)
        .header("HTTP-Referer", "https://opennotion.local")
        .header("X-Title", "OpenNotion")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {}", error))?;

    consume_chat_stream(response, on_delta, cancel).await
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
    fn accepts_well_formed_nested_content_blocks() {
        let blocks = serde_json::json!([
            {"type":"heading","props":{"level":1},"content":[{"type":"text","text":"Title","styles":{}}]},
            {"type":"bulletListItem","content":[{"type":"text","text":"Point","styles":{}}],
             "children":[{"type":"paragraph","content":"Nested"}]},
            {"type":"table","content":{"type":"tableContent","rows":[]}}
        ]);
        assert_eq!(validate_content_blocks(Some(&blocks)), Ok(()));
    }

    #[test]
    fn rejects_block_missing_type() {
        let blocks = serde_json::json!([{"content":[{"type":"text","text":"x","styles":{}}]}]);
        assert_eq!(
            validate_content_blocks(Some(&blocks)),
            Err("AI content block is missing a type".to_string())
        );
    }

    #[test]
    fn rejects_non_object_block_and_bad_props() {
        assert_eq!(
            validate_content_blocks(Some(&serde_json::json!(["just a string"]))),
            Err("AI content block must be an object".to_string())
        );
        assert_eq!(
            validate_content_blocks(Some(&serde_json::json!([{"type":"paragraph","props":[]}]))),
            Err("AI content block props must be an object".to_string())
        );
    }

    #[test]
    fn rejects_overly_deep_block_nesting() {
        // Build children nested deeper than AI_MAX_BLOCK_DEPTH.
        let mut block = serde_json::json!({"type":"paragraph"});
        for _ in 0..(AI_MAX_BLOCK_DEPTH + 1) {
            block = serde_json::json!({"type":"paragraph","children":[block]});
        }
        assert_eq!(
            validate_content_blocks(Some(&serde_json::json!([block]))),
            Err("AI content blocks are nested too deeply".to_string())
        );
    }

    #[test]
    fn empty_workspace_context_yields_no_prompt() {
        assert_eq!(
            build_workspace_context_prompt(&AiWorkspaceContext::default()),
            None
        );
    }

    #[test]
    fn workspace_context_lists_ids_for_pages_and_databases() {
        let context = AiWorkspaceContext {
            current_page: Some(AiContextPage {
                id: "page-1".to_string(),
                title: "Physics".to_string(),
                snippet: Some("  Gauss   law   flux  ".to_string()),
            }),
            attached_document: None,
            pages: vec![
                // current page is filtered out of the "Existing pages" list
                AiContextPage {
                    id: "page-1".to_string(),
                    title: "Physics".to_string(),
                    snippet: None,
                },
                AiContextPage {
                    id: "page-2".to_string(),
                    title: "Chemistry".to_string(),
                    snippet: None,
                },
            ],
            databases: vec![AiContextDatabase {
                id: "db-1".to_string(),
                title: "Exams".to_string(),
                properties: vec![AiContextProperty {
                    id: "status".to_string(),
                    name: "Status".to_string(),
                    property_type: "select".to_string(),
                }],
            }],
        };

        let prompt = build_workspace_context_prompt(&context).expect("prompt");

        assert!(prompt.contains("Current page: Physics (id: page-1)"));
        assert!(prompt.contains("Current page content: Gauss law flux"));
        assert!(prompt.contains("- Chemistry (id: page-2)"));
        assert!(!prompt.contains("- Physics (id: page-1)"));
        assert!(prompt.contains("- Exams (id: db-1) properties: status[select]"));
    }

    #[test]
    fn workspace_context_surfaces_attached_pdf_for_studio_note() {
        let context = AiWorkspaceContext {
            current_page: Some(AiContextPage {
                id: "note-1".to_string(),
                title: "Lecture Notes".to_string(),
                snippet: None,
            }),
            attached_document: Some("Thermodynamics.pdf".to_string()),
            ..AiWorkspaceContext::default()
        };

        let prompt = build_workspace_context_prompt(&context).expect("prompt");

        assert!(prompt.contains("Current page: Lecture Notes (id: note-1)"));
        assert!(prompt.contains("Attached PDF document: Thermodynamics.pdf"));
    }

    #[test]
    fn workspace_context_truncates_long_snippet() {
        let long = "word ".repeat(200);
        let context = AiWorkspaceContext {
            current_page: Some(AiContextPage {
                id: "page-1".to_string(),
                title: "Big".to_string(),
                snippet: Some(long),
            }),
            ..AiWorkspaceContext::default()
        };

        let prompt = build_workspace_context_prompt(&context).expect("prompt");
        let snippet_line = prompt
            .lines()
            .find(|line| line.starts_with("Current page content:"))
            .expect("snippet line");

        assert!(snippet_line.ends_with('…'));
        assert!(snippet_line.chars().count() <= AI_CONTEXT_SNIPPET_CHARS + 40);
    }

    #[test]
    fn workspace_context_caps_page_list() {
        let pages = (0..(AI_CONTEXT_MAX_PAGES + 10))
            .map(|index| AiContextPage {
                id: format!("page-{}", index),
                title: format!("Page {}", index),
                snippet: None,
            })
            .collect();
        let context = AiWorkspaceContext {
            pages,
            ..AiWorkspaceContext::default()
        };

        let prompt = build_workspace_context_prompt(&context).expect("prompt");
        let listed = prompt.matches("(id: page-").count();

        assert_eq!(listed, AI_CONTEXT_MAX_PAGES);
    }

    #[test]
    fn rejects_append_blocks_with_empty_content() {
        let raw = r#"{"version":1,"summary":"Append","requires_confirmation":true,"actions":[{"type":"append_blocks","page_id":"page-1","content_blocks":[]}]}"#;
        assert_eq!(
            parse_ai_action_plan(raw),
            Err("AI append has no content blocks".to_string())
        );
    }

    #[test]
    fn append_blocks_merges_into_existing_page_content() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_pages_table(&db).await;
            sqlx::query(
                "INSERT INTO pages (id, title, parent_id, content, search_text, icon, cover_url, is_deleted, is_favorite, is_template, is_database, database_schema, properties, sort_order, page_kind, created_at, updated_at)
                 VALUES ('page-1', 'Notes', NULL, ?, 'Existing', NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, 'note', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z')",
            )
            .bind(r#"[{"type":"paragraph","content":[{"type":"text","text":"Existing","styles":{}}]}]"#)
            .execute(&db)
            .await
            .expect("seed page");

            let plan = parse_ai_action_plan(
                r#"{"version":1,"summary":"Append","requires_confirmation":true,"actions":[{"type":"append_blocks","page_id":"page-1","content_blocks":[{"type":"paragraph","content":[{"type":"text","text":"Appended","styles":{}}]}]}]}"#,
            )
            .expect("plan");
            let result = apply_ai_action_plan_to_db(&db, plan, "2026-06-01T00:00:00.000Z")
                .await
                .expect("apply");

            assert!(result.created_page_ids.is_empty());
            assert_eq!(result.updated_page_ids, vec!["page-1".to_string()]);
            assert_eq!(result.primary_page_id.as_deref(), Some("page-1"));

            let (content, search_text, updated_at): (Option<String>, Option<String>, String) =
                sqlx::query_as(
                    "SELECT content, search_text, updated_at FROM pages WHERE id = 'page-1'",
                )
                .fetch_one(&db)
                .await
                .expect("row");

            let blocks: serde_json::Value =
                serde_json::from_str(&content.expect("content")).expect("json");
            assert_eq!(blocks.as_array().map(Vec::len), Some(2));
            assert_eq!(search_text.as_deref(), Some("Existing Appended"));
            assert_eq!(updated_at, "2026-06-01T00:00:00.000Z");
        });
    }

    #[test]
    fn append_blocks_rejects_database_target_without_mutating() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_pages_table(&db).await;
            insert_test_page(&db, "db-1", 1).await;

            let plan = parse_ai_action_plan(
                r#"{"version":1,"summary":"Append","requires_confirmation":true,"actions":[{"type":"append_blocks","page_id":"db-1","content_blocks":[{"type":"paragraph","content":[{"type":"text","text":"x","styles":{}}]}]}]}"#,
            )
            .expect("plan");

            let error = apply_ai_action_plan_to_db(&db, plan, "2026-06-01T00:00:00.000Z")
                .await
                .expect_err("reject database target");
            let content: Option<String> =
                sqlx::query_scalar("SELECT content FROM pages WHERE id = 'db-1'")
                    .fetch_one(&db)
                    .await
                    .expect("row");

            assert_eq!(error, "AI cannot append blocks to a database");
            assert!(content.is_none());
        });
    }

    #[test]
    fn append_blocks_rejects_missing_page() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            create_pages_table(&db).await;

            let plan = parse_ai_action_plan(
                r#"{"version":1,"summary":"Append","requires_confirmation":true,"actions":[{"type":"append_blocks","page_id":"missing","content_blocks":[{"type":"paragraph","content":[{"type":"text","text":"x","styles":{}}]}]}]}"#,
            )
            .expect("plan");

            let error = apply_ai_action_plan_to_db(&db, plan, "2026-06-01T00:00:00.000Z")
                .await
                .expect_err("reject missing page");

            assert_eq!(error, "AI target page not found");
        });
    }

    #[test]
    fn openrouter_request_includes_model_and_json_instruction() {
        let body = build_openrouter_request_body(
            AI_MODEL_KIMI_FREE,
            "Create exam tracker",
            Some("Current page: Physics"),
            &[],
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
        let body =
            build_openrouter_request_body(AI_MODEL_KIMI_FREE, "Create page", None, &[], false);

        assert!(body.get("response_format").is_none());
        assert_eq!(
            body.get("model").and_then(|value| value.as_str()),
            Some(AI_MODEL_KIMI_FREE)
        );
    }

    #[test]
    fn openrouter_request_threads_bounded_chat_history() {
        let mut history: Vec<AiChatTurn> = (0..15)
            .map(|index| AiChatTurn {
                role: if index % 2 == 0 { "user" } else { "assistant" }.to_string(),
                content: format!("Turn {}", index),
            })
            .collect();
        // noise turns that must be dropped: blank content and a non-chat role
        history.push(AiChatTurn {
            role: "user".to_string(),
            content: "   ".to_string(),
        });
        history.push(AiChatTurn {
            role: "system".to_string(),
            content: "ignore me".to_string(),
        });

        let body = build_openrouter_request_body(
            AI_MODEL_KIMI_FREE,
            "Make it longer",
            None,
            &history,
            true,
        );
        let messages = body
            .get("messages")
            .and_then(|value| value.as_array())
            .expect("messages");

        // system + last 10 valid turns + final user prompt
        assert_eq!(messages.len(), 12);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["content"], "Turn 5");
        assert_eq!(messages[10]["content"], "Turn 14");
        assert_eq!(
            messages[11]["content"],
            "Context:\nNo page context.\n\nRequest:\nMake it longer"
        );
        let serialized = serde_json::to_string(&body).expect("serialize");
        assert!(!serialized.contains("ignore me"));
    }

    #[test]
    fn parses_sse_content_delta_lines() {
        assert_eq!(
            parse_sse_line(r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#),
            SseLine::Delta("Hello".to_string())
        );
        assert_eq!(parse_sse_line("data: [DONE]"), SseLine::Done);
        // keep-alive comments and empty deltas carry no content
        assert_eq!(parse_sse_line(": keep-alive"), SseLine::Other);
        assert_eq!(
            parse_sse_line(r#"data: {"choices":[{"delta":{}}]}"#),
            SseLine::Other
        );
        assert_eq!(parse_sse_line("data: not-json"), SseLine::Other);
    }

    /// Minimal one-shot HTTP/1.1 server that returns `body` as an SSE response.
    /// Lets the streaming consumer be tested against real reqwest bytes without a
    /// live OpenRouter key. Returns the URL to hit.
    fn spawn_sse_server(body: String) -> String {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let addr = listener.local_addr().expect("mock server addr");
        std::thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut scratch = [0u8; 1024];
                let _ = socket.read(&mut scratch);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{}",
                    body
                );
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
            }
        });
        format!("http://{}/", addr)
    }

    fn sse_data_line(content: &str) -> String {
        format!(
            "data: {}\n\n",
            serde_json::json!({ "choices": [{ "delta": { "content": content } }] })
        )
    }

    #[test]
    fn consume_plan_stream_assembles_plan_from_sse_chunks() {
        tauri::async_runtime::block_on(async {
            // A full plan JSON split across several streamed delta chunks.
            let body = format!(
                "{}{}{}data: [DONE]\n\n",
                sse_data_line("{\"version\":1,\"summary\":\"Streamed plan\","),
                sse_data_line(
                    "\"requires_confirmation\":true,\"actions\":[{\"type\":\"create_page\","
                ),
                sse_data_line("\"title\":\"Streamed\"}]}"),
            );
            let url = spawn_sse_server(body);

            let response = reqwest::Client::new()
                .get(&url)
                .send()
                .await
                .expect("mock response");

            let captured = std::sync::Mutex::new(String::new());
            let plan = consume_plan_stream(
                response,
                |delta| captured.lock().expect("lock").push_str(delta),
                std::future::pending::<()>(),
            )
            .await
            .expect("streamed plan");

            assert_eq!(plan.summary, "Streamed plan");
            assert_eq!(plan.actions.len(), 1);
            assert!(captured.lock().expect("lock").contains("Streamed"));
        });
    }

    #[test]
    fn consume_plan_stream_aborts_when_cancelled() {
        tauri::async_runtime::block_on(async {
            let url = spawn_sse_server(sse_data_line("{\"version\":1,"));

            let response = reqwest::Client::new()
                .get(&url)
                .send()
                .await
                .expect("mock response");

            let result = consume_plan_stream(
                response,
                |_| {},
                std::future::ready(()), // already-cancelled
            )
            .await;

            assert_eq!(result, Err("AI generation cancelled".to_string()));
        });
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

    #[test]
    fn split_chat_actions_returns_prose_only_when_no_fence() {
        let (prose, plan) = split_chat_actions("Here is an explanation.\nMore text.");
        assert_eq!(prose, "Here is an explanation.\nMore text.");
        assert!(plan.is_none());
    }

    #[test]
    fn split_chat_actions_extracts_valid_plan_and_strips_fence() {
        let raw = "Sure, I'll set that up.\n\n```opennotion-actions\n{\"version\":1,\"summary\":\"Make page\",\"requires_confirmation\":true,\"actions\":[{\"type\":\"create_page\",\"title\":\"Study\"}]}\n```";
        let (prose, plan) = split_chat_actions(raw);
        assert_eq!(prose, "Sure, I'll set that up.");
        let plan = plan.expect("plan");
        assert_eq!(plan.actions.len(), 1);
    }

    #[test]
    fn split_chat_actions_drops_invalid_fence_but_keeps_prose() {
        let raw = "Done.\n```opennotion-actions\n{ not json }\n```";
        let (prose, plan) = split_chat_actions(raw);
        assert_eq!(prose, "Done.");
        assert!(plan.is_none());
    }

    #[test]
    fn conversation_crud_round_trips_with_ordered_messages() {
        tauri::async_runtime::block_on(async {
            let db = test_db().await;
            migrate_ai_chat(&db).await.expect("migrate chat");

            let convo = insert_ai_conversation(&db, "First chat", "2026-06-01T00:00:00.000Z")
                .await
                .expect("insert convo");
            insert_ai_message(
                &db,
                &convo.id,
                "user",
                "Hi",
                None,
                "2026-06-01T00:00:01.000Z",
            )
            .await
            .expect("user msg");
            insert_ai_message(
                &db,
                &convo.id,
                "assistant",
                "Hello",
                None,
                "2026-06-01T00:00:02.000Z",
            )
            .await
            .expect("assistant msg");

            let detail = get_ai_conversation_detail(&db, &convo.id)
                .await
                .expect("detail");
            assert_eq!(detail.messages.len(), 2);
            assert_eq!(detail.messages[0].role, "user");
            assert_eq!(detail.messages[1].content, "Hello");

            rename_ai_conversation_record(&db, &convo.id, "Renamed", "2026-06-01T00:01:00.000Z")
                .await
                .expect("rename");
            let list = list_ai_conversation_records(&db).await.expect("list");
            assert_eq!(list[0].title, "Renamed");

            delete_ai_conversation_record(&db, &convo.id)
                .await
                .expect("delete");
            let after = list_ai_conversation_records(&db).await.expect("list2");
            assert!(after.is_empty());
            let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_messages")
                .fetch_one(&db)
                .await
                .expect("count");
            assert_eq!(remaining, 0);
        });
    }

    #[test]
    fn consume_chat_stream_returns_prose_and_plan() {
        tauri::async_runtime::block_on(async {
            let body = format!(
                "{}{}{}{}data: [DONE]\n\n",
                sse_data_line("Here you go.\n\n"),
                sse_data_line("```opennotion-actions\n"),
                sse_data_line("{\"version\":1,\"summary\":\"Make page\",\"requires_confirmation\":true,\"actions\":[{\"type\":\"create_page\",\"title\":\"Study\"}]}"),
                sse_data_line("\n```"),
            );
            let url = spawn_sse_server(body);
            let response = reqwest::Client::new().get(&url).send().await.expect("resp");

            let captured = std::sync::Mutex::new(String::new());
            let reply = consume_chat_stream(
                response,
                |delta| captured.lock().expect("lock").push_str(delta),
                std::future::pending::<()>(),
            )
            .await
            .expect("reply");

            assert_eq!(reply.content, "Here you go.");
            assert_eq!(reply.plan.expect("plan").actions.len(), 1);
            assert!(captured.lock().expect("lock").contains("Here you go."));
        });
    }
}
