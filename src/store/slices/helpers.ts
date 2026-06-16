import type { Page } from '../../lib/db';

/** Collects the root page id and all of its descendants by parent_id linkage. */
export function pageTreeIds(pages: Page[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of pages) {
      if (page.parent_id && ids.has(page.parent_id) && !ids.has(page.id)) {
        ids.add(page.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function logStoreError(error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(error);
  }
}
