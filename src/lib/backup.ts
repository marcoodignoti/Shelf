import { Page } from "./db";

export interface WorkspaceBackup {
  version: 1;
  exported_at: string;
  pages: Page[];
}

type Clock = () => string;
type IdFactory = () => string;

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
    typeof page.id === "string" &&
    typeof page.title === "string" &&
    (typeof page.parent_id === "string" || page.parent_id === null) &&
    (typeof page.content === "string" || page.content === null) &&
    (typeof page.search_text === "string" || page.search_text === null || page.search_text === undefined) &&
    (typeof page.icon === "string" || page.icon === null) &&
    (typeof page.cover_url === "string" || page.cover_url === null) &&
    (typeof page.properties === "string" || page.properties === null || page.properties === undefined) &&
    (typeof page.database_schema === "string" || page.database_schema === null || page.database_schema === undefined) &&
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

  if (!Array.isArray(backup.pages) || !backup.pages.every(isPage)) {
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
