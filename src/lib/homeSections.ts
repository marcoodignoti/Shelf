import { Page } from "./db";

function notePages(pages: Page[]): Page[] {
  return pages.filter((page) => page.page_kind === "note");
}

export function recentPages(pages: Page[], limit = 6): Page[] {
  return notePages(pages)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, limit);
}

export function favoritePages(pages: Page[]): Page[] {
  return notePages(pages).filter((page) => page.is_favorite === 1);
}
