import { Page } from "./db";

export const HOME_PAGE_ID = "__opennotion_home__";

export function resolveCurrentPageId(pages: Page[], currentPageId: string | null): string {
  if (currentPageId === HOME_PAGE_ID) return HOME_PAGE_ID;
  if (currentPageId && pages.some((page) => page.id === currentPageId)) return currentPageId;
  return pages[0]?.id || HOME_PAGE_ID;
}
