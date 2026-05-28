import { StudioDocument, StudioPanelLayout } from "./studio";

export const DEFAULT_STUDIO_PROJECT_ID = "studio-inbox";
export const DEFAULT_STUDIO_PROJECT_NAME = "Inbox";

export type ProjectableStudioDocument = StudioDocument & {
  project_id?: string | null;
  project_name?: string | null;
  project_parent_id?: string | null;
  project_sort_order?: number | null;
};

export type StudioProject = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

export type StudioProjectGroup = {
  project: StudioProject;
  documents: ProjectableStudioDocument[];
};

export function recentStudioDocuments(documents: StudioDocument[], limit = 6): StudioDocument[] {
  return [...documents]
    .sort((first, second) => new Date(second.last_opened_at).getTime() - new Date(first.last_opened_at).getTime())
    .slice(0, limit);
}

export function allStudioDocuments(documents: StudioDocument[]): StudioDocument[] {
  return [...documents].sort((first, second) => first.title.localeCompare(second.title));
}

export function remainingStudioDocuments(
  documents: StudioDocument[],
  excludedDocuments: StudioDocument[]
): StudioDocument[] {
  const excludedIds = new Set(excludedDocuments.map((document) => document.id));
  return allStudioDocuments(documents).filter((document) => !excludedIds.has(document.id));
}

export function studioDocumentMetadata(document: StudioDocument): string {
  const openedAt = new Date(document.last_opened_at);
  const monthLabels = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const date = Number.isNaN(openedAt.getTime())
    ? "data sconosciuta"
    : `${openedAt.getDate()} ${monthLabels[openedAt.getMonth()]} ${openedAt.getFullYear()}`;

  return `${document.original_filename} · ${date}`;
}

function cleanProjectValue(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function projectSortOrder(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : Number.MAX_SAFE_INTEGER;
}

export function studioProjectForDocument(document: ProjectableStudioDocument): StudioProject {
  const projectId = cleanProjectValue(document.project_id);
  const projectName = cleanProjectValue(document.project_name);

  if (!projectId) {
    return {
      id: DEFAULT_STUDIO_PROJECT_ID,
      name: DEFAULT_STUDIO_PROJECT_NAME,
      parent_id: null,
      sort_order: Number.MAX_SAFE_INTEGER,
    };
  }

  return {
    id: projectId,
    name: projectName ?? projectId,
    parent_id: cleanProjectValue(document.project_parent_id),
    sort_order: projectSortOrder(document.project_sort_order),
  };
}

export function groupStudioDocumentsByProject(documents: ProjectableStudioDocument[]): StudioProjectGroup[] {
  const groups = new Map<string, StudioProjectGroup>();

  for (const document of documents) {
    const project = studioProjectForDocument(document);
    const existingGroup = groups.get(project.id);

    if (existingGroup) {
      existingGroup.documents.push(document);
    } else {
      groups.set(project.id, { project, documents: [document] });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      documents: allStudioDocuments(group.documents),
    }))
    .sort((first, second) => {
      if (first.project.sort_order !== second.project.sort_order) {
        return first.project.sort_order - second.project.sort_order;
      }
      return first.project.name.localeCompare(second.project.name);
    });
}

export function normalizePanelLayout(value: string): StudioPanelLayout {
  return value === "note-left" ? "note-left" : "pdf-left";
}
