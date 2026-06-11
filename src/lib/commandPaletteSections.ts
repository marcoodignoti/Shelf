import { Page, SearchResult } from "./db";
import { favoritePages, recentPages } from "./homeSections";
import type { TranslationKey } from "./i18n";

export type CommandPalettePage = SearchResult;

export type CommandPaletteSection = {
  titleKey: TranslationKey;
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
    return [{ titleKey: "commandPalette.searchResults", pages: searchResults }];
  }

  const favorites = asPalettePages(favoritePages(pages));
  const recent = asPalettePages(recentPages(pages));

  return [
    ...(favorites.length > 0 ? [{ titleKey: "commandPalette.favorites" as TranslationKey, pages: favorites }] : []),
    { titleKey: "commandPalette.recent" as TranslationKey, pages: recent },
  ];
}
