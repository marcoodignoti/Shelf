import type { Page } from "./types";

function buildChildrenMap(pages: Page[]): Map<string | null, Page[]> {
  const map = new Map<string | null, Page[]>();
  for (const page of pages) {
    const key = page.parent_id;
    const list = map.get(key);
    if (list) {
      list.push(page);
    } else {
      map.set(key, [page]);
    }
  }
  return map;
}

function descendantIds(pages: Page[], pageId: string): Set<string> {
  const childrenMap = buildChildrenMap(pages);
  const descendants = new Set<string>();
  const pending = [pageId];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id);
        pending.push(child.id);
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
  const children = pages.filter((page) => page.parent_id === parentId);
  return sortForSidebar(children);
}

export function visiblePageIds(pages: Page[], expandedIds: Set<string>): string[] {
  const childrenMap = buildChildrenMap(pages);
  const sortedChildrenMap = new Map<string | null, Page[]>();

  for (const [parentId, children] of childrenMap.entries()) {
    sortedChildrenMap.set(parentId, sortForSidebar(children));
  }

  const ids: string[] = [];

  const appendChildren = (parentId: string | null) => {
    const children = sortedChildrenMap.get(parentId) ?? [];
    for (const page of children) {
      ids.push(page.id);

      if (expandedIds.has(page.id)) {
        appendChildren(page.id);
      }
    }
  };

  appendChildren(null);

  return ids;
}
