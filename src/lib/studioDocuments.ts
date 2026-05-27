import { StudioDocument, StudioPanelLayout } from "./studio";

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

export function normalizePanelLayout(value: string): StudioPanelLayout {
  return value === "note-left" ? "note-left" : "pdf-left";
}
