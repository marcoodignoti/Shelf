import { Page } from "./db";

export const HOME_PAGE_ID = "__opennotion_home__";

export function resolveCurrentPageId(pages: Page[], currentPageId: string | null): string {
  if (currentPageId === HOME_PAGE_ID) return HOME_PAGE_ID;
  if (currentPageId && pages.some((page) => page.id === currentPageId)) return currentPageId;
  return pages[0]?.id || HOME_PAGE_ID;
}

export function resolveCurrentPageIdAfterDeletion(
  pages: Page[],
  currentPageId: string | null,
  deletedPageId: string,
  deletedIds: Set<string>,
  previousPages: Page[]
): string {
  if (currentPageId && deletedIds.has(currentPageId)) {
    const deletedPage = previousPages.find((page) => page.id === deletedPageId);
    const parentId = deletedPage?.parent_id;
    if (parentId && pages.some((page) => page.id === parentId)) {
      return parentId;
    }
  }
  return resolveCurrentPageId(pages, currentPageId);
}

