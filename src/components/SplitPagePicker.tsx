import { useEffect, useRef, useState } from "react";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { searchPages, type SearchResult } from "../lib/db";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";
import { PageSearchResults } from "./PageSearchResults";

export function SplitPagePicker({
  currentPageId,
  onChoose,
}: {
  currentPageId: string;
  onChoose: (id: string) => void;
}) {
  const t = useT();
  const pages = useAppStore((s) => s.pages);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }
    setIsSearching(true);
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      searchPages(query)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) setSearchError(t("commandPalette.searchFailed"));
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, t]);

  return (
    <div className="on-command-panel flex flex-col">
      <div className="on-command-input-row">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={t("commandPalette.searchSplit")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="on-command-results overflow-y-auto" style={{ maxHeight: 320 }}>
        <PageSearchResults
          query={query}
          pages={pages}
          searchResults={searchResults}
          onSelectPage={onChoose}
          isSearching={isSearching}
          searchError={searchError}
          disabledPageId={currentPageId}
          alreadyOpenKey="editor.alreadyOpen"
          emptyKey="commandPalette.noPagesYet"
          noResultsKey="commandPalette.noResults"
          searchingKey="commandPalette.searching"
        />
      </div>
    </div>
  );
}
