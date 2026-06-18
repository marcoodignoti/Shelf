import type { Page } from "./db";
import type { StudioDocumentPageLink } from "./studio";

export function selectActiveStudioLinkedPage({
  selectedId,
  primaryPageId,
  pages,
  links,
  note,
}: {
  selectedId: string | null;
  primaryPageId: string;
  pages: Page[];
  links: StudioDocumentPageLink[];
  note: Page | null;
}): Page | null {
  const activeId = selectedId ?? primaryPageId;
  return (
    pages.find((page) => page.id === activeId) ??
    links.find((link) => link.page_id === activeId)?.page ??
    note
  );
}

export function buildVisibleStudioLinkedPageLinks(
  documentId: string,
  links: StudioDocumentPageLink[],
  note: Page | null,
  primaryNoteLabel: string,
): StudioDocumentPageLink[] {
  if (links.length > 0) return links;
  if (!note) return [];
  return [
    {
      id: `fallback-${documentId}`,
      document_id: documentId,
      page_id: note.id,
      pdf_page: null,
      label: primaryNoteLabel,
      sort_order: 0,
      created_at: note.created_at,
      updated_at: note.updated_at,
      page: note,
    },
  ];
}

export function filterExistingStudioPageCandidates({
  pages,
  linkedPageIds,
  query,
  untitledLabel,
  limit = 8,
}: {
  pages: Page[];
  linkedPageIds: Set<string>;
  query: string;
  untitledLabel: string;
  limit?: number;
}): Page[] {
  const normalizedQuery = query.trim().toLowerCase();
  return pages
    .filter((candidate) => candidate.is_deleted === 0 && !linkedPageIds.has(candidate.id))
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      return (candidate.title || untitledLabel).toLowerCase().includes(normalizedQuery);
    })
    .slice(0, limit);
}

export function preferredStudioLinkedPageId(
  links: StudioDocumentPageLink[],
  primaryPageId: string,
  currentId: string | null,
): string {
  const hasCurrent = currentId ? links.some((link) => link.page_id === currentId) : false;
  const firstLinkedNote = links.find((link) => link.page_id !== primaryPageId)?.page_id ?? null;
  if (hasCurrent && currentId && currentId !== primaryPageId) return currentId;
  if (firstLinkedNote) return firstLinkedNote;
  if (hasCurrent && currentId) return currentId;
  return links[0]?.page_id ?? primaryPageId;
}
