import { Page } from "./db";

export function pageBreadcrumb(pages: Page[], pageId: string): Page[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const current = byId.get(pageId);
  if (!current) return [];

  const trail: Page[] = [current];
  const seen = new Set([current.id]);
  let parentId = current.parent_id;

  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || seen.has(parent.id)) break;

    trail.unshift(parent);
    seen.add(parent.id);
    parentId = parent.parent_id;
  }

  return trail;
}
