import { StudioDocument, StudioPanelLayout, StudioProject } from "./studio";

export const DEFAULT_STUDIO_PROJECT_ID = "studio-inbox";
export const DEFAULT_STUDIO_PROJECT_NAME = "Inbox";

export type ProjectableStudioDocument = StudioDocument & {
  project_id?: string | null;
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

const DEFAULT_STUDIO_PROJECT: StudioProject = {
  id: DEFAULT_STUDIO_PROJECT_ID,
  name: DEFAULT_STUDIO_PROJECT_NAME,
  parent_id: null,
  sort_order: Number.MAX_SAFE_INTEGER,
  created_at: "",
  updated_at: "",
};

export function studioProjectForDocument(
  document: ProjectableStudioDocument,
  projects: StudioProject[] = []
): StudioProject {
  const projectId = cleanProjectValue(document.project_id);
  if (!projectId) return DEFAULT_STUDIO_PROJECT;

  return projects.find((project) => project.id === projectId) ?? {
    id: projectId,
    name: projectId,
    parent_id: null,
    sort_order: Number.MAX_SAFE_INTEGER - 1,
    created_at: "",
    updated_at: "",
  };
}

export function groupStudioDocumentsByProject(
  documents: ProjectableStudioDocument[],
  projects: StudioProject[] = []
): StudioProjectGroup[] {
  const groups = new Map<string, StudioProjectGroup>();

  for (const project of projects) {
    groups.set(project.id, { project, documents: [] });
  }

  for (const document of documents) {
    const project = studioProjectForDocument(document, projects);
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
