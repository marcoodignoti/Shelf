import { invoke } from "./desktop";
import { Page } from "./db";

export const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
export const BACKUP_MAX_PAGES = 5000;
export const BACKUP_MAX_ID_LENGTH = 512;
export const BACKUP_MAX_TITLE_LENGTH = 512;
export const BACKUP_MAX_TEXT_LENGTH = 1024 * 1024;
export const BACKUP_MAX_METADATA_LENGTH = 1024 * 1024;
export const BACKUP_MAX_ICON_LENGTH = 512;
export const BACKUP_MAX_COVER_URL_LENGTH = 4096;

export interface WorkspaceBackup {
  version: 1;
  exported_at: string;
  pages: Page[];
}

type Clock = () => string;
type IdFactory = () => string;

function isSizedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isOptionalSizedString(value: unknown, maxLength: number): value is string | null | undefined {
  return value === null || value === undefined || isSizedString(value, maxLength);
}

export function buildBackup(pages: Page[], exportedAt = new Date().toISOString()): WorkspaceBackup {
  return {
    version: 1,
    exported_at: exportedAt,
    pages,
  };
}

function isPage(value: unknown): value is Page {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;

  return (
    isSizedString(page.id, BACKUP_MAX_ID_LENGTH) &&
    isSizedString(page.title, BACKUP_MAX_TITLE_LENGTH) &&
    (isSizedString(page.parent_id, BACKUP_MAX_ID_LENGTH) || page.parent_id === null) &&
    isOptionalSizedString(page.content, BACKUP_MAX_TEXT_LENGTH) &&
    isOptionalSizedString(page.search_text, BACKUP_MAX_TEXT_LENGTH) &&
    isOptionalSizedString(page.icon, BACKUP_MAX_ICON_LENGTH) &&
    isOptionalSizedString(page.cover_url, BACKUP_MAX_COVER_URL_LENGTH) &&
    isOptionalSizedString(page.properties, BACKUP_MAX_METADATA_LENGTH) &&
    isOptionalSizedString(page.database_schema, BACKUP_MAX_METADATA_LENGTH) &&
    typeof page.is_deleted === "number" &&
    typeof page.is_favorite === "number" &&
    (typeof page.is_template === "number" || page.is_template === undefined) &&
    (typeof page.is_database === "number" || page.is_database === undefined) &&
    (typeof page.sort_order === "number" || page.sort_order === undefined) &&
    typeof page.created_at === "string" &&
    typeof page.updated_at === "string"
  );
}

export function parseBackup(raw: string): WorkspaceBackup {
  // Measure UTF-8 bytes, not UTF-16 code units, so the limit matches the on-disk
  // size for non-ASCII content.
  if (new TextEncoder().encode(raw).length > BACKUP_MAX_BYTES) {
    throw new Error("Backup file is too large");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Backup file is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Backup file has invalid shape");
  }

  const backup = parsed as Record<string, unknown>;

  if (backup.version !== 1) {
    throw new Error("Backup file version is not supported");
  }

  if (typeof backup.exported_at !== "string") {
    throw new Error("Backup file has invalid export timestamp");
  }

  if (!Array.isArray(backup.pages) || backup.pages.length > BACKUP_MAX_PAGES || !backup.pages.every(isPage)) {
    throw new Error("Backup file has invalid pages");
  }

  return {
    version: 1,
    exported_at: backup.exported_at,
    pages: backup.pages.map((page) => ({
      ...page,
      search_text: page.search_text ?? null,
      is_template: page.is_template ?? 0,
      sort_order: page.sort_order ?? 0,
    })),
  };
}

export async function exportWorkspaceBackup(path: string, exportedAt = new Date().toISOString()): Promise<number> {
  return await invoke<number>("export_backup", { path, exportedAt });
}

export async function importWorkspaceBackup(path: string, importedAt = new Date().toISOString()): Promise<number> {
  return await invoke<number>("import_backup", { path, importedAt });
}

export function prepareImportedPages(
  pages: Page[],
  clock: Clock = () => new Date().toISOString(),
  idFactory: IdFactory = () => crypto.randomUUID()
): Page[] {
  const idMap = new Map<string, string>();

  for (const page of pages) {
    idMap.set(page.id, `${idFactory()}-${idMap.size + 1}`);
  }

  return pages.map((page) => {
    const now = clock();
    return {
      ...page,
      id: idMap.get(page.id) || page.id,
      parent_id: page.parent_id ? (idMap.get(page.parent_id) ?? null) : null,
      is_deleted: 0,
      is_template: 0,
      created_at: now,
      updated_at: now,
    };
  });
}
