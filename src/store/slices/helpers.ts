import type { Page } from '../../lib/db';

/** Collects the root page id and all of its descendants by parent_id linkage. */
export function pageTreeIds(pages: Page[], rootId: string): Set<string> {
  const childrenMap = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parent_id) {
      const list = childrenMap.get(page.parent_id);
      if (list) {
        list.push(page.id);
      } else {
        childrenMap.set(page.parent_id, [page.id]);
      }
    }
  }

  const ids = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const children = childrenMap.get(current) ?? [];
    for (const childId of children) {
      if (!ids.has(childId)) {
        ids.add(childId);
        queue.push(childId);
      }
    }
  }
  return ids;
}

export function mergePageMetadataWithHydratedContent(nextPages: Page[], previousPages: Page[]): Page[] {
  const previousById = new Map(previousPages.map((page) => [page.id, page]));
  return nextPages.map((page) => {
    if (page.content_loaded !== 0) return page;
    const previous = previousById.get(page.id);
    if (!previous || previous.content_loaded === 0) return page;
    return {
      ...page,
      content: previous.content,
      search_text: previous.search_text,
      content_loaded: previous.content_loaded,
    };
  });
}

export function logStoreError(error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(error);
  }
}
