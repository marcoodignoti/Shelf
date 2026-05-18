import { useState, useEffect } from 'react';
import { Page, getDeletedPages, restorePage, hardDeletePage } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { FileText, RotateCcw, Trash, X } from 'lucide-react';

export function TrashModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [deletedPages, setDeletedPages] = useState<Page[]>([]);
  const { fetchPages } = useAppStore();

  useEffect(() => {
    if (isOpen) {
      loadDeleted();
    }
  }, [isOpen]);

  const loadDeleted = async () => {
    const pages = await getDeletedPages();
    setDeletedPages(pages);
  };

  const handleRestore = async (id: string) => {
    await restorePage(id);
    await loadDeleted();
    await fetchPages(); // refresh sidebar
  };

  const handleHardDelete = async (id: string) => {
    const page = deletedPages.find((deletedPage) => deletedPage.id === id);
    const childCount = deletedPages.filter((deletedPage) => deletedPage.parent_id === id).length;
    const message = childCount > 0
      ? `Delete "${page?.title || 'Untitled'}" and its subpages forever?`
      : `Delete "${page?.title || 'Untitled'}" forever?`;

    if (!window.confirm(message)) return;

    await hardDeletePage(id);
    await loadDeleted();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card border border-border shadow-lg rounded-lg w-[400px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="font-semibold text-sm flex items-center">
            <Trash className="w-4 h-4 mr-2" />
            Trash
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
          {deletedPages.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No pages in trash.
            </div>
          ) : (
            deletedPages.map(page => (
              <div key={page.id} className="flex items-center justify-between p-2 hover:bg-muted rounded group text-sm">
                <div className="flex items-center truncate">
                  <FileText className="w-4 h-4 mr-2 opacity-50" />
                  <span className="truncate">{page.title || 'Untitled'}</span>
                </div>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleRestore(page.id)}
                    className="p-1.5 hover:bg-background rounded mr-1"
                    title="Restore"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                  <button 
                    onClick={() => handleHardDelete(page.id)}
                    className="p-1.5 hover:bg-background rounded"
                    title="Delete Permanently"
                  >
                    <Trash className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
