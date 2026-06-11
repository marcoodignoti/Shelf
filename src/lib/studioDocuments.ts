import type { Locale } from "./i18n";
import { StudioDocument, StudioPanelLayout, StudioProject } from "./studio";

export const DEFAULT_STUDIO_PROJECT_ID = "studio-inbox";
export const DEFAULT_STUDIO_PROJECT_NAME = "Inbox";

export type ProjectableStudioDocument = StudioDocument & {
  project_id?: string | null;
};

export type StudioProjectGroup<TDocument extends ProjectableStudioDocument = ProjectableStudioDocument> = {
  project: StudioProject;
  documents: TDocument[];
};

export function recentStudioDocuments(documents: StudioDocument[], limit = 6): StudioDocument[] {
  return [...documents]
    .sort((first, second) => new Date(second.last_opened_at).getTime() - new Date(first.last_opened_at).getTime())
    .slice(0, limit);
}

export function allStudioDocuments<TDocument extends StudioDocument>(documents: TDocument[]): TDocument[] {
  return [...documents].sort((first, second) => first.title.localeCompare(second.title));
}

export function remainingStudioDocuments(
  documents: StudioDocument[],
  excludedDocuments: StudioDocument[]
): StudioDocument[] {
  const excludedIds = new Set(excludedDocuments.map((document) => document.id));
  return allStudioDocuments(documents).filter((document) => !excludedIds.has(document.id));
}

export function studioDocumentMetadata(document: StudioDocument, locale: Locale = "en", unknownDateLabel = "unknown date"): string {
  const openedAt = new Date(document.last_opened_at);
  const date = Number.isNaN(openedAt.getTime())
    ? unknownDateLabel
    : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(openedAt);

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

function compareStudioProjectGroups<TDocument extends ProjectableStudioDocument>(
  first: StudioProjectGroup<TDocument>,
  second: StudioProjectGroup<TDocument>
): number {
  if (first.project.sort_order !== second.project.sort_order) {
    return first.project.sort_order - second.project.sort_order;
  }
  return first.project.name.localeCompare(second.project.name);
}

function orderStudioProjectGroups<TDocument extends ProjectableStudioDocument>(
  groups: StudioProjectGroup<TDocument>[]
): StudioProjectGroup<TDocument>[] {
  const groupsById = new Map(groups.map((group) => [group.project.id, group]));
  const childrenByParentId = new Map<string | null, StudioProjectGroup<TDocument>[]>();

  for (const group of groups) {
    const parentId = cleanProjectValue(group.project.parent_id);
    const normalizedParentId =
      parentId && parentId !== group.project.id && groupsById.has(parentId) ? parentId : null;
    const siblings = childrenByParentId.get(normalizedParentId) ?? [];
    siblings.push(group);
    childrenByParentId.set(normalizedParentId, siblings);
  }

  const orderedGroups: StudioProjectGroup<TDocument>[] = [];
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

export function groupStudioDocumentsByProject<TDocument extends ProjectableStudioDocument>(
  documents: TDocument[],
  projects: StudioProject[] = []
): StudioProjectGroup<TDocument>[] {
  const groups = new Map<string, StudioProjectGroup<TDocument>>();

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
