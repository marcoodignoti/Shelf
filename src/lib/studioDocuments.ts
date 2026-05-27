import { StudioDocument, StudioPanelLayout } from "./studio";

export function recentStudioDocuments(documents: StudioDocument[], limit = 6): StudioDocument[] {
  return [...documents]
    .sort((first, second) => new Date(second.last_opened_at).getTime() - new Date(first.last_opened_at).getTime())
    .slice(0, limit);
}

export function allStudioDocuments(documents: StudioDocument[]): StudioDocument[] {
  return [...documents].sort((first, second) => first.title.localeCompare(second.title));
}

export function normalizePanelLayout(value: string): StudioPanelLayout {
  return value === "note-left" ? "note-left" : "pdf-left";
}
