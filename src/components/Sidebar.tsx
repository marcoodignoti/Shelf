import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Plus, FileText, Trash2, ChevronRight, ChevronDown, Trash, PanelLeftClose, Search, PlusCircle, Home, Settings } from 'lucide-react';
import { Page } from '../lib/db';
import { TrashModal } from './TrashModal';
import { SettingsModal } from './SettingsModal';

function PageItem({ page, allPages, depth = 0 }: { page: Page, allPages: Page[], depth?: number }) {
  const { currentPageId, setCurrentPageId, addPage, removePage } = useAppStore();
  const [isExpanded, setIsExpanded] = useState(true);

  const childPages = allPages.filter(p => p.parent_id === page.id);
  const hasChildren = childPages.length > 0;

  const handleAddSubpage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(true);
    await addPage('Untitled', page.id);
  };

  return (
    <div>
      <div 
        className={`group flex items-center justify-between py-[3px] text-[13px] cursor-pointer rounded-md mb-[1px] select-none ${currentPageId === page.id ? 'bg-black/5 dark:bg-white/[0.08] font-medium text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground'}`}
        style={{ paddingLeft: `${(depth * 12) + 12}px`, paddingRight: '8px' }}
        onClick={() => setCurrentPageId(page.id)}
      >
        <div className="flex items-center truncate">
          <button 
            className={`w-4 h-4 mr-1 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 flex-shrink-0 ${hasChildren ? '' : 'invisible'}`}
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
          >
            {isExpanded ? <ChevronDown className="w-[14px] h-[14px] opacity-40" /> : <ChevronRight className="w-[14px] h-[14px] opacity-40" />}
          </button>
          {page.icon ? (
            <span className="w-[18px] h-[18px] mr-1.5 flex items-center justify-center text-[13px]">{page.icon}</span>
          ) : (
            <FileText className="w-4 h-4 mr-2 opacity-50 flex-shrink-0" />
          )}
          <span className="truncate">{page.title || 'Untitled'}</span>
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded mr-0.5"
            onClick={handleAddSubpage}
            title="Add subpage"
          >
            <Plus className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded"
            onClick={(e) => {
              e.stopPropagation();
              removePage(page.id);
            }}
            title="Delete page"
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      </div>
      
      {isExpanded && hasChildren && (
        <div>
          {childPages.map(child => (
            <PageItem key={child.id} page={child} allPages={allPages} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { pages, fetchPages, addPage, error, currentPageId, setCurrentPageId, toggleSidebar } = useAppStore();
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const rootPages = pages.filter(p => p.parent_id === null);
  const favoritePages = pages.filter(p => p.is_favorite === 1);

  const handleAddPage = async () => {
    await addPage();
  };

  return (
    <div 
      className="w-60 bg-secondary border-r border-border flex flex-col h-full overflow-hidden text-secondary-foreground"
      data-tauri-drag-region
    >
      <div className="pt-10 pb-2 px-3 flex items-center justify-between font-medium text-[14px] text-foreground hover:bg-black/5 dark:hover:bg-white/5 mx-2 mt-2 rounded-md transition-colors group cursor-pointer" data-tauri-drag-region>
        <div className="flex items-center pointer-events-none">
          <div className="w-5 h-5 bg-[#5e954c] text-white flex items-center justify-center rounded text-[11px] font-semibold mr-2">
            M
          </div>
          Marco's Workspace
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); toggleSidebar(); }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded cursor-pointer transition-opacity"
          title="Close Sidebar"
        >
          <PanelLeftClose className="w-[14px] h-[14px] text-muted-foreground" />
        </button>
      </div>
      
      <div className="px-2 mt-2 mb-4 space-y-[2px]">
        <button 
          className="flex items-center w-full px-3 py-1.5 text-[13.5px] hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground rounded-md transition-colors cursor-pointer"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
        >
          <Search className="w-4 h-4 mr-2.5 opacity-60" />
          <span>Search</span>
        </button>
        <button 
          className="flex items-center w-full px-3 py-1.5 text-[13.5px] hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground rounded-md transition-colors cursor-pointer"
        >
          <Home className="w-4 h-4 mr-2.5 opacity-60" />
          <span>Home</span>
        </button>
        <button 
          className="flex items-center w-full px-3 py-1.5 text-[13.5px] hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground rounded-md transition-colors cursor-pointer"
          onClick={handleAddPage}
        >
          <PlusCircle className="w-4 h-4 mr-2.5 opacity-60" />
          <span>New page</span>
        </button>
        <button 
          className="flex items-center w-full px-3 py-1.5 text-[13.5px] hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground rounded-md transition-colors cursor-pointer"
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings className="w-4 h-4 mr-2.5 opacity-60" />
          <span>Settings</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto mt-4">
        {error && (
          <div className="mx-2 mb-2 p-2 bg-destructive/10 text-destructive text-xs rounded border border-destructive/20 break-words">
            {error}
          </div>
        )}
        
        {favoritePages.length > 0 && (
          <div className="px-2 mb-4">
            <div className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1 px-3 mt-4">Favorites</div>
            {favoritePages.map(page => (
              <div 
                key={`fav-${page.id}`}
                className={`group flex items-center justify-between px-3 py-[3px] text-[13px] cursor-pointer rounded-md mb-[1px] ${currentPageId === page.id ? 'bg-black/5 dark:bg-white/[0.08] font-medium text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground'}`}
                onClick={() => setCurrentPageId(page.id)}
              >
                <div className="flex items-center truncate">
                  {page.icon ? (
                    <span className="w-[18px] h-[18px] mr-1.5 flex-shrink-0 flex items-center justify-center text-[13px]">{page.icon}</span>
                  ) : (
                    <FileText className="w-4 h-4 mr-2 opacity-50 flex-shrink-0" />
                  )}
                  <span className="truncate">{page.title || 'Untitled'}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-2 pb-20 min-h-[100px]">
          <div className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1 px-3 mt-4">Private</div>
          {rootPages.map(page => (
            <PageItem key={page.id} page={page} allPages={pages} />
          ))}
        </div>
      </div>
      <div className="p-2 border-t border-border flex flex-col gap-[2px]">
        <button 
          onClick={() => setIsTrashOpen(true)}
          className="flex items-center w-full px-3 py-1.5 text-[13px] hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground rounded-md transition-colors"
        >
          <Trash className="w-4 h-4 mr-2.5 opacity-60" />
          <span>Trash</span>
        </button>
      </div>
      <TrashModal isOpen={isTrashOpen} onClose={() => setIsTrashOpen(false)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}