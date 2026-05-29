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

export function studioProjectDepth(project: StudioProject, projects: StudioProject[]): number {
  let depth = 0;
  let parentId = cleanProjectValue(project.parent_id);
  const seen = new Set<string>([project.id]);

  while (parentId) {
    if (seen.has(parentId)) return depth;
    const parent = projects.find((candidate) => candidate.id === parentId);
    if (!parent) return depth;
    seen.add(parent.id);
    depth += 1;
    parentId = cleanProjectValue(parent.parent_id);
  }

  return depth;
}

function compareStudioProjectGroups(first: StudioProjectGroup, second: StudioProjectGroup): number {
  if (first.project.sort_order !== second.project.sort_order) {
    return first.project.sort_order - second.project.sort_order;
  }
  return first.project.name.localeCompare(second.project.name);
}

function orderStudioProjectGroups(groups: StudioProjectGroup[]): StudioProjectGroup[] {
  const groupsById = new Map(groups.map((group) => [group.project.id, group]));
  const childrenByParentId = new Map<string | null, StudioProjectGroup[]>();

  for (const group of groups) {
    const parentId = cleanProjectValue(group.project.parent_id);
    const normalizedParentId =
      parentId && parentId !== group.project.id && groupsById.has(parentId) ? parentId : null;
    const siblings = childrenByParentId.get(normalizedParentId) ?? [];
    siblings.push(group);
    childrenByParentId.set(normalizedParentId, siblings);
  }

  const orderedGroups: StudioProjectGroup[] = [];
  const visitedProjectIds = new Set<string>();

  const visitChildren = (parentId: string | null) => {
    const children = [...(childrenByParentId.get(parentId) ?? [])].sort(compareStudioProjectGroups);
    for (const child of children) {
      if (visitedProjectIds.has(child.project.id)) continue;
      visitedProjectIds.add(child.project.id);
      orderedGroups.push(child);
      visitChildren(child.project.id);
    }
  };

  visitChildren(null);

  for (const group of [...groups].sort(compareStudioProjectGroups)) {
    if (visitedProjectIds.has(group.project.id)) continue;
    visitedProjectIds.add(group.project.id);
    orderedGroups.push(group);
    visitChildren(group.project.id);
  }

  return orderedGroups;
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

  return orderStudioProjectGroups([...groups.values()]
    .map((group) => ({
      ...group,
      documents: allStudioDocuments(group.documents),
    })));
}

export function normalizePanelLayout(value: string): StudioPanelLayout {
  return value === "note-left" ? "note-left" : "pdf-left";
}
