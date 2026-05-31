import { invoke } from "@tauri-apps/api/core";
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

export type AiAction =
  | AiCreatePageAction
  | AiCreateSubpagesAction
  | AiCreateDatabaseAction
  | AiCreateDatabaseRowsAction;

export interface AiActionPlan {
  version: 1;
  summary: string;
  requires_confirmation: boolean;
  actions: AiAction[];
}

export interface AiPlanRequest {
  prompt: string;
  provider: AiProviderId;
  model: AiModelId;
  current_page_id?: string | null;
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
    const rowLabel = action.rows.length === 1 ? "database row" : "database rows";
    return `Create ${action.rows.length} ${rowLabel}`;
  });
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

export async function applyAiActionPlan(plan: AiActionPlan): Promise<AiApplyResult> {
  return await invoke<AiApplyResult>("apply_ai_action_plan", { plan, createdAt: new Date().toISOString() });
}
