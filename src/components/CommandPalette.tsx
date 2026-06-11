import { useState, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { useAppStore } from '../store/useAppStore';
import { FileText, PlusCircle, Search, Star } from 'lucide-react';
import { SearchResult, searchPages } from '../lib/db';
import { pageContentPreview } from '../lib/pageContent';
import { splitSearchMatch } from '../lib/searchDisplay';
import { commandPaletteSections, CommandPalettePage } from '../lib/commandPaletteSections';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import { useT } from '../lib/i18n';

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

type CommandItem = {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  icon: ComponentType<{ className?: string }>;
  action: () => Promise<void>;
};

export function CommandPalette() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { pages, setCurrentPageId, setWorkspaceMode, isCommandPaletteOpen, closeCommandPalette, addPage } = useAppStore();

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
          setSearchError(t('commandPalette.noResults'));
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
  const showCommands = !query.trim();
  const commandItems: CommandItem[] = showCommands
    ? [
        {
          id: 'new-page',
          label: t('sidebar.newPage'),
          shortcut: '⌘N',
          icon: PlusCircle,
          action: async () => {
            const page = await addPage();
            if (page) setCurrentPageId(page.id);
          },
        },
      ]
    : [];
  const totalItems = commandItems.length + flattenedPages.length;

  const handleSelect = (id: string) => {
    setWorkspaceMode('notes');
    setCurrentPageId(id);
    closeCommandPalette();
  };

  const handleCommandSelect = async (index: number) => {
    const command = commandItems[index];
    if (!command) return;
    closeCommandPalette();
    await command.action();
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalItems === 0) return;
      setSelectedIndex(prev => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalItems === 0) return;
      setSelectedIndex(prev => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter' && totalItems > 0) {
      e.preventDefault();
      if (selectedIndex < commandItems.length) {
        void handleCommandSelect(selectedIndex);
        return;
      }
      const page = flattenedPages[selectedIndex - commandItems.length];
      if (page) handleSelect(page.id);
    }
  };

  if (!isCommandPaletteOpen) return null;

  return (
    <div 
      className="on-modal-overlay on-command-overlay items-center justify-center"
      onClick={closeCommandPalette}
    >
      <div 
        className="on-modal-panel on-command-panel"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleModalKeyDown}
      >
        <div className="on-command-input-row">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input 
            ref={inputRef}
            className="min-w-0 flex-1 border-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
            placeholder={t('commandPalette.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <div className="on-command-kbd">ESC</div>
        </div>
        
        <div className="on-command-results">
          {isSearching ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t('commandPalette.searching')}
            </div>
          ) : searchError ? (
            <div className="px-4 py-8 text-center text-sm text-destructive">
              {searchError}
            </div>
          ) : totalItems === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {query.trim() ? t('commandPalette.noResults') : t('commandPalette.noPagesYet')}
            </div>
          ) : (
            <>
            {commandItems.length > 0 && (
              <div className="on-command-section">
                <div className="on-command-section-title">{t('commandPalette.suggested')}</div>
                {commandItems.map((command, index) => {
                  const Icon = command.icon;
                  const isSelected = selectedIndex === index;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      className={`on-command-item ${isSelected ? 'on-command-item-selected' : ''}`}
                      onClick={() => void handleCommandSelect(index)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{command.label}</span>
                        {command.detail && (
                          <span className="block truncate text-xs text-muted-foreground">{command.detail}</span>
                        )}
                      </span>
                      {command.shortcut && <span className="on-command-shortcut">{command.shortcut}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {sections.map((section) => {
              let sectionStartIndex = 0;
              for (const previousSection of sections) {
                if (previousSection === section) break;
                sectionStartIndex += previousSection.pages.length;
              }

              return (
                <div key={section.titleKey} className="on-command-section">
                  <div className="on-command-section-title flex items-center gap-1.5">
                    {section.titleKey === 'commandPalette.favorites' && <Star className="h-3 w-3 fill-current" />}
                    {t(section.titleKey)}
                  </div>
                  {section.pages.map((page, index) => {
                    const absoluteIndex = sectionStartIndex + index + commandItems.length;
                    const preview = page.matched_content
                      ? pageContentPreview(page.matched_content, query)
                      : null;
                    const title = page.title || t('sidebar.untitled');
                    const isSelected = absoluteIndex === selectedIndex;

                    return (
                      <button
                        type="button"
                        key={`${section.titleKey}-${page.id}`}
                        className={`on-command-item ${isSelected ? 'on-command-item-selected' : ''}`}
                        onClick={() => handleSelect(page.id)}
                        onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                      >
                        {page.icon ? (
                          <span className="flex h-4 w-4 items-center justify-center text-xs">{page.icon}</span>
                        ) : (
                          <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            <HighlightedText text={title} query={query} selected={isSelected} />
                          </span>
                          {preview && (
                            <span className="block truncate text-xs text-muted-foreground">
                              <HighlightedText text={preview} query={query} selected={isSelected} />
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
