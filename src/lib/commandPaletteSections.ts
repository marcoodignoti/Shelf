import { Page, SearchResult } from "./db";
import { favoritePages, recentPages } from "./homeSections";

export type CommandPalettePage = SearchResult;

export type CommandPaletteSection = {
  title: string;
  pages: CommandPalettePage[];
};

function asPalettePages(pages: Page[]): CommandPalettePage[] {
  return pages.map((page) => ({ ...page, matched_content: null }));
}

export function commandPaletteSections({
  query,
  pages,
  searchResults,
}: {
  query: string;
  pages: Page[];
  searchResults: SearchResult[];
}): CommandPaletteSection[] {
  if (query.trim()) {
    return [{ title: "Search results", pages: searchResults }];
  }

  const favorites = asPalettePages(favoritePages(pages));
  const recent = asPalettePages(recentPages(pages));

  return [
    ...(favorites.length > 0 ? [{ title: "Favorites", pages: favorites }] : []),
    { title: "Recent", pages: recent },
  ];
}
