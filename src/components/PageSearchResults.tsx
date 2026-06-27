import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import type { Page, SearchResult } from "../lib/db";
import { pageContentPreview } from "../lib/pageContent";
import { splitSearchMatch } from "../lib/searchDisplay";
import { commandPaletteSections } from "../lib/commandPaletteSections";
import { useT, type TranslationKey } from "../lib/i18n";

function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitSearchMatch(text, query).map((part, index) => (
        <span
          key={`${part.text}-${index}`}
          className={part.matched ? "rounded bg-primary/10 px-0.5 text-foreground" : undefined}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

export function PageSearchResults({
  query,
  pages,
  searchResults,
  onSelectPage,
  isSearching,
  searchError,
  disabledPageId,
  alreadyOpenKey,
  emptyKey,
  noResultsKey,
  searchingKey,
}: {
  query: string;
  pages: Page[];
  searchResults: SearchResult[];
  onSelectPage: (id: string) => void;
  isSearching: boolean;
  searchError: string | null;
  disabledPageId?: string;
  alreadyOpenKey?: TranslationKey;
  emptyKey: TranslationKey;
  noResultsKey: TranslationKey;
  searchingKey: TranslationKey;
}) {
  const t = useT();
  const sections = commandPaletteSections({ query, pages, searchResults });

  if (isSearching) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t(searchingKey)}</div>;
  }
  if (searchError) {
    return <div className="px-4 py-8 text-center text-sm text-destructive">{searchError}</div>;
  }
  if (sections.length === 0 || sections.every((s) => s.pages.length === 0)) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {query.trim() ? t(noResultsKey) : t(emptyKey)}
      </div>
    );
  }

  return (
    <>
      {sections.map((section) => (
        <div key={section.titleKey} className="on-command-section">
          <div className="on-command-section-title flex items-center gap-1.5">
            {section.titleKey === "commandPalette.favorites" && <Star className="h-3 w-3 fill-current" />}
            {t(section.titleKey)}
          </div>
          {section.pages.map((page) => {
            const isDisabled = disabledPageId != null && page.id === disabledPageId;
            const preview = page.matched_content ? pageContentPreview(page.matched_content, query) : null;
            const title = page.title || t("sidebar.untitled");
            return (
              <button
                type="button"
                key={`${section.titleKey}-${page.id}`}
                className={`on-command-item ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
                disabled={isDisabled}
                onClick={() => !isDisabled && onSelectPage(page.id)}
              >
                {page.icon ? (
                  <span className="flex h-4 w-4 items-center justify-center text-xs">{page.icon}</span>
                ) : (
                  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <HighlightedText text={title} query={query} />
                  </span>
                  {isDisabled && alreadyOpenKey ? (
                    <span className="block truncate text-xs text-muted-foreground">{t(alreadyOpenKey)}</span>
                  ) : preview ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      <HighlightedText text={preview} query={query} />
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
