import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Search, FileText, Star } from 'lucide-react';
import { SearchResult, searchPages } from '../lib/db';
import { pageContentPreview } from '../lib/pageContent';
import { splitSearchMatch } from '../lib/searchDisplay';
import { commandPaletteSections, CommandPalettePage } from '../lib/commandPaletteSections';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';

function HighlightedText({
  text,
  query,
  selected
}: {
  text: string;
  query: string;
  selected: boolean;
}) {
  return (
    <>
      {splitSearchMatch(text, query).map((part, index) => (
        <span
          key={`${part.text}-${index}`}
          className={part.matched ? selected ? 'rounded bg-primary/10 px-0.5 text-foreground' : 'rounded bg-primary/10 px-0.5 text-foreground' : undefined}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const { pages, setCurrentPageId, isCommandPaletteOpen, openCommandPalette, closeCommandPalette } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openCommandPalette]);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      closeOpenOverlays();
      setQuery('');
      setSelectedIndex(0);
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeCommandPalette);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeCommandPalette);
  }, [closeCommandPalette, isCommandPaletteOpen]);

  useEffect(() => {
    if (!isCommandPaletteOpen || !query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      searchPages(query)
        .then((results) => {
          if (cancelled) return;
          setSearchResults(results);
          setSelectedIndex(0);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error('Search failed:', error);
          setSearchError('Search failed.');
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [isCommandPaletteOpen, query]);

  const sections = commandPaletteSections({ query, pages, searchResults });
  const flattenedPages: CommandPalettePage[] = sections.flatMap((section) => section.pages);

  const handleSelect = (id: string) => {
    setCurrentPageId(id);
    closeCommandPalette();
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flattenedPages.length === 0) return;
      setSelectedIndex(prev => (prev + 1) % flattenedPages.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flattenedPages.length === 0) return;
      setSelectedIndex(prev => (prev - 1 + flattenedPages.length) % flattenedPages.length);
    } else if (e.key === 'Enter' && flattenedPages.length > 0) {
      e.preventDefault();
      handleSelect(flattenedPages[selectedIndex].id);
    }
  };

  if (!isCommandPaletteOpen) return null;

  return (
    <div 
      className="on-modal-overlay items-start justify-center pt-[20vh]"
      onClick={closeCommandPalette}
    >
      <div 
        className="on-modal-panel flex w-[500px] max-w-[90vw] flex-col"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleModalKeyDown}
      >
        <div className="flex items-center border-b border-border px-4 py-3">
          <Search className="w-5 h-5 text-muted-foreground mr-3" />
          <input 
            ref={inputRef}
            className="flex-1 border-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
            placeholder="Search pages..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <div className="on-kbd">ESC</div>
        </div>
        
        <div className="on-scroll-fade on-scroll-fade-popover max-h-[380px] overflow-y-auto p-2">
          {isSearching ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          ) : searchError ? (
            <div className="px-3 py-6 text-center text-sm text-destructive">
              {searchError}
            </div>
          ) : flattenedPages.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              {query.trim() ? 'No results.' : 'No pages yet.'}
            </div>
          ) : (
            sections.map((section) => {
              let sectionStartIndex = 0;
              for (const previousSection of sections) {
                if (previousSection === section) break;
                sectionStartIndex += previousSection.pages.length;
              }

              return (
                <div key={section.title} className="mb-2 last:mb-0">
                  <div className="on-section-label flex items-center gap-1.5 pb-1 pt-1">
                    {section.title === 'Favorites' && <Star className="h-3 w-3 fill-current" />}
                    {section.title}
                  </div>
                  {section.pages.map((page, index) => {
                    const absoluteIndex = sectionStartIndex + index;
                    const preview = page.matched_content
                      ? pageContentPreview(page.matched_content, query)
                      : null;
                    const title = page.title || 'Untitled';
                    const isSelected = absoluteIndex === selectedIndex;

                    return (
                      <div
                        key={`${section.title}-${page.id}`}
                        className={`flex cursor-pointer items-start rounded-md px-3 py-2 text-sm transition-colors ${isSelected ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent hover:text-foreground'}`}
                        onClick={() => handleSelect(page.id)}
                        onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                      >
                        {page.icon ? (
                          <span className="w-4 h-4 mr-3 mt-0.5 flex items-center justify-center text-xs">{page.icon}</span>
                        ) : (
                          <FileText className="w-4 h-4 mr-3 mt-0.5 flex-shrink-0 opacity-50" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate">
                            <HighlightedText text={title} query={query} selected={isSelected} />
                          </div>
                          {preview && (
                            <div className="truncate text-xs text-muted-foreground">
                              <HighlightedText text={preview} query={query} selected={isSelected} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
