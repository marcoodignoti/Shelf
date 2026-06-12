import type { StudioDocument, StudioDocumentPageLink } from "./studio";

export type PageStudioContext = {
  document: StudioDocument;
  link: StudioDocumentPageLink;
};

export function buildPageStudioContexts(
  documents: StudioDocument[],
  links: StudioDocumentPageLink[]
): Map<string, PageStudioContext[]> {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const contextsByPageId = new Map<string, PageStudioContext[]>();

  for (const link of links) {
    const document = documentsById.get(link.document_id);
    if (!document) continue;

    const contexts = contextsByPageId.get(link.page_id) ?? [];
    contexts.push({ document, link });
    contextsByPageId.set(link.page_id, contexts);
  }

  for (const contexts of contextsByPageId.values()) {
    contexts.sort((first, second) => {
      if (first.document.title !== second.document.title) {
        return first.document.title.localeCompare(second.document.title);
      }
      return first.link.sort_order - second.link.sort_order;
    });
  }

  return contextsByPageId;
}
