import { Channel, invoke } from "@tauri-apps/api/core";
import { DatabaseProperty, DatabasePropertyType } from "./database";

export const AI_PROVIDER_OPENROUTER = "openrouter" as const;
export type AiProviderId = typeof AI_PROVIDER_OPENROUTER;

export type AiModelId = string;
export interface AiModelInfo {
  id: AiModelId;
  label: string;
  context_length?: number | null;
}

export const AI_MODELS = [
  { id: "moonshotai/kimi-k2.6:free", label: "Kimi K2.6 Free" },
  { id: "deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash Free" },
] as const satisfies readonly AiModelInfo[];


export interface AiSettings {
  provider: AiProviderId;
  model: AiModelId;
  trusted_mode_enabled: boolean;
  has_api_key: boolean;
}

export interface AiCreatePageAction {
  type: "create_page";
  title: string;
  parent_id?: string | null;
  content_blocks?: unknown[];
}

export interface AiCreateSubpagesAction {
  type: "create_subpages";
  parent_id: string;
  pages: Array<{ title: string; content_blocks?: unknown[] }>;
}

export interface AiCreateDatabaseAction {
  type: "create_database";
  title: string;
  parent_id?: string | null;
  properties: Array<DatabaseProperty & { type: DatabasePropertyType }>;
  starter_rows?: Array<{ title: string; properties?: Record<string, string | boolean> }>;
}

export interface AiCreateDatabaseRowsAction {
  type: "create_database_rows";
  database_page_id: string;
  rows: Array<{ title: string; properties?: Record<string, string | boolean> }>;
}

export interface AiAppendBlocksAction {
  type: "append_blocks";
  page_id: string;
  content_blocks: unknown[];
}

export type AiAction =
  | AiCreatePageAction
  | AiCreateSubpagesAction
  | AiCreateDatabaseAction
  | AiCreateDatabaseRowsAction
  | AiAppendBlocksAction;

export interface AiActionPlan {
  version: 1;
  summary: string;
  requires_confirmation: boolean;
  actions: AiAction[];
}

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiPlanRequest {
  prompt: string;
  provider: AiProviderId;
  model: AiModelId;
  current_page_id?: string | null;
  history?: AiChatTurn[];
}

export interface AiApplyResult {
  created_page_ids: string[];
  updated_page_ids: string[];
  primary_page_id: string | null;
}

export function isAllowedAiModel(value: string): value is AiModelId {
  return AI_MODELS.some((model) => model.id === value) || (value.includes("/") && value.endsWith(":free"));
}

export function aiModelLabel(modelId: AiModelId, models: readonly AiModelInfo[] = AI_MODELS): string {
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}

export function formatAiActionPreview(plan: AiActionPlan): string[] {
  return plan.actions.map((action) => {
    if (action.type === "create_page") return `Create page: ${action.title}`;
    if (action.type === "create_subpages") {
      const pageLabel = action.pages.length === 1 ? "subpage" : "subpages";
      return `Create ${action.pages.length} ${pageLabel} under current page`;
    }
    if (action.type === "create_database") {
      const rowCount = action.starter_rows?.length ?? 0;
      const rowLabel = rowCount === 1 ? "1 starter row" : `${rowCount} starter rows`;
      const propertyLabel = action.properties.length === 1 ? "1 property" : `${action.properties.length} properties`;
      return `Create database: ${action.title} with ${propertyLabel} and ${rowLabel}`;
    }
    if (action.type === "append_blocks") {
      const blockLabel = action.content_blocks.length === 1 ? "block" : "blocks";
      return `Append ${action.content_blocks.length} ${blockLabel} to an existing page`;
    }
    const rowLabel = action.rows.length === 1 ? "database row" : "database rows";
    return `Create ${action.rows.length} ${rowLabel}`;
  });
}

// Build a plan containing only the actions the user kept checked in the
// preview, preserving their original order. Lets the user apply part of a plan
// instead of all-or-nothing. Indices outside range are ignored.
export function selectAiActions(plan: AiActionPlan, selectedIndices: number[]): AiActionPlan {
  const selected = new Set(selectedIndices);
  return {
    ...plan,
    actions: plan.actions.filter((_, index) => selected.has(index)),
  };
}

export function canTrustedModeAutoApply(plan: AiActionPlan, trustedModeEnabled: boolean): boolean {
  if (!trustedModeEnabled || plan.requires_confirmation) return false;
  if (plan.actions.length === 0 || plan.actions.length > 12) return false;

  return plan.actions.every((action) =>
    action.type === "create_page" ||
    action.type === "create_subpages" ||
    action.type === "create_database" ||
    action.type === "create_database_rows"
  );
}

export async function getAiSettings(): Promise<AiSettings> {
  return await invoke<AiSettings>("get_ai_settings");
}

export async function getAiModels(): Promise<AiModelInfo[]> {
  return await invoke<AiModelInfo[]>("get_ai_models");
}

export async function updateAiSettings(settings: Pick<AiSettings, "provider" | "model" | "trusted_mode_enabled">): Promise<AiSettings> {
  return await invoke<AiSettings>("update_ai_settings", { settings });
}

export async function saveAiApiKey(provider: AiProviderId, apiKey: string): Promise<AiSettings> {
  return await invoke<AiSettings>("save_ai_api_key", { provider, apiKey });
}

export async function clearAiApiKey(provider: AiProviderId): Promise<AiSettings> {
  return await invoke<AiSettings>("clear_ai_api_key", { provider });
}

export async function generateAiActionPlan(request: AiPlanRequest): Promise<AiActionPlan> {
  return await invoke<AiActionPlan>("generate_ai_action_plan", { request });
}

// Streaming variant: the backend emits each token chunk over a Channel as it
// arrives, then resolves with the parsed plan. `onDelta` receives raw content
// fragments so the UI can show live progress instead of a blank spinner.
export async function generateAiActionPlanStreaming(
  request: AiPlanRequest,
  onDelta: (delta: string) => void
): Promise<AiActionPlan> {
  const channel = new Channel<string>();
  channel.onmessage = onDelta;
  return await invoke<AiActionPlan>("generate_ai_action_plan_streaming", { request, onEvent: channel });
}

// Abort the in-flight streaming generation backend-side so its HTTP request is
// dropped instead of running to completion after the user hits Stop.
export async function cancelAiGeneration(): Promise<void> {
  await invoke("cancel_ai_generation");
}

export async function applyAiActionPlan(plan: AiActionPlan): Promise<AiApplyResult> {
  return await invoke<AiApplyResult>("apply_ai_action_plan", { plan, createdAt: new Date().toISOString() });
}

export interface AiConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface AiChatStoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan?: AiActionPlan | null;
  created_at: string;
}

export interface AiConversationDetail {
  conversation: AiConversationSummary;
  messages: AiChatStoredMessage[];
}

export interface AiChatRequest {
  conversation_id: string;
  prompt: string;
  provider: AiProviderId;
  model: AiModelId;
  current_page_id?: string | null;
  regenerate?: boolean;
}

export async function listAiConversations(): Promise<AiConversationSummary[]> {
  return await invoke<AiConversationSummary[]>("list_ai_conversations");
}

export async function getAiConversation(id: string): Promise<AiConversationDetail> {
  return await invoke<AiConversationDetail>("get_ai_conversation", { id });
}

export async function createAiConversation(): Promise<AiConversationSummary> {
  return await invoke<AiConversationSummary>("create_ai_conversation", {
    createdAt: new Date().toISOString(),
  });
}

export async function renameAiConversation(id: string, title: string): Promise<void> {
  await invoke("rename_ai_conversation", { id, title, updatedAt: new Date().toISOString() });
}

export async function deleteAiConversation(id: string): Promise<void> {
  await invoke("delete_ai_conversation", { id });
}

export async function streamAiChatReply(
  request: AiChatRequest,
  onDelta: (delta: string) => void
): Promise<AiChatStoredMessage> {
  const channel = new Channel<string>();
  channel.onmessage = onDelta;
  return await invoke<AiChatStoredMessage>("stream_ai_chat_reply", {
    request,
    createdAt: new Date().toISOString(),
    onEvent: channel,
  });
}
