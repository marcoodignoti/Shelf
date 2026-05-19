import { Page } from "./db";

function descendantIds(pages: Page[], pageId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = [pageId];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    for (const page of pages) {
      if (page.parent_id === current && !descendants.has(page.id)) {
        descendants.add(page.id);
        pending.push(page.id);
      }
    }
  }

  return descendants;
}

export function moveTargetPages(pages: Page[], pageId: string): Page[] {
  const blockedIds = descendantIds(pages, pageId);
  blockedIds.add(pageId);

  return pages.filter((page) => !blockedIds.has(page.id));
}

function sortForSidebar(pages: Page[]): Page[] {
  return [...pages].sort((first, second) => {
    if (first.sort_order !== second.sort_order) {
      return first.sort_order - second.sort_order;
    }

    return second.created_at.localeCompare(first.created_at);
  });
}

export function childPagesForParent(pages: Page[], parentId: string): Page[] {
  return sortForSidebar(pages).filter((page) => page.parent_id === parentId);
}

export function visiblePageIds(pages: Page[], expandedIds: Set<string>): string[] {
  const sortedPages = sortForSidebar(pages);
  const ids: string[] = [];

  const appendChildren = (parentId: string | null) => {
    for (const page of sortedPages) {
      if (page.parent_id !== parentId) continue;

      ids.push(page.id);

      if (expandedIds.has(page.id)) {
        appendChildren(page.id);
      }
    }
  };

  appendChildren(null);

  return ids;
}
