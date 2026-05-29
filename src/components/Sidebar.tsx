import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { Plus, FileText, Trash2, ChevronRight, ChevronDown, Search, PlusCircle, Home, Settings, AlertTriangle, FolderInput, Check, Pencil, Pin, Copy } from 'lucide-react';
import { Page } from '../lib/db';
import { moveTargetPages, visiblePageIds } from '../lib/pageTree';
import { SettingsModal } from './SettingsModal';
import { HOME_PAGE_ID } from '../lib/navigation';
import { normalizePageTitle } from '../lib/pageTitle';
import { clampContextMenuPosition } from '../lib/contextMenu';
import { computeFloatingPosition } from '../lib/floatingPosition';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import { dropPositionFromOffset, reorderedSiblingIds, reorderedWithMovedPageId } from '../lib/pageOrder';
import type { DropPosition } from '../lib/pageOrder';
import { SidebarModeSwitch } from './SidebarModeSwitch';
import { StudioSidebar } from './StudioSidebar';

type PendingDelete = {
  page: Page;
  hasChildren: boolean;
};

type DropTarget = {
  pageId: string;
  position: DropPosition;
};

type DragSession = {
  pageId: string;
  startX: number;
  startY: number;
  active: boolean;
};

function sidebarPopoverStyle(left: number, top: number): CSSProperties {
  return {
    left,
    top,
    maxHeight: Math.max(96, window.innerHeight - top - 12),
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  };
}

function storedExpandedState(pageId: string): boolean {
  return localStorage.getItem(`opennotion-page-expanded-${pageId}`) !== 'false';
}

function storeExpandedState(pageId: string, expanded: boolean) {
  localStorage.setItem(`opennotion-page-expanded-${pageId}`, String(expanded));
}

function expandedPageIds(pages: Page[]): Set<string> {
  return new Set(pages.filter(page => storedExpandedState(page.id)).map(page => page.id));
}

function sortPages(pages: Page[]): Page[] {
  return [...pages].sort((first, second) => {
    if (first.sort_order !== second.sort_order) {
      return first.sort_order - second.sort_order;
    }

    return second.created_at.localeCompare(first.created_at);
  });
}

function isDescendantPage(pages: Page[], pageId: string, possibleDescendantId: string): boolean {
  let current = pages.find(page => page.id === possibleDescendantId);

  while (current?.parent_id) {
    if (current.parent_id === pageId) return true;
    current = pages.find(page => page.id === current?.parent_id);
  }

  return false;
}

function PageItem({
  page,
  allPages,
  depth = 0,
  onRequestDelete,
  draggedPageId,
  dropTarget,
  forcedExpandedPageId,
  forcedCollapsedPageId,
  renameRequestedPageId,
  onRenameHandled,
  onPointerDownPage
}: {
  page: Page,
  allPages: Page[],
  depth?: number,
  onRequestDelete: (pendingDelete: PendingDelete) => void,
  draggedPageId: string | null,
  dropTarget: DropTarget | null,
  forcedExpandedPageId: string | null,
  forcedCollapsedPageId: string | null,
  renameRequestedPageId: string | null,
  onRenameHandled: () => void,
  onPointerDownPage: (event: React.PointerEvent<HTMLDivElement>, page: Page) => void
}) {
  const { currentPageId, setCurrentPageId, addPage, duplicatePageAction, movePageAction, renamePageAction, toggleFavoriteAction, toggleTemplateAction } = useAppStore();
  const [isExpanded, setIsExpanded] = useState(() => storedExpandedState(page.id));
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(page.title || 'Untitled');
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [moveMenuPosition, setMoveMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);

  const childPages = allPages.filter(p => p.parent_id === page.id);
  const hasChildren = childPages.length > 0;
  const moveTargets = moveTargetPages(allPages, page.id).filter(target =>
    (target.title || 'Untitled').toLowerCase().includes(moveQuery.trim().toLowerCase())
  );

  const setExpanded = (expanded: boolean) => {
    storeExpandedState(page.id, expanded);
    setIsExpanded(expanded);
  };

  useEffect(() => {
    if (!isRenaming) {
      setDraftTitle(page.title || 'Untitled');
    }
  }, [isRenaming, page.title]);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (forcedExpandedPageId === page.id) {
      setExpanded(true);
    }
  }, [forcedExpandedPageId, page.id]);

  useEffect(() => {
    if (forcedCollapsedPageId === page.id) {
      setExpanded(false);
    }
  }, [forcedCollapsedPageId, page.id]);

  useEffect(() => {
    if (renameRequestedPageId === page.id) {
      setDraftTitle(page.title || 'Untitled');
      setIsRenaming(true);
      onRenameHandled();
    }
  }, [onRenameHandled, page.id, page.title, renameRequestedPageId]);

  useEffect(() => {
    if (!contextMenuPosition) return;

    const closeMenu = () => setContextMenuPosition(null);
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;

      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);
    };
  }, [contextMenuPosition]);

  useEffect(() => {
    if (!isMoveOpen) return;

    const closeMenu = () => {
      setIsMoveOpen(false);
      setMoveMenuPosition(null);
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && moveMenuRef.current?.contains(target)) return;

      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);
    };
  }, [isMoveOpen]);

  const handleAddSubpage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(true);
    await addPage('Untitled', page.id);
  };

  const handleDeletePage = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRequestDelete({ page, hasChildren });
  };

  const handleToggleFavorite = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    await toggleFavoriteAction(page.id, page.is_favorite !== 1);
  };

  const handleToggleTemplate = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    await toggleTemplateAction(page.id, page.is_template !== 1);
  };

  const handleDuplicatePage = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    const duplicated = await duplicatePageAction(page.id);
    if (duplicated) {
      setCurrentPageId(duplicated.id);
    }
  };

  const handleMovePage = async (nextParentId: string | null) => {
    await movePageAction(page.id, nextParentId);
    setIsMoveOpen(false);
    setMoveQuery('');
    setMoveMenuPosition(null);
  };

  const startRename = (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    setIsMoveOpen(false);
    setMoveMenuPosition(null);
    setDraftTitle(page.title || 'Untitled');
    setIsRenaming(true);
  };

  const commitRename = async () => {
    const nextTitle = normalizePageTitle(draftTitle);
    setIsRenaming(false);
    setDraftTitle(nextTitle);

    if (nextTitle !== page.title) {
      await renamePageAction(page.id, nextTitle);
    }
  };

  const cancelRename = () => {
    setDraftTitle(page.title || 'Untitled');
    setIsRenaming(false);
  };

  const openMoveMenuAt = (left: number, top: number) => {
    closeOpenOverlays();
    setMoveMenuPosition(clampContextMenuPosition(left, top, window.innerWidth, window.innerHeight, 224, 280));
    setMoveQuery('');
    setIsMoveOpen(true);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    closeOpenOverlays();
    setCurrentPageId(page.id);
    setIsMoveOpen(false);
    setMoveMenuPosition(null);
    setContextMenuPosition(
      clampContextMenuPosition(event.clientX, event.clientY, window.innerWidth, window.innerHeight, 180, 150)
    );
  };

  const dropClass = dropTarget?.pageId === page.id
    ? dropTarget.position === 'inside'
      ? 'border-y-2 border-y-transparent bg-accent'
      : dropTarget.position === 'before'
      ? 'border-t-2 border-t-primary'
      : 'border-b-2 border-b-primary'
    : 'border-y-2 border-y-transparent';

  return (
    <div>
      <div
        data-page-id={page.id}
        className={`group on-shell-row mb-[1px] cursor-pointer justify-between py-[3px] text-[13px] select-none ${currentPageId === page.id ? 'on-shell-row-active' : ''} ${dropClass} ${draggedPageId === page.id ? 'opacity-45' : ''}`}
        style={{ paddingLeft: `${(depth * 12) + 12}px`, paddingRight: '8px' }}
        onClick={() => setCurrentPageId(page.id)}
        onDoubleClick={startRename}
        onContextMenu={handleContextMenu}
        onPointerDown={(event) => onPointerDownPage(event, page)}
      >
        <div className="flex items-center truncate">
          <button
            className={`on-icon-button mr-1 h-6 w-6 rounded-md ${hasChildren ? '' : 'invisible'}`}
            onClick={(e) => { e.stopPropagation(); setExpanded(!isExpanded); }}
          >
            {isExpanded ? <ChevronDown className="w-[14px] h-[14px] opacity-40" /> : <ChevronRight className="w-[14px] h-[14px] opacity-40" />}
          </button>
          {page.icon ? (
            <span className="w-[18px] h-[18px] mr-1.5 flex items-center justify-center text-[13px]">{page.icon}</span>
          ) : (
            <FileText className="w-4 h-4 mr-2 opacity-50 flex-shrink-0" />
          )}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="h-[20px] min-w-0 flex-1 rounded bg-transparent px-0 py-0 text-[13px] leading-5 text-foreground outline-none ring-0 focus:outline-none focus:ring-0"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitRename();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
          ) : (
            <span className="truncate">{page.title || 'Untitled'}</span>
          )}
        </div>
        <div className={`flex items-center transition-opacity flex-shrink-0 ${isRenaming ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}>
          <button
            className="on-icon-button mr-0.5 h-6 w-6 rounded-md"
            title={page.is_favorite === 1 ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={(event) => void handleToggleFavorite(event)}
          >
            <Pin
              className={`h-3.5 w-3.5 ${page.is_favorite === 1 ? 'fill-current text-muted-foreground' : 'text-muted-foreground'}`}
            />
          </button>
        </div>
      </div>

      {isMoveOpen && moveMenuPosition && createPortal(
        <div
          ref={moveMenuRef}
          className="fixed z-[130] w-56 on-popover"
          style={sidebarPopoverStyle(moveMenuPosition.left, moveMenuPosition.top)}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="on-popover-search">
            <input
              className="w-full rounded-full bg-background/60 px-3 py-2 text-xs outline-none placeholder:text-muted-foreground"
              placeholder="Move to..."
              value={moveQuery}
              onChange={(event) => setMoveQuery(event.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            <button
              className="on-menu-item justify-between"
              onClick={() => void handleMovePage(null)}
            >
              <span>Root</span>
              {page.parent_id === null && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {moveTargets.map(target => (
              <button
                key={target.id}
                className="on-menu-item justify-between"
                onClick={() => void handleMovePage(target.id)}
              >
                <span className="truncate">{target.title || 'Untitled'}</span>
                {page.parent_id === target.id && <Check className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
              </button>
            ))}
            {moveTargets.length === 0 && moveQuery.trim() && (
              <div className="px-2 py-2 text-xs text-muted-foreground">No pages found.</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {contextMenuPosition && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[180] w-56 on-popover on-page-action-popover"
          style={sidebarPopoverStyle(contextMenuPosition.left, contextMenuPosition.top)}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="on-menu-item"
            onClick={(event) => {
              startRename(event);
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            Rename
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => void handleDuplicatePage(event)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            Duplicate
          </button>
          <div className="on-menu-separator" />
          <button
            className="on-menu-item"
            onClick={(event) => void handleToggleFavorite(event)}
          >
            <Pin className={`h-3.5 w-3.5 text-muted-foreground ${page.is_favorite === 1 ? 'fill-current' : ''}`} />
            {page.is_favorite === 1 ? 'Remove from Favorites' : 'Add to Favorites'}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => void handleToggleTemplate(event)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            {page.is_template === 1 ? 'Remove from Templates' : 'Use as Template'}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => {
              setContextMenuPosition(null);
              void handleAddSubpage(event);
            }}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            New subpage
          </button>
          <button
            className="on-menu-item"
            onClick={() => {
              openMoveMenuAt(contextMenuPosition.left, contextMenuPosition.top);
              setContextMenuPosition(null);
            }}
          >
            <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
            Move
          </button>
          <div className="on-menu-separator" />
          <button
            className="on-menu-item on-menu-item-danger"
            onClick={(event) => {
              setContextMenuPosition(null);
              handleDeletePage(event);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>,
        document.body
      )}

      {isExpanded && hasChildren && (
        <div>
          {childPages.map(child => (
            <PageItem
              key={child.id}
              page={child}
              allPages={allPages}
              depth={depth + 1}
              onRequestDelete={onRequestDelete}
              draggedPageId={draggedPageId}
              dropTarget={dropTarget}
              forcedExpandedPageId={forcedExpandedPageId}
              forcedCollapsedPageId={forcedCollapsedPageId}
              renameRequestedPageId={renameRequestedPageId}
              onRenameHandled={onRenameHandled}
              onPointerDownPage={onPointerDownPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const {
    pages,
    fetchPages,
    addPage,
    addPageFromTemplate,
    removePage,
    movePageAction,
    reorderPagesAction,
    toggleFavoriteAction,
    currentPageId,
    setCurrentPageId,
    isLoading,
    openCommandPalette,
    workspaceMode,
    setWorkspaceMode,
    studioDocuments,
    studioProjects,
    currentStudioDocumentId,
    fetchStudioDocuments,
    setCurrentStudioDocumentId,
    importStudioPdfAction,
    createStudioProjectAction,
    renameStudioProjectAction,
    updateStudioProjectParentAction,
    deleteStudioProjectAction,
    updateStudioDocumentProjectAction,
    renameStudioDocumentAction,
    deleteStudioDocumentAction,
    sidebarWidth,
    setSidebarWidth,
  } = useAppStore();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const newPageButtonRef = useRef<HTMLButtonElement>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newPageMenuPosition, setNewPageMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [forcedExpandedPageId, setForcedExpandedPageId] = useState<string | null>(null);
  const [forcedCollapsedPageId, setForcedCollapsedPageId] = useState<string | null>(null);
  const [renameRequestedPageId, setRenameRequestedPageId] = useState<string | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const pagesRef = useRef<Page[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  useEffect(() => {
    if (workspaceMode === 'studio') {
      void fetchStudioDocuments();
    }
  }, [fetchStudioDocuments, workspaceMode]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const notePages = pages.filter((page) => page.page_kind === 'note');
  const sortedPages = sortPages(notePages);
  const rootPages = sortedPages.filter(p => p.parent_id === null);
  const templatePages = sortedPages.filter(p => p.is_template === 1);
  const favoritePages = sortedPages.filter(p => p.is_favorite === 1);

  useEffect(() => {
    if (!newPageMenuPosition) return;

    const closeMenu = () => setNewPageMenuPosition(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);
    };
  }, [newPageMenuPosition]);

  useEffect(() => {
    if (!pendingDelete) return;

    closeOpenOverlays();
    const closeDialog = () => setPendingDelete(null);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeDialog);
    return () => window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeDialog);
  }, [pendingDelete]);

  const handleAddPage = async () => {
    await addPage();
    setNewPageMenuPosition(null);
  };

  const toggleNewPageMenu = () => {
    if (newPageMenuPosition) {
      setNewPageMenuPosition(null);
      return;
    }

    const rect = newPageButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    closeOpenOverlays();
    const position = computeFloatingPosition(rect, { width: 224, height: 220 }, { width: window.innerWidth, height: window.innerHeight });

    setNewPageMenuPosition({
      left: position.left,
      top: position.top,
    });
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    await addPageFromTemplate(templateId, null);
    setNewPageMenuPosition(null);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    await removePage(pendingDelete.page.id);
    setPendingDelete(null);
  };

  const requestExpand = (pageId: string) => {
    storeExpandedState(pageId, true);
    setForcedCollapsedPageId(null);
    setForcedExpandedPageId(pageId);
  };

  const requestCollapse = (pageId: string) => {
    storeExpandedState(pageId, false);
    setForcedExpandedPageId(null);
    setForcedCollapsedPageId(pageId);
  };

  const handleSidebarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const activeElement = event.target as HTMLElement;
    if (activeElement.closest('input,textarea,[contenteditable="true"]')) return;
    if (currentPageId === HOME_PAGE_ID) return;

    const currentPage = notePages.find(page => page.id === currentPageId);
    if (!currentPage) return;

    const childPages = sortedPages.filter(page => page.parent_id === currentPage.id);
    const expandedIds = expandedPageIds(notePages);
    const visibleIds = visiblePageIds(notePages, expandedIds);
    const currentIndex = visibleIds.indexOf(currentPage.id);

    if (event.key === 'ArrowDown' && currentIndex >= 0 && currentIndex < visibleIds.length - 1) {
      event.preventDefault();
      setCurrentPageId(visibleIds[currentIndex + 1]);
      return;
    }

    if (event.key === 'ArrowUp' && currentIndex > 0) {
      event.preventDefault();
      setCurrentPageId(visibleIds[currentIndex - 1]);
      return;
    }

    if (event.key === 'ArrowRight') {
      if (childPages.length === 0) return;
      event.preventDefault();

      if (!expandedIds.has(currentPage.id)) {
        requestExpand(currentPage.id);
      } else {
        setCurrentPageId(childPages[0].id);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();

      if (expandedIds.has(currentPage.id) && childPages.length > 0) {
        requestCollapse(currentPage.id);
      } else if (currentPage.parent_id) {
        setCurrentPageId(currentPage.parent_id);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      setRenameRequestedPageId(currentPage.id);
      return;
    }

    if (event.key === 'Backspace' && event.metaKey) {
      event.preventDefault();
      setPendingDelete({ page: currentPage, hasChildren: childPages.length > 0 });
    }
  };

  const clearDragState = () => {
    setDraggedPageId(null);
    dropTargetRef.current = null;
    setDropTarget(null);
  };

  const reorderFromDropTarget = async (sourceId: string, target: DropTarget) => {
    const currentPages = pagesRef.current;
    const draggedPage = currentPages.find(candidate => candidate.id === sourceId);
    const targetPage = currentPages.find(candidate => candidate.id === target.pageId);
    if (!draggedPage || !targetPage) return;

    if (target.position === 'inside') {
      setForcedExpandedPageId(targetPage.id);
      await movePageAction(sourceId, targetPage.id);
      return;
    }

    const siblingIds = sortPages(currentPages)
      .filter(candidate => candidate.parent_id === targetPage.parent_id)
      .map(candidate => candidate.id);
    const orderedIds = draggedPage.parent_id === targetPage.parent_id
      ? reorderedSiblingIds(siblingIds, sourceId, targetPage.id, target.position)
      : reorderedWithMovedPageId(siblingIds, sourceId, targetPage.id, target.position);

    if (orderedIds.join('\0') === siblingIds.join('\0')) return;

    if (draggedPage.parent_id !== targetPage.parent_id) {
      await movePageAction(sourceId, targetPage.parent_id);
    }

    await reorderPagesAction(targetPage.parent_id, orderedIds);
  };

  const updatePointerDropTarget = (clientX: number, clientY: number) => {
    const session = dragSessionRef.current;
    if (!session) return;

    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-page-id]');
    const targetId = row?.dataset.pageId;
    if (!row || !targetId || targetId === session.pageId) {
      dropTargetRef.current = null;
      setDropTarget(null);
      return;
    }

    const currentPages = pagesRef.current;
    const draggedPage = currentPages.find(candidate => candidate.id === session.pageId);
    const targetPage = currentPages.find(candidate => candidate.id === targetId);

    const rect = row.getBoundingClientRect();
    const position = dropPositionFromOffset(clientY - rect.top, rect.height);
    const isValidSiblingDrop = draggedPage?.parent_id === targetPage?.parent_id;
    const isValidCrossParentOrderDrop = Boolean(
      draggedPage &&
      targetPage &&
      position !== 'inside' &&
      targetPage.parent_id !== draggedPage.id &&
      !isDescendantPage(currentPages, session.pageId, targetPage.parent_id || '')
    );
    const isValidInsideDrop = Boolean(
      draggedPage &&
      targetPage &&
      position === 'inside' &&
      !isDescendantPage(currentPages, session.pageId, targetId)
    );

    if (!draggedPage || !targetPage || (!isValidSiblingDrop && !isValidCrossParentOrderDrop && !isValidInsideDrop)) {
      dropTargetRef.current = null;
      setDropTarget(null);
      return;
    }

    const nextDropTarget = { pageId: targetId, position };
    dropTargetRef.current = nextDropTarget;
    setDropTarget(nextDropTarget);
  };

  const autoScrollSidebar = (clientY: number) => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const rect = scrollArea.getBoundingClientRect();
    const edgeSize = 36;

    if (clientY < rect.top + edgeSize) {
      scrollArea.scrollTop -= 10;
    } else if (clientY > rect.bottom - edgeSize) {
      scrollArea.scrollTop += 10;
    }
  };

  const handlePointerDownPage = (event: React.PointerEvent<HTMLDivElement>, page: Page) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    if ((event.target as HTMLElement).closest('button,input')) return;

    dragSessionRef.current = {
      pageId: page.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;

      const distance = Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY);
      if (!session.active && distance < 4) return;

      if (!session.active) {
        dragSessionRef.current = { ...session, active: true };
        setDraggedPageId(session.pageId);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }

      moveEvent.preventDefault();
      autoScrollSidebar(moveEvent.clientY);
      updatePointerDropTarget(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = () => {
      const session = dragSessionRef.current;
      const target = dropTargetRef.current;
      dragSessionRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      clearDragState();

      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      if (session?.active && target) {
        void reorderFromDropTarget(session.pageId, target);
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      setSidebarWidth(moveEvent.clientX - sidebarLeft);
    };

    const handlePointerUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const deleteTitle = pendingDelete?.page.title || 'Untitled';
  const deleteMessage = pendingDelete?.hasChildren
    ? `Delete "${deleteTitle}" and its subpages permanently? This cannot be undone.`
    : `Delete "${deleteTitle}" permanently? This cannot be undone.`;
  const deleteDialog = pendingDelete ? createPortal(
    <div className="on-modal-overlay z-[180] items-center justify-center p-4" onMouseDown={() => setPendingDelete(null)}>
      <div className="on-modal-panel on-delete-dialog w-[420px] max-w-[calc(100vw-2rem)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="on-delete-dialog-content">
          <div className="on-delete-dialog-icon">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Delete permanently?</div>
            <div className="mt-1 text-sm text-muted-foreground">{deleteMessage}</div>
          </div>
        </div>
        <div className="on-delete-dialog-actions">
          <button
            className="on-button-secondary"
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </button>
          <button
            className="on-button-danger"
            onClick={handleConfirmDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div
      ref={sidebarRef}
      tabIndex={0}
      className="on-glass-sidebar relative m-3 flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden text-secondary-foreground outline-none ring-0 focus:outline-none focus:ring-0"
      style={{ width: sidebarWidth }}
      onKeyDown={handleSidebarKeyDown}
      onMouseDown={() => sidebarRef.current?.focus()}
    >
      <div
        className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-border/70"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={handleResizePointerDown}
      />
      <div className="on-sidebar-header-spacer flex-shrink-0" data-tauri-drag-region />

      <div className="on-sidebar-mode-row">
        <SidebarModeSwitch mode={workspaceMode} onChange={setWorkspaceMode} />
      </div>

      {workspaceMode === 'studio' ? (
        <StudioSidebar
          documents={studioDocuments}
          projects={studioProjects}
          currentDocumentId={currentStudioDocumentId}
          isLoading={isLoading}
          onImport={(projectId = null) => void importStudioPdfAction(projectId)}
          onCreateProject={(name, parentId = null) => void createStudioProjectAction(name, parentId)}
          onRenameProject={(id, name) => void renameStudioProjectAction(id, name)}
          onMoveProject={(id, parentId) => void updateStudioProjectParentAction(id, parentId)}
          onDeleteProject={(id) => void deleteStudioProjectAction(id)}
          onMoveDocument={(documentId, projectId) => void updateStudioDocumentProjectAction(documentId, projectId)}
          onSelectDocument={setCurrentStudioDocumentId}
          onRenameDocument={(id, title) => void renameStudioDocumentAction(id, title)}
          onDeleteDocument={(id) => void deleteStudioDocumentAction(id)}
        />
      ) : (
        <>
      <div className="on-sidebar-nav px-1">
        <button
          className={`on-shell-row ${currentPageId === HOME_PAGE_ID ? 'on-shell-row-active' : ''}`}
          onClick={() => setCurrentPageId(HOME_PAGE_ID)}
        >
          <Home className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>Home</span>
        </button>
        <button
          ref={newPageButtonRef}
          className="on-shell-row"
          onClick={(event) => {
            event.stopPropagation();
            toggleNewPageMenu();
          }}
        >
          <PlusCircle className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>New page</span>
        </button>
        {newPageMenuPosition && createPortal(
          <div
            className="fixed z-[180] w-56 on-popover"
            style={sidebarPopoverStyle(newPageMenuPosition.left, newPageMenuPosition.top)}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="on-menu-item"
              onClick={() => void handleAddPage()}
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              Blank page
            </button>
            {templatePages.length > 0 && <div className="my-1 h-px bg-border" />}
            {templatePages.map(template => (
              <button
                key={`new-template-${template.id}`}
                className="on-menu-item"
                onClick={() => void handleCreateFromTemplate(template.id)}
              >
                {template.icon ? (
                  <span className="flex h-3.5 w-3.5 items-center justify-center text-xs">{template.icon}</span>
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="truncate">{template.title || 'Untitled'}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
        <button
          className="on-shell-row"
          onClick={openCommandPalette}
        >
          <Search className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>Search</span>
        </button>
      </div>
      <div ref={scrollAreaRef} className="on-scroll-fade on-scroll-fade-sidebar flex-1 overflow-y-auto pt-3">
        {isLoading && (
          <div className="px-5 py-4 text-xs text-muted-foreground">Loading pages...</div>
        )}
        {templatePages.length > 0 && (
          <div className="px-2 mb-4">
            <div className="on-section-label mb-1 mt-4">Templates</div>
            {templatePages.map(page => (
              <div
                key={`tpl-${page.id}`}
                className={`group on-shell-row mb-[1px] cursor-pointer justify-between py-[3px] text-[13px] ${currentPageId === page.id ? 'on-shell-row-active' : ''}`}
                onClick={() => setCurrentPageId(page.id)}
              >
                <div className="flex items-center truncate">
                  {page.icon ? (
                    <span className="w-[18px] h-[18px] mr-1.5 flex-shrink-0 flex items-center justify-center text-[13px]">{page.icon}</span>
                  ) : (
                    <Copy className="w-4 h-4 mr-2 opacity-50 flex-shrink-0" />
                  )}
                  <span className="truncate">{page.title || 'Untitled'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {favoritePages.length > 0 && (
          <div className="px-2 mb-4">
            <div className="on-section-label mb-1 mt-4">Favorites</div>
            {favoritePages.map(page => (
              <div
                key={`fav-${page.id}`}
                className={`group on-shell-row mb-[1px] cursor-pointer justify-between py-[3px] text-[13px] ${currentPageId === page.id ? 'on-shell-row-active' : ''}`}
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
                <button
                  className="on-icon-button ml-1 h-6 w-6 rounded-md opacity-0 group-hover:opacity-100"
                  title="Remove from Favorites"
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleFavoriteAction(page.id, false);
                  }}
                >
                  <Pin className="h-3.5 w-3.5 fill-current text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="px-2 pb-24 min-h-[100px]">
          <div className="on-section-label mb-1 mt-4">Private</div>
          {!isLoading && rootPages.length === 0 && (
            <div className="mx-3 mt-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              No pages yet.
              <button
                className="mt-2 block text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void addPage()}
              >
                Create first page
              </button>
            </div>
          )}
          {rootPages.map(page => (
              <PageItem
                key={page.id}
                page={page}
                allPages={sortedPages}
                onRequestDelete={setPendingDelete}
                draggedPageId={draggedPageId}
                dropTarget={dropTarget}
                forcedExpandedPageId={forcedExpandedPageId}
                forcedCollapsedPageId={forcedCollapsedPageId}
                renameRequestedPageId={renameRequestedPageId}
                onRenameHandled={() => setRenameRequestedPageId(null)}
                onPointerDownPage={handlePointerDownPage}
              />
            ))}
        </div>
      </div>
        </>
      )}
      {deleteDialog}
      <div className="on-sidebar-settings-fade" aria-hidden="true" />
      <button
        type="button"
        className="on-sidebar-settings-button"
        aria-label="Settings"
        title="Settings"
        onClick={() => {
          closeOpenOverlays();
          setIsSettingsOpen(true);
        }}
      >
        <Settings className="h-4 w-4" strokeWidth={1.9} />
      </button>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
