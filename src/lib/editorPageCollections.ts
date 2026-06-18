import type { Page } from "./db";
import { moveTargetPages } from "./pageTree";

export function databaseParentPageForEditor(pages: Page[], page: Page): Page | null {
  return pages.find((candidate) => candidate.id === page.parent_id && candidate.is_database === 1) ?? null;
}

export function templatePagesForEditor(pages: Page[]): Page[] {
  return pages.filter((candidate) => candidate.is_template === 1);
}

export function movableEditorPageTargets(pages: Page[], pageId: string, query: string): Page[] {
  const normalizedQuery = query.trim().toLowerCase();
  const targets = moveTargetPages(pages, pageId);
  if (!normalizedQuery) return targets;
  return targets.filter((candidate) => (candidate.title || "Untitled").toLowerCase().includes(normalizedQuery));
}
