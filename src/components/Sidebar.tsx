import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../store/useUIStore';
import Plus from 'lucide-react/dist/esm/icons/plus.mjs';
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.mjs';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs';
import Search from 'lucide-react/dist/esm/icons/search.mjs';
import SquarePen from 'lucide-react/dist/esm/icons/square-pen.mjs';
import FilePlus from 'lucide-react/dist/esm/icons/file-plus.mjs';
import Upload from 'lucide-react/dist/esm/icons/upload.mjs';
import Home from 'lucide-react/dist/esm/icons/house.mjs';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.mjs';
import Settings from 'lucide-react/dist/esm/icons/settings.mjs';
import UserCircle from 'lucide-react/dist/esm/icons/user-circle.mjs';
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.mjs';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.mjs';
import FolderInput from 'lucide-react/dist/esm/icons/folder-input.mjs';
import Check from 'lucide-react/dist/esm/icons/check.mjs';
import Pencil from 'lucide-react/dist/esm/icons/pencil.mjs';
import Pin from 'lucide-react/dist/esm/icons/pin.mjs';
import Copy from 'lucide-react/dist/esm/icons/copy.mjs';
import Folder from 'lucide-react/dist/esm/icons/folder.mjs';
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.mjs';
import FolderPlus from 'lucide-react/dist/esm/icons/folder-plus.mjs';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.mjs';
import { Page } from '../lib/db';
import { moveTargetPages, visiblePageIds } from '../lib/pageTree';
import { buildSidebarSections, sortSidebarPages } from '../lib/sidebarProjects';
import { buildStudioNoteDocuments, type StudioNoteDocument, type StudioNoteEntry } from '../lib/sidebarStudioNotes';
import { HOME_PAGE_ID } from '../lib/navigation';
import { normalizePageTitle } from '../lib/pageTitle';
import { clampContextMenuPosition } from '../lib/contextMenu';
import { computeFloatingPosition } from '../lib/floatingPosition';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import { dropPositionFromOffset, reorderedSiblingIds, reorderedWithMovedPageId } from '../lib/pageOrder';
import type { DropPosition } from '../lib/pageOrder';
import { buildPageStudioContexts } from '../lib/studioPageContexts';
import type { PageStudioContext } from '../lib/studioPageContexts';
import { useT } from '../lib/i18n';
import { fileSrc } from '../lib/desktop';
import type { SettingsSection } from '../lib/settings';
import type { Theme } from '../store/useUIStore';

type PendingDelete = {
  page: Page;
  hasChildren: boolean;
  kind?: 'page' | 'project';
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

const THEME_CHOICES: Theme[] = ['system', 'light', 'dark'];

function cycleChoice<T extends string>(choices: readonly T[], current: T, direction: -1 | 1): T {
  const currentIndex = Math.max(0, choices.indexOf(current));
  return choices[(currentIndex + direction + choices.length) % choices.length];
}

type SidebarModel = {
  pinnedProjects: Page[];
  pinnedPages: Page[];
  projects: ReturnType<typeof buildSidebarSections>["projects"];
  rootRegularPages: Page[];
  unpinnedContentPages: Page[];
  unpinnedChildrenByParentId: Map<string | null, Page[]>;
  pagesById: Map<string, Page>;
  projectMoveTargets: Page[];
  pinnedProjectGroups: ReturnType<typeof buildSidebarSections>["projects"];
  regularNotePages: Page[];
  studioContextsByPageId: Map<string, PageStudioContext[]>;
  studioNoteDocuments: StudioNoteDocument[];
  ungroupedStudioNotes: Page[];
  templatePages: Page[];
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

function isDescendantPage(pagesById: Map<string, Page>, pageId: string, possibleDescendantId: string): boolean {
  let current = pagesById.get(possibleDescendantId);

  while (current?.parent_id) {
    if (current.parent_id === pageId) return true;
    current = pagesById.get(current.parent_id);
  }

  return false;
}

function PageItem({
  page,
  childrenByParentId,
  allPages,
  projectMoveTargets,
  studioContextsByPageId,
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
  childrenByParentId: Map<string | null, Page[]>,
  allPages: Page[],
  projectMoveTargets: Page[],
  studioContextsByPageId: Map<string, PageStudioContext[]>,
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
  const {
    currentPageId,
    setCurrentPageId,
    setCurrentStudioDocumentId,
    addPage,
    duplicatePageAction,
    movePageAction,
    renamePageAction,
    toggleFavoriteAction,
    toggleTemplateAction,
    importStudioPdfAction
  } = useAppStore(useShallow((s) => ({
    currentPageId: s.currentPageId,
    setCurrentPageId: s.setCurrentPageId,
    setCurrentStudioDocumentId: s.setCurrentStudioDocumentId,
    addPage: s.addPage,
    duplicatePageAction: s.duplicatePageAction,
    movePageAction: s.movePageAction,
    renamePageAction: s.renamePageAction,
    toggleFavoriteAction: s.toggleFavoriteAction,
    toggleTemplateAction: s.toggleTemplateAction,
    importStudioPdfAction: s.importStudioPdfAction
  })));
  const t = useT();
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

  const childPages = childrenByParentId.get(page.id) ?? [];
  const hasChildren = childPages.length > 0;
  const studioContexts = useMemo(() => studioContextsByPageId.get(page.id) ?? [], [studioContextsByPageId, page.id]);
  const primaryStudioContext = studioContexts[0] ?? null;
  const studioBadgeTitle = useMemo(() => {
    return studioContexts.length === 1
      ? `Open linked PDF: ${primaryStudioContext?.document.title ?? t("sidebar.untitled")}`
      : `Open linked PDFs: ${studioContexts.map((context) => context.document.title || t("sidebar.untitled")).join(', ')}`;
  }, [studioContexts, primaryStudioContext, t]);
  const moveTargets = useMemo(() => {
    return moveTargetPages(allPages, page.id).filter(target =>
      (target.title || 'Untitled').toLowerCase().includes(moveQuery.trim().toLowerCase())
    );
  }, [allPages, page.id, moveQuery]);
  const moveProjectTargets = useMemo(() => {
    return projectMoveTargets.filter(target =>
      target.id !== page.id &&
      (target.title || 'Untitled').toLowerCase().includes(moveQuery.trim().toLowerCase())
    );
  }, [projectMoveTargets, page.id, moveQuery]);

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

  const handleOpenLinkedStudioDocument = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!primaryStudioContext) return;
    if (primaryStudioContext.document.id === primaryStudioContext.document.note_page_id) {
      setCurrentPageId(primaryStudioContext.document.id);
      return;
    }
    setCurrentStudioDocumentId(primaryStudioContext.document.id);
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

  const handleImportPdf = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    setIsExpanded(true);
    await importStudioPdfAction(page.id);
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
      ? 'on-sidebar-drop-inside'
      : dropTarget.position === 'before'
      ? 'on-sidebar-drop-before'
      : 'on-sidebar-drop-after'
    : '';

  return (
    <div>
      <div
        data-page-id={page.id}
        className={`group on-shell-row on-sidebar-page-row mb-[1px] cursor-pointer justify-between py-[2px] text-[13.5px] select-none ${currentPageId === page.id ? 'on-shell-row-active' : ''} ${dropClass} ${draggedPageId === page.id ? 'opacity-45' : ''}`}
        style={{ paddingLeft: `${(depth * 12) + 5}px`, paddingRight: '6px' }}
        onClick={() => setCurrentPageId(page.id)}
        onDoubleClick={startRename}
        onContextMenu={handleContextMenu}
        onPointerDown={(event) => onPointerDownPage(event, page)}
      >
        <div className="flex min-w-0 flex-1 items-center truncate">
          {page.icon && (
            <span className="mr-1.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center text-[13.5px]">
              {page.icon}
            </span>
          )}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="on-sidebar-rename-input"
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
            <span className="truncate">{page.title || t("sidebar.untitled")}</span>
          )}
          {hasChildren && (
            <button
              className={`on-sidebar-row-disclosure ml-1 h-6 w-6 flex-shrink-0 ${isRenaming ? 'hidden' : ''}`}
              onClick={(e) => { e.stopPropagation(); setExpanded(!isExpanded); }}
              aria-label={isExpanded ? "Collapse page" : "Expand page"}
            >
              {isExpanded ? <ChevronDown className="w-[14px] h-[14px] opacity-40" /> : <ChevronRight className="w-[14px] h-[14px] opacity-40" />}
            </button>
          )}
        </div>
        <div className={`flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${isRenaming ? 'hidden' : ''}`}>
          {primaryStudioContext && (
            <button
              type="button"
              className="on-sidebar-linked-pdf-badge"
              title={studioBadgeTitle}
              aria-label={studioBadgeTitle}
              onClick={handleOpenLinkedStudioDocument}
            >
              <FileText className="h-3 w-3" />
              <span>{studioContexts.length > 1 ? studioContexts.length : 'PDF'}</span>
            </button>
          )}
          <button
            className="on-sidebar-pin-button mr-0.5 h-6 w-6"
            title={page.is_favorite === 1 ? t("sidebar.removeFromFavorites") : t("sidebar.addToFavorites")}
            aria-label={page.is_favorite === 1 ? t("sidebar.removeFromFavorites") : t("sidebar.addToFavorites")}
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
              placeholder={t("sidebar.moveTo")}
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
              <span>{t("sidebar.moveRoot")}</span>
              {page.parent_id === null && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {moveTargets.map(target => (
              <button
                key={target.id}
                className="on-menu-item justify-between"
                onClick={() => void handleMovePage(target.id)}
              >
                <span className="truncate">{target.title || t("sidebar.untitled")}</span>
                {page.parent_id === target.id && <Check className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
              </button>
            ))}
            {moveProjectTargets.map(target => (
              <button
                key={`project-target-${target.id}`}
                className="on-menu-item justify-between"
                onClick={() => void handleMovePage(target.id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {target.icon ? (
                    <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center text-xs">{target.icon}</span>
                  ) : (
                    <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{target.title || t("sidebar.untitled")}</span>
                </span>
                {page.parent_id === target.id && <Check className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
              </button>
            ))}
            {moveTargets.length === 0 && moveProjectTargets.length === 0 && moveQuery.trim() && (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t("sidebar.noPagesFound")}</div>
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
            {t("sidebar.contextRename")}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => void handleImportPdf(event)}
          >
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            {t("sidebar.contextImportPdf")}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => void handleDuplicatePage(event)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            {t("sidebar.contextDuplicate")}
          </button>
          <div className="on-menu-separator" />
          <button
            className="on-menu-item"
            onClick={(event) => void handleToggleTemplate(event)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            {page.is_template === 1 ? t("sidebar.contextRemoveFromTemplates") : t("sidebar.contextUseAsTemplate")}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => {
              setContextMenuPosition(null);
              void handleAddSubpage(event);
            }}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            {t("sidebar.contextNewSubpage")}
          </button>
          <button
            className="on-menu-item"
            onClick={() => {
              openMoveMenuAt(contextMenuPosition.left, contextMenuPosition.top);
              setContextMenuPosition(null);
            }}
          >
            <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
            {t("sidebar.contextMove")}
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
            {t("sidebar.contextDelete")}
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
              childrenByParentId={childrenByParentId}
              allPages={allPages}
              projectMoveTargets={projectMoveTargets}
              studioContextsByPageId={studioContextsByPageId}
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

function ProjectItem({
  project,
  children,
  contentPages,
  childrenByParentId,
  projectMoveTargets,
  studioContextsByPageId,
  depth = 0,
  onRequestDelete,
  draggedPageId,
  dropTarget,
  forcedExpandedPageId,
  forcedCollapsedPageId,
  renameRequestedPageId,
  onRenameHandled,
  onRequestRenamePage,
  onPointerDownPage,
}: {
  project: Page;
  children: Page[];
  contentPages: Page[];
  childrenByParentId: Map<string | null, Page[]>;
  projectMoveTargets: Page[];
  studioContextsByPageId: Map<string, PageStudioContext[]>;
  depth?: number;
  onRequestDelete: (pendingDelete: PendingDelete) => void;
  draggedPageId: string | null;
  dropTarget: DropTarget | null;
  forcedExpandedPageId: string | null;
  forcedCollapsedPageId: string | null;
  renameRequestedPageId: string | null;
  onRenameHandled: () => void;
  onRequestRenamePage: (pageId: string) => void;
  onPointerDownPage: (event: React.PointerEvent<HTMLDivElement>, page: Page) => void;
}) {
  const { addPage, importStudioPdfAction, renamePageAction, toggleFavoriteAction } = useAppStore(useShallow((s) => ({
    addPage: s.addPage,
    importStudioPdfAction: s.importStudioPdfAction,
    renamePageAction: s.renamePageAction,
    toggleFavoriteAction: s.toggleFavoriteAction,
  })));
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(() => storedExpandedState(project.id));
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(project.title || t("sidebar.untitled"));
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const hasChildren = children.length > 0;
  const ProjectFolderIcon = isExpanded ? FolderOpen : Folder;

  const setExpanded = (expanded: boolean) => {
    storeExpandedState(project.id, expanded);
    setIsExpanded(expanded);
  };

  useEffect(() => {
    if (!isRenaming) {
      setDraftTitle(project.title || t("sidebar.untitled"));
    }
  }, [isRenaming, project.title, t]);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (forcedExpandedPageId === project.id) {
      setExpanded(true);
    }
  }, [forcedExpandedPageId, project.id]);

  useEffect(() => {
    if (forcedCollapsedPageId === project.id) {
      setExpanded(false);
    }
  }, [forcedCollapsedPageId, project.id]);

  useEffect(() => {
    if (renameRequestedPageId === project.id) {
      setDraftTitle(project.title || t("sidebar.untitled"));
      setIsRenaming(true);
      onRenameHandled();
    }
  }, [onRenameHandled, project.id, project.title, renameRequestedPageId, t]);

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

  const commitRename = async () => {
    const nextTitle = normalizePageTitle(draftTitle);
    setIsRenaming(false);
    setDraftTitle(nextTitle);

    if (nextTitle !== project.title) {
      await renamePageAction(project.id, nextTitle);
    }
  };

  const cancelRename = () => {
    setDraftTitle(project.title || t("sidebar.untitled"));
    setIsRenaming(false);
  };

  const startRename = (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    setDraftTitle(project.title || t("sidebar.untitled"));
    setIsRenaming(true);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    closeOpenOverlays();
    setContextMenuPosition(
      clampContextMenuPosition(event.clientX, event.clientY, window.innerWidth, window.innerHeight, 220, 210)
    );
  };

  const handleToggleFavorite = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    await toggleFavoriteAction(project.id, project.is_favorite !== 1);
  };

  const handleAddPage = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    setExpanded(true);
    const created = await addPage(t("sidebar.untitled"), project.id);
    if (created) onRequestRenamePage(created.id);
  };

  const handleImportPdf = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    setExpanded(true);
    await importStudioPdfAction(project.id);
  };

  const handleDeleteProject = (event: React.MouseEvent) => {
    event.stopPropagation();
    setContextMenuPosition(null);
    onRequestDelete({ page: project, hasChildren, kind: 'project' });
  };

  const dropClass = dropTarget?.pageId === project.id
    ? 'on-sidebar-drop-inside'
    : '';

  return (
    <div>
      <div
        data-page-id={project.id}
        className={`group on-shell-row on-sidebar-page-row on-sidebar-project-row mb-[1px] cursor-pointer justify-between py-[2px] text-[13.5px] select-none ${dropClass} ${draggedPageId === project.id ? 'opacity-45' : ''}`}
        style={{ paddingLeft: `${(depth * 12) + 5}px`, paddingRight: '6px' }}
        aria-expanded={isExpanded}
        onClick={() => setExpanded(!isExpanded)}
        onDoubleClick={startRename}
        onContextMenu={handleContextMenu}
      >
        <div className="flex min-w-0 flex-1 items-center truncate">
          {project.icon ? (
            <span className="mr-1.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center text-[13.5px]">
              {project.icon}
            </span>
          ) : (
            <ProjectFolderIcon className="mr-1.5 h-[18px] w-[18px] flex-shrink-0 text-muted-foreground" strokeWidth={1.8} />
          )}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="on-sidebar-rename-input"
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
            <span className="truncate">{project.title || t("sidebar.untitled")}</span>
          )}
        </div>
        <div className={`flex flex-shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${isRenaming ? 'hidden' : ''}`}>
          <button
            className="on-sidebar-pin-button h-6 w-6"
            title={t("sidebar.contextMenu")}
            aria-label={t("sidebar.contextMenu")}
            onClick={handleContextMenu}
          >
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            className="on-sidebar-pin-button h-6 w-6 mr-1"
            title={t("sidebar.contextNewPage")}
            aria-label={t("sidebar.contextNewPage")}
            onClick={(event) => void handleAddPage(event)}
          >
            <SquarePen className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {contextMenuPosition && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[180] w-56 on-popover on-page-action-popover"
          style={sidebarPopoverStyle(contextMenuPosition.left, contextMenuPosition.top)}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="on-menu-item" onClick={(event) => startRename(event)}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            {t("sidebar.contextRename")}
          </button>
          <button className="on-menu-item" onClick={(event) => void handleAddPage(event)}>
            <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
            {t("sidebar.contextNewPage")}
          </button>
          <button className="on-menu-item" onClick={(event) => void handleImportPdf(event)}>
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            {t("sidebar.contextImportPdf")}
          </button>
          <div className="on-menu-separator" />
          <button className="on-menu-item" onClick={(event) => void handleToggleFavorite(event)}>
            <Pin className={`h-3.5 w-3.5 text-muted-foreground ${project.is_favorite === 1 ? 'fill-current' : ''}`} />
            {project.is_favorite === 1 ? t("sidebar.contextRemoveFromFavorites") : t("sidebar.contextAddToFavorites")}
          </button>
          <div className="on-menu-separator" />
          <button className="on-menu-item on-menu-item-danger" onClick={(event) => handleDeleteProject(event)}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("sidebar.contextDelete")}
          </button>
        </div>,
        document.body
      )}

      {hasChildren && (
        <div
          className={`on-sidebar-project-children ${isExpanded ? 'on-sidebar-project-children-open' : ''}`}
          aria-hidden={!isExpanded}
        >
          <div className="on-sidebar-project-children-inner">
            {children.map(child => (
              <PageItem
                key={child.id}
                page={child}
                childrenByParentId={childrenByParentId}
                allPages={contentPages}
                projectMoveTargets={projectMoveTargets}
                studioContextsByPageId={studioContextsByPageId}
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
        </div>
      )}
    </div>
  );
}

function storedStudioTreeExpanded(key: string): boolean {
  return localStorage.getItem(`opennotion-${key}-expanded`) !== 'false';
}

function storeStudioTreeExpanded(key: string, expanded: boolean) {
  localStorage.setItem(`opennotion-${key}-expanded`, String(expanded));
}

function StudioNotesTree({
  documents,
  currentPageId,
  onSelectPage,
  onSelectDocument,
}: {
  documents: StudioNoteDocument[];
  currentPageId: string | null;
  onSelectPage: (id: string) => void;
  onSelectDocument: (id: string) => void;
}) {
  const t = useT();
  const [expandedDocumentIds, setExpandedDocumentIds] = useState<Set<string>>(() => new Set());
  const knownDocumentIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setExpandedDocumentIds((currentIds) => {
      const liveDocumentIds = new Set(documents.map((document) => document.id));
      const nextIds = new Set([...currentIds].filter((id) => liveDocumentIds.has(id)));
      let changed = nextIds.size !== currentIds.size;

      for (const document of documents) {
        if (!knownDocumentIdsRef.current.has(document.id)) {
          knownDocumentIdsRef.current.add(document.id);
          if (storedStudioTreeExpanded(`studio-note-document-${document.id}`)) {
            nextIds.add(document.id);
            changed = true;
          }
        }
      }

      return changed ? nextIds : currentIds;
    });
  }, [documents]);

  const toggleDocument = (documentId: string) => {
    setExpandedDocumentIds((currentIds) => {
      const nextIds = new Set(currentIds);
      const nextExpanded = !nextIds.has(documentId);
      if (nextExpanded) {
        nextIds.add(documentId);
      } else {
        nextIds.delete(documentId);
      }
      storeStudioTreeExpanded(`studio-note-document-${documentId}`, nextExpanded);
      return nextIds;
    });
  };

  const renderNoteRow = (entry: StudioNoteEntry, document: StudioNoteDocument, depth: number) => (
    <button
      key={`studio-note-${document.id}-${entry.page.id}`}
      type="button"
      data-studio-note-id={entry.page.id}
      data-studio-note-document-id={document.id}
      className={`group on-studio-note-tree-row ${currentPageId === entry.page.id ? 'on-shell-row-active' : ''}`}
      style={{ paddingLeft: 12 + depth * 18 }}
      onClick={() => {
        onSelectDocument(document.id);
        onSelectPage(entry.page.id);
      }}
      title="Open Studio note in Notes"
    >
      <div className="flex min-w-0 items-center gap-2">
        {entry.page.icon && (
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[13.5px]">{entry.page.icon}</span>
        )}
        <span className="truncate">{entry.page.title || t("sidebar.untitled")}</span>
      </div>
      {entry.link?.pdf_page ? (
        <span className="on-studio-note-page-badge opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">p. {entry.link.pdf_page}</span>
      ) : null}
    </button>
  );

  const renderDocument = (document: StudioNoteDocument, depth: number) => {
    const isExpanded = expandedDocumentIds.has(document.id);
    const active = document.noteEntries.some((entry) => entry.page.id === currentPageId);

    return (
      <div key={`studio-note-doc-${document.id}`} className="on-studio-note-document-node" data-studio-note-document-id={document.id}>
        <button
          type="button"
          className={`group on-studio-note-document-row ${active ? 'on-shell-row-active' : ''}`}
          style={{ paddingLeft: 6 + depth * 18 }}
          aria-expanded={isExpanded}
          onClick={() => toggleDocument(document.id)}
          title={document.original_filename}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-left">{document.title}</span>
          <span className="on-studio-note-count opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{document.noteEntries.length}</span>
        </button>
        {isExpanded && document.noteEntries.map((entry) => renderNoteRow(entry, document, depth + 1))}
      </div>
    );
  };

  return <div className="on-studio-note-tree">{documents.map((document) => renderDocument(document, 0))}</div>;
}

export function Sidebar() {
  const t = useT();
  const {
    pages,
    fetchPages,
    addPage,
    addPageFromTemplate,
    removePage,
    movePageAction,
    reorderPagesAction,
    currentPageId,
    setCurrentPageId,
    isLoading,
    openCommandPalette,
    studioDocuments,
    studioDocumentPageLinks,
    fetchStudioDocuments,
    setCurrentStudioDocumentId,
    importStudioPdfAction,
    deleteStudioDocumentAction,
    createProjectAction,
    removeProjectAction,
    fetchProfile,
    profile,
  } = useAppStore(useShallow((s) => ({
    pages: s.pages,
    fetchPages: s.fetchPages,
    addPage: s.addPage,
    addPageFromTemplate: s.addPageFromTemplate,
    removePage: s.removePage,
    movePageAction: s.movePageAction,
    reorderPagesAction: s.reorderPagesAction,
    currentPageId: s.currentPageId,
    setCurrentPageId: s.setCurrentPageId,
    isLoading: s.isLoading,
    openCommandPalette: s.openCommandPalette,
    studioDocuments: s.studioDocuments,
    studioDocumentPageLinks: s.studioDocumentPageLinks,
    fetchStudioDocuments: s.fetchStudioDocuments,
    setCurrentStudioDocumentId: s.setCurrentStudioDocumentId,
    importStudioPdfAction: s.importStudioPdfAction,
    deleteStudioDocumentAction: s.deleteStudioDocumentAction,
    createProjectAction: s.createProjectAction,
    removeProjectAction: s.removeProjectAction,
    fetchProfile: s.fetchProfile,
    profile: s.profile,
  })));
  const {
    sidebarWidth,
    theme,
    setTheme,
    openSettingsWindow,
  } = useUIStore(useShallow((state) => ({
    sidebarWidth: state.sidebarWidth,
    theme: state.theme,
    setTheme: state.setTheme,
    openSettingsWindow: state.openSettingsWindow,
  })));
  const sidebarRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPopoverRef = useRef<HTMLDivElement>(null);
  const newPageButtonRef = useRef<HTMLButtonElement>(null);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [newPageMenuPosition, setNewPageMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [forcedExpandedPageId, setForcedExpandedPageId] = useState<string | null>(null);
  const [forcedCollapsedPageId, setForcedCollapsedPageId] = useState<string | null>(null);
  const [renameRequestedPageId, setRenameRequestedPageId] = useState<string | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const sidebarModelRef = useRef<SidebarModel | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  useEffect(() => {
    void fetchStudioDocuments();
  }, [fetchStudioDocuments]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!isSettingsMenuOpen) return;

    const closeSettingsMenu = () => setIsSettingsMenuOpen(false);
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (settingsPopoverRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) {
        return;
      }
      closeSettingsMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSettingsMenu();
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeSettingsMenu);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeSettingsMenu);
    };
  }, [isSettingsMenuOpen]);

  const themeLabel = {
    system: t("settings.appearance.themeSystem"),
    light: t("settings.appearance.themeLight"),
    dark: t("settings.appearance.themeDark"),
  }[theme];
  const profileTitle = profile?.workspaceName || "Shelf";
  const profileSubtitle = profile?.name || t("settings.card.localWorkspace");
  const avatarInitial = (profile?.name || profile?.workspaceName || "S").trim().charAt(0).toUpperCase() || "S";

  const openSettingsSection = (section: SettingsSection) => {
    setIsSettingsMenuOpen(false);
    openSettingsWindow(section);
  };

  const sidebarModel: SidebarModel = useMemo(() => {
    const sidebarSections = buildSidebarSections(pages);
    const { pinnedProjects, pinnedPages, projects, rootPages, contentPages } = sidebarSections;
    const pagesById = new Map(pages.map((page) => [page.id, page]));
    const unpinnedContentPages = contentPages.filter((page) => page.is_favorite !== 1);
    const unpinnedChildrenByParentId = new Map<string | null, Page[]>();
    for (const page of unpinnedContentPages) {
      const children = unpinnedChildrenByParentId.get(page.parent_id);
      if (children) {
        children.push(page);
      } else {
        unpinnedChildrenByParentId.set(page.parent_id, [page]);
      }
    }
    const projectMoveTargets = sortSidebarPages(pages.filter((page) => page.page_kind === 'project' && page.is_deleted === 0));
    const pinnedProjectGroups = pinnedProjects.map((project) => ({
      project,
      children: unpinnedChildrenByParentId.get(project.id) ?? [],
    }));
    const regularNotePages = contentPages.filter((page) => page.page_kind === 'note');
    const rootRegularPages = rootPages.filter((page) => page.page_kind === 'note');
    const studioNotePages = sortPages(rootPages.filter((page) => page.page_kind === 'studio_note'));
    const studioContextsByPageId = buildPageStudioContexts(studioDocuments, studioDocumentPageLinks);
    const { documents: studioNoteDocuments, linkedPageIds: groupedStudioNoteIds } = buildStudioNoteDocuments(
      studioDocuments,
      studioDocumentPageLinks,
      studioNotePages
    );
    const ungroupedStudioNotes = studioNotePages.filter((page) => !groupedStudioNoteIds.has(page.id));
    const sortedPages = sortPages(regularNotePages);
    const templatePages = sortedPages.filter(p => p.is_template === 1);

    return {
      pinnedProjects,
      pinnedPages,
      projects,
      rootRegularPages,
      unpinnedContentPages,
      unpinnedChildrenByParentId,
      pagesById,
      projectMoveTargets,
      pinnedProjectGroups,
      regularNotePages,
      studioContextsByPageId,
      studioNoteDocuments,
      ungroupedStudioNotes,
      templatePages,
    };
  }, [pages, studioDocumentPageLinks, studioDocuments]);
  const {
    pinnedProjects,
    pinnedPages,
    projects,
    rootRegularPages,
    unpinnedContentPages,
    unpinnedChildrenByParentId,
    pagesById,
    projectMoveTargets,
    pinnedProjectGroups,
    regularNotePages,
    studioContextsByPageId,
    studioNoteDocuments,
    ungroupedStudioNotes,
    templatePages,
  } = sidebarModel;
  useEffect(() => {
    sidebarModelRef.current = sidebarModel;
  }, [sidebarModel]);
  const pendingDeleteStudioDocument = pendingDelete
    && pendingDelete.kind !== 'project'
    ? studioDocuments.find((doc) => doc.note_page_id === pendingDelete.page.id) ?? null
    : null;

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

  const handleCreateProject = async () => {
    const project = await createProjectAction(t("sidebar.newProjectName"));
    if (project) {
      setRenameRequestedPageId(project.id);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;

    if (pendingDelete.kind === 'project') {
      await removeProjectAction(pendingDelete.page.id);
    } else if (pendingDeleteStudioDocument) {
      await deleteStudioDocumentAction(pendingDeleteStudioDocument.id);
    } else {
      await removePage(pendingDelete.page.id);
    }
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

    const currentPage = currentPageId ? pagesById.get(currentPageId) : undefined;
    if (!currentPage) return;

    const childPages = unpinnedChildrenByParentId.get(currentPage.id) ?? [];
    const expandedIds = expandedPageIds(regularNotePages);
    const visibleIds = visiblePageIds(regularNotePages, expandedIds);
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
    const currentModel = sidebarModelRef.current;
    if (!currentModel) return;
    const draggedPage = currentModel.pagesById.get(sourceId);
    const targetPage = currentModel.pagesById.get(target.pageId);
    if (!draggedPage || !targetPage) return;

    if (target.position === 'inside') {
      setForcedExpandedPageId(targetPage.id);
      await movePageAction(sourceId, targetPage.id);
      return;
    }

    const siblingIds = (currentModel.unpinnedChildrenByParentId.get(targetPage.parent_id) ?? []).map(candidate => candidate.id);
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

    const currentModel = sidebarModelRef.current;
    if (!currentModel) return;
    const draggedPage = currentModel.pagesById.get(session.pageId);
    const targetPage = currentModel.pagesById.get(targetId);

    const rect = row.getBoundingClientRect();
    const rawPosition = dropPositionFromOffset(clientY - rect.top, rect.height);
    const position: DropPosition = targetPage?.page_kind === 'project' ? 'inside' : rawPosition;
    const isValidSiblingDrop = draggedPage?.parent_id === targetPage?.parent_id;
    const isValidCrossParentOrderDrop = Boolean(
      draggedPage &&
      targetPage &&
      position !== 'inside' &&
      targetPage.parent_id !== draggedPage.id &&
      !isDescendantPage(currentModel.pagesById, session.pageId, targetPage.parent_id || '')
    );
    const isValidInsideDrop = Boolean(
      draggedPage &&
      targetPage &&
      position === 'inside' &&
      !isDescendantPage(currentModel.pagesById, session.pageId, targetId)
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

  const hasPageContent = rootRegularPages.length > 0 || studioNoteDocuments.length > 0 || ungroupedStudioNotes.length > 0;
  const deleteTitle = pendingDelete?.page.title || t("sidebar.untitled");
  const deleteMessage = pendingDeleteStudioDocument
    ? `Delete "${deleteTitle}" and its PDF permanently? This cannot be undone.`
    : pendingDelete?.kind === 'project'
    ? t("sidebar.deleteProjectDialogBody", { title: deleteTitle })
    : pendingDelete?.hasChildren
    ? t("sidebar.deleteDialogBodyWithChildren", { title: deleteTitle })
    : t("sidebar.deleteDialogBody", { title: deleteTitle });
  const deleteDialogTitle = pendingDelete?.kind === 'project'
    ? t("sidebar.deleteProjectDialogTitle")
    : t("sidebar.deleteDialogTitle");
  const deleteDialog = pendingDelete ? createPortal(
    <div className="on-modal-overlay z-[180] items-center justify-center p-4" onMouseDown={() => setPendingDelete(null)}>
      <div className="on-modal-panel on-delete-dialog w-[420px] max-w-[calc(100vw-2rem)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="on-delete-dialog-content">
          <div className="on-delete-dialog-icon">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">{deleteDialogTitle}</div>
            <div className="mt-1 text-sm text-muted-foreground">{deleteMessage}</div>
          </div>
        </div>
        <div className="on-delete-dialog-actions">
          <button
            className="on-button-secondary"
            onClick={() => setPendingDelete(null)}
          >
            {t("common.cancel")}
          </button>
          <button
            className="on-button-danger"
            onClick={handleConfirmDelete}
          >
            {t("sidebar.contextDelete")}
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
      className="on-glass-sidebar relative m-2 flex h-[calc(100vh-1rem)] flex-col overflow-visible text-secondary-foreground outline-none ring-0 focus:outline-none focus:ring-0"
      style={{ width: sidebarWidth }}
      onKeyDown={handleSidebarKeyDown}
      onMouseDown={() => sidebarRef.current?.focus()}
    >
      <div className="on-sidebar-header-spacer flex-shrink-0" />
      <div className="on-sidebar-nav pl-2.5 pr-0.5">
        <button
          ref={newPageButtonRef}
          className="on-shell-row"
          onClick={(event) => {
            event.stopPropagation();
            toggleNewPageMenu();
          }}
        >
          <SquarePen className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>{t("sidebar.newPage")}</span>
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
              {t("sidebar.blankPage")}
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
                <span className="truncate">{template.title || t("sidebar.untitled")}</span>
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
          <span>{t("sidebar.search")}</span>
        </button>
        <button
          className="on-shell-row"
          onClick={() => void importStudioPdfAction(null)}
        >
          <Upload className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>{t("sidebar.importPdf")}</span>
        </button>
        <button
          className={`on-shell-row ${currentPageId === HOME_PAGE_ID ? 'on-shell-row-active' : ''}`}
          onClick={() => setCurrentPageId(HOME_PAGE_ID)}
        >
          <Home className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>{t("sidebar.home")}</span>
        </button>
        <button
          className="on-shell-row"
          onClick={() => void window.openNotion?.externalAssistant?.toggle()}
          title={t("sidebar.chat")}
        >
          <MessageSquare className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>{t("sidebar.chat")}</span>
        </button>
      </div>
      <div ref={scrollAreaRef} className="on-scroll-fade on-scroll-fade-sidebar flex-1 overflow-y-auto pt-3">
        {isLoading && (
          <div className="px-5 py-4 text-xs text-muted-foreground">{t("sidebar.loadingPages")}</div>
        )}
        <div className="pl-3 pr-1 pb-6">
          <section className="on-sidebar-section">
            <div className="on-section-label">{t("sidebar.sectionPinned")}</div>
            {pinnedProjectGroups.map(({ project, children }) => (
              <ProjectItem
                key={`pinned-project-${project.id}`}
                project={project}
                children={children}
                contentPages={unpinnedContentPages}
                childrenByParentId={unpinnedChildrenByParentId}
                projectMoveTargets={projectMoveTargets}
                studioContextsByPageId={studioContextsByPageId}
                onRequestDelete={setPendingDelete}
                draggedPageId={draggedPageId}
                dropTarget={dropTarget}
                forcedExpandedPageId={forcedExpandedPageId}
                forcedCollapsedPageId={forcedCollapsedPageId}
                renameRequestedPageId={renameRequestedPageId}
                onRenameHandled={() => setRenameRequestedPageId(null)}
                onRequestRenamePage={setRenameRequestedPageId}
                onPointerDownPage={handlePointerDownPage}
              />
            ))}
            {pinnedPages.map(page => (
              <PageItem
                key={`pinned-${page.id}`}
                page={page}
                childrenByParentId={unpinnedChildrenByParentId}
                allPages={unpinnedContentPages}
                projectMoveTargets={projectMoveTargets}
                studioContextsByPageId={studioContextsByPageId}
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
            {!isLoading && pinnedProjects.length === 0 && pinnedPages.length === 0 && (
              <div className="on-sidebar-empty">{t("sidebar.noPinnedPages")}</div>
            )}
          </section>

          <section className="on-sidebar-section">
            <div className="on-sidebar-section-heading">
              <div className="on-section-label">{t("sidebar.sectionProjects")}</div>
              <button
                type="button"
                className="on-sidebar-section-action"
                title={t("sidebar.createProject")}
                aria-label={t("sidebar.createProject")}
                onClick={() => void handleCreateProject()}
              >
                <FolderPlus className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
            {projects.map(({ project, children }) => (
              <ProjectItem
                key={project.id}
                project={project}
                children={children}
                contentPages={unpinnedContentPages}
                childrenByParentId={unpinnedChildrenByParentId}
                projectMoveTargets={projectMoveTargets}
                studioContextsByPageId={studioContextsByPageId}
                onRequestDelete={setPendingDelete}
                draggedPageId={draggedPageId}
                dropTarget={dropTarget}
                forcedExpandedPageId={forcedExpandedPageId}
                forcedCollapsedPageId={forcedCollapsedPageId}
                renameRequestedPageId={renameRequestedPageId}
                onRenameHandled={() => setRenameRequestedPageId(null)}
                onRequestRenamePage={setRenameRequestedPageId}
                onPointerDownPage={handlePointerDownPage}
              />
            ))}
            {!isLoading && projects.length === 0 && (
              <div className="on-sidebar-empty">{t("sidebar.noProjects")}</div>
            )}
          </section>

          <section className="on-sidebar-section">
            <div className="on-section-label">{t("sidebar.sectionPages")}</div>
            {!isLoading && !hasPageContent && (
              <div className="on-sidebar-empty">{t("sidebar.noPages")}</div>
            )}
            {rootRegularPages.map(page => (
              <PageItem
                key={page.id}
                page={page}
                childrenByParentId={unpinnedChildrenByParentId}
                allPages={unpinnedContentPages}
                projectMoveTargets={projectMoveTargets}
                studioContextsByPageId={studioContextsByPageId}
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
            {(studioNoteDocuments.length > 0 || ungroupedStudioNotes.length > 0) && (
            <div className="mt-1">
              {studioNoteDocuments.length > 0 && (
                <StudioNotesTree
                  documents={studioNoteDocuments}
                  currentPageId={currentPageId}
                  onSelectPage={setCurrentPageId}
                  onSelectDocument={setCurrentStudioDocumentId}
                />
              )}
              {ungroupedStudioNotes.length > 0 && (
                <div className="mt-2">
                  {ungroupedStudioNotes.map((page) => (
                    <button
                      key={`studio-note-orphan-${page.id}`}
                      type="button"
                      data-studio-note-id={page.id}
                      className={`group on-studio-note-tree-row ${currentPageId === page.id ? 'on-shell-row-active' : ''}`}
                      style={{ paddingLeft: 12 }}
                      onClick={() => setCurrentPageId(page.id)}
                      title="Open Studio note in Notes"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {page.icon && (
                          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[13.5px]">{page.icon}</span>
                        )}
                        <span className="truncate">{page.title || t("sidebar.untitled")}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
          </section>
        </div>
      </div>
      {deleteDialog}
      {isSettingsMenuOpen && settingsButtonRef.current && createPortal(
        <div
          ref={settingsPopoverRef}
          className="on-settings-quick-popover fixed z-[180]"
          style={{
            left: Math.max(12, settingsButtonRef.current.getBoundingClientRect().left),
            bottom: Math.max(12, window.innerHeight - settingsButtonRef.current.getBoundingClientRect().top + 8),
            width: Math.min(320, Math.max(280, sidebarWidth + 8)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="on-settings-quick-account">
            {profile?.avatarPath ? (
              <img className="on-settings-quick-avatar on-settings-quick-avatar-img" src={fileSrc(profile.avatarPath)} alt="" />
            ) : (
              <span className="on-settings-quick-avatar">{avatarInitial}</span>
            )}
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-normal text-foreground">{profileTitle}</div>
              <div className="truncate text-xs text-muted-foreground">{profileSubtitle}</div>
            </div>
          </div>

          <div className="on-settings-quick-divider" />

          <button type="button" className="on-settings-quick-action" onClick={() => openSettingsSection('profile')}>
            <UserCircle className="h-[18px] w-[18px]" strokeWidth={1.9} />
            <span>{t("settings.nav.profile")}</span>
          </button>
          <button type="button" className="on-settings-quick-action" onClick={() => openSettingsSection('data')}>
            <FolderInput className="h-[18px] w-[18px]" strokeWidth={1.9} />
            <span>{t("settings.nav.data")}</span>
          </button>
          <button type="button" className="on-settings-quick-action" onClick={() => openSettingsSection('updates')}>
            <RefreshCw className="h-[18px] w-[18px]" strokeWidth={1.9} />
            <span>{t("settings.updates.checkRow")}</span>
          </button>
          <button type="button" className="on-settings-quick-action" onClick={() => openSettingsSection('appearance')}>
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.9} />
            <span>{t("sidebar.settings")}</span>
          </button>

          <div className="on-settings-quick-divider" />

          <div className="on-settings-quick-stepper">
            <div className="on-settings-quick-stepper-label">
              <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.9} />
              <span>{t("settings.appearance.theme")}</span>
            </div>
            <div className="on-settings-quick-stepper-control">
              <button type="button" onClick={() => setTheme(cycleChoice(THEME_CHOICES, theme, -1))} aria-label={t("settings.appearance.theme")}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>{themeLabel}</span>
              <button type="button" onClick={() => setTheme(cycleChoice(THEME_CHOICES, theme, 1))} aria-label={t("settings.appearance.theme")}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <div className="on-sidebar-footer">
        <button
          ref={settingsButtonRef}
          type="button"
          className="on-sidebar-settings-button"
          aria-label={t("sidebar.settings")}
          title={t("sidebar.settings")}
          onClick={() => {
            if (isSettingsMenuOpen) {
              setIsSettingsMenuOpen(false);
              return;
            }
            closeOpenOverlays();
            setIsSettingsMenuOpen(true);
          }}
        >
          <Settings className="h-4 w-4" strokeWidth={1.9} />
          <span>{t("sidebar.settings")}</span>
        </button>
      </div>
    </div>
  );
}
