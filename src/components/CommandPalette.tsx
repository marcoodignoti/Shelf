import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Search, FileText } from 'lucide-react';
import { SearchResult, searchPages } from '../lib/db';

function contentPreview(content: string | null, query: string): string | null {
  if (!content || !query.trim()) return null;

  const text = content.replace(/[{}\[\]",:]/g, ' ').replace(/\s+/g, ' ').trim();
  const index = text.toLowerCase().indexOf(query.toLowerCase());

  if (index === -1) return text.slice(0, 120);

  return text.slice(Math.max(0, index - 40), index + query.length + 80);
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const { pages, setCurrentPageId } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setSearchResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !query.trim()) {
      setSearchResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      searchPages(query)
        .then((results) => {
          setSearchResults(results);
          setSelectedIndex(0);
        })
        .catch((error) => console.error('Search failed:', error));
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [isOpen, query]);

  const filteredPages = query.trim()
    ? searchResults
    : pages.filter(p => (p.title || 'Untitled').toLowerCase().includes(query.toLowerCase()));

  const handleSelect = (id: string) => {
    setCurrentPageId(id);
    setIsOpen(false);
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredPages.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredPages.length) % filteredPages.length);
    } else if (e.key === 'Enter' && filteredPages.length > 0) {
      e.preventDefault();
      handleSelect(filteredPages[selectedIndex].id);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-start justify-center pt-[20vh]"
      onClick={() => setIsOpen(false)}
    >
      <div 
        className="bg-card border border-border shadow-2xl rounded-xl w-[500px] max-w-[90vw] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleModalKeyDown}
      >
        <div className="flex items-center px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground mr-3" />
          <input 
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
            placeholder="Search pages..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <div className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border">ESC</div>
        </div>
        
        <div className="max-h-[300px] overflow-y-auto p-2">
          {filteredPages.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No results found.
            </div>
          ) : (
            filteredPages.map((page, index) => {
              const preview = 'matched_content' in page
                ? contentPreview((page as SearchResult).matched_content, query)
                : null;

              return (
              <div 
                key={page.id}
                className={`flex items-start px-3 py-2 text-sm cursor-pointer rounded-md ${index === selectedIndex ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground/80 hover:text-foreground'}`}
                onClick={() => handleSelect(page.id)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {page.icon ? (
                  <span className="w-4 h-4 mr-3 mt-0.5 flex items-center justify-center text-xs">{page.icon}</span>
                ) : (
                  <FileText className={`w-4 h-4 mr-3 mt-0.5 flex-shrink-0 ${index === selectedIndex ? 'opacity-80' : 'opacity-50'}`} />
                )}
                <div className="min-w-0">
                  <div className="truncate">{page.title || 'Untitled'}</div>
                  {preview && (
                    <div className={`truncate text-xs ${index === selectedIndex ? 'opacity-80' : 'text-muted-foreground'}`}>
                      {preview}
                    </div>
                  )}
                </div>
              </div>
            )})
          )}
        </div>
      </div>
    </div>
  );
}
