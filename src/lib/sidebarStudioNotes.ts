import type { Page } from "./db";
import type { StudioDocument, StudioDocumentPageLink } from "./studio";

export type StudioNoteEntry = {
  page: Page;
  link: StudioDocumentPageLink | null;
};

export type StudioNoteDocument = StudioDocument & {
  noteEntries: StudioNoteEntry[];
};

export function buildStudioNoteDocuments(
  documents: StudioDocument[],
  links: StudioDocumentPageLink[],
  studioNotePages: Page[]
): { documents: StudioNoteDocument[]; linkedPageIds: Set<string> } {
  const studioNoteById = new Map(studioNotePages.map((page) => [page.id, page]));
  const linksByDocumentId = new Map<string, StudioDocumentPageLink[]>();
  const linkedPageIds = new Set<string>();

  for (const link of links) {
    if (link.page.page_kind !== "studio_note") continue;
    linkedPageIds.add(link.page_id);
    const documentLinks = linksByDocumentId.get(link.document_id) ?? [];
    documentLinks.push(link);
    linksByDocumentId.set(link.document_id, documentLinks);
  }

  return {
    linkedPageIds,
    documents: documents
      .map((document) => {
        const linkedEntries = (linksByDocumentId.get(document.id) ?? [])
          .map((link) => ({ page: link.page, link }));
        const hasPrimaryLink = linkedEntries.some((entry) => entry.page.id === document.note_page_id);
        const primaryNote = studioNoteById.get(document.note_page_id);
        const entries = hasPrimaryLink || !primaryNote
          ? linkedEntries
          : [{ page: primaryNote, link: null }, ...linkedEntries];

        if (primaryNote) linkedPageIds.add(primaryNote.id);
        if (entries.length === 0) return null;
        return { ...document, noteEntries: entries };
      })
      .filter((document): document is StudioNoteDocument => Boolean(document)),
  };
}
