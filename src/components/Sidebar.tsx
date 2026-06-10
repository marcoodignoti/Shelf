import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { useT } from '../lib/i18n';
import { Plus, FileText, Trash2, ChevronRight, ChevronDown, Search, PlusCircle, Home, Settings, AlertTriangle, FolderInput, Check, Pencil, Pin, Copy, Folder, FolderOpen, Upload } from 'lucide-react';
import { Page } from '../lib/db';
import type { StudioDocument, StudioDocumentPageLink } from '../lib/studio';
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
import { DEFAULT_STUDIO_PROJECT_ID, groupStudioDocumentsByProject } from '../lib/studioDocuments';
import type { StudioProjectGroup } from '../lib/studioDocuments';

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
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(() => storedExpandedState(page.id));
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(page.title || t('sidebar.untitled'));
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
      setDraftTitle(page.title || t('sidebar.untitled'));
    }
  }, [isRenaming, page.title, t]);

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
      setDraftTitle(page.title || t('sidebar.untitled'));
      setIsRenaming(true);
      onRenameHandled();
    }
  }, [onRenameHandled, page.id, page.title, renameRequestedPageId, t]);

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
    setDraftTitle(page.title || t('sidebar.untitled'));
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
    setDraftTitle(page.title || t('sidebar.untitled'));
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
            <span className="truncate">{page.title || t('sidebar.untitled')}</span>
          )}
        </div>
        <div className={`flex items-center transition-opacity flex-shrink-0 ${isRenaming ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}>
          <button
            className="on-icon-button mr-0.5 h-6 w-6 rounded-md"
            title={page.is_favorite === 1 ? t('sidebar.removeFromFavorites') : t('sidebar.addToFavorites')}
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
              placeholder={t('sidebar.moveTo')}
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
              <span>{t('sidebar.moveRoot')}</span>
              {page.parent_id === null && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {moveTargets.map(target => (
              <button
                key={target.id}
                className="on-menu-item justify-between"
                onClick={() => void handleMovePage(target.id)}
              >
                <span className="truncate">{target.title || t('sidebar.untitled')}</span>
                {page.parent_id === target.id && <Check className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
              </button>
            ))}
            {moveTargets.length === 0 && moveQuery.trim() && (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t('sidebar.noPagesFound')}</div>
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
            {t('sidebar.contextRename')}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => void handleDuplicatePage(event)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            {t('sidebar.contextDuplicate')}
          </button>
          <div className="on-menu-separator" />
          <button
            className="on-menu-item"
            onClick={(event) => void handleToggleFavorite(event)}
          >
            <Pin className={`h-3.5 w-3.5 text-muted-foreground ${page.is_favorite === 1 ? 'fill-current' : ''}`} />
            {page.is_favorite === 1 ? t('sidebar.contextRemoveFromFavorites') : t('sidebar.contextAddToFavorites')}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => void handleToggleTemplate(event)}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            {page.is_template === 1 ? t('sidebar.contextRemoveFromTemplates') : t('sidebar.contextUseAsTemplate')}
          </button>
          <button
            className="on-menu-item"
            onClick={(event) => {
              setContextMenuPosition(null);
              void handleAddSubpage(event);
            }}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            {t('sidebar.contextNewSubpage')}
          </button>
          <button
            className="on-menu-item"
            onClick={() => {
              openMoveMenuAt(contextMenuPosition.left, contextMenuPosition.top);
              setContextMenuPosition(null);
            }}
          >
            <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
            {t('sidebar.contextMove')}
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
            {t('sidebar.contextDelete')}
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

type StudioNoteEntry = {
  page: Page;
  link: StudioDocumentPageLink | null;
};

type StudioNoteDocument = StudioDocument & {
  noteEntries: StudioNoteEntry[];
};

function storedStudioTreeExpanded(key: string): boolean {
  return localStorage.getItem(`opennotion-${key}-expanded`) !== 'false';
}

function storeStudioTreeExpanded(key: string, expanded: boolean) {
  localStorage.setItem(`opennotion-${key}-expanded`, String(expanded));
}

function studioNoteCount(
  group: StudioProjectGroup<StudioNoteDocument>,
  childrenByParentId: Map<string | null, StudioProjectGroup<StudioNoteDocument>[]>
): number {
  const directCount = group.documents.reduce((count, document) => count + document.noteEntries.length, 0);
  const childCount = (childrenByParentId.get(group.project.id) ?? [])
    .reduce((count, childGroup) => count + studioNoteCount(childGroup, childrenByParentId), 0);
  return directCount + childCount;
}

function buildStudioNoteDocuments(
  documents: StudioDocument[],
  links: StudioDocumentPageLink[],
  studioNotePages: Page[]
): { documents: StudioNoteDocument[]; linkedPageIds: Set<string> } {
  const studioNoteById = new Map(studioNotePages.map((page) => [page.id, page]));
  const linksByDocumentId = new Map<string, StudioDocumentPageLink[]>();
  const linkedPageIds = new Set<string>();

  for (const link of links) {
    if (link.page.page_kind !== 'studio_note') continue;
    linkedPageIds.add(link.page_id);
    const documentLinks = linksByDocumentId.get(link.document_id) ?? [];
    documentLinks.push(link);
    linksByDocumentId.set(link.document_id, documentLinks);
  }

  return {
    linkedPageIds,
    documents: documents
      .map((document) => {
        const linkedEntries = (linksByDocumentId.get(document.id) ?? [])
          .map((link) => ({ page: link.page, link }));
        const hasPrimaryLink = linkedEntries.some((entry) => entry.page.id === document.note_page_id);
        const primaryNote = studioNoteById.get(document.note_page_id);
        const entries = hasPrimaryLink || !primaryNote
          ? linkedEntries
          : [{ page: primaryNote, link: null }, ...linkedEntries];

        if (primaryNote) linkedPageIds.add(primaryNote.id);
        if (entries.length === 0) return null;
        return { ...document, noteEntries: entries };
      })
      .filter((document): document is StudioNoteDocument => Boolean(document)),
  };
}

function StudioNotesTree({
  groups,
  currentPageId,
  onSelectPage,
  onSelectDocument,
}: {
  groups: StudioProjectGroup<StudioNoteDocument>[];
  currentPageId: string | null;
  onSelectPage: (id: string) => void;
  onSelectDocument: (id: string) => void;
}) {
  const t = useT();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set([DEFAULT_STUDIO_PROJECT_ID]));
  const [expandedDocumentIds, setExpandedDocumentIds] = useState<Set<string>>(() => new Set());
  const knownProjectIdsRef = useRef<Set<string>>(new Set());
  const knownDocumentIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setExpandedProjectIds((currentIds) => {
      const liveProjectIds = new Set(groups.map((group) => group.project.id));
      const nextIds = new Set([...currentIds].filter((id) => id === DEFAULT_STUDIO_PROJECT_ID || liveProjectIds.has(id)));
      let changed = nextIds.size !== currentIds.size;

      if (!nextIds.has(DEFAULT_STUDIO_PROJECT_ID)) {
        nextIds.add(DEFAULT_STUDIO_PROJECT_ID);
        changed = true;
      }

      for (const group of groups) {
        if (!knownProjectIdsRef.current.has(group.project.id)) {
          knownProjectIdsRef.current.add(group.project.id);
          if (storedStudioTreeExpanded(`studio-note-project-${group.project.id}`)) {
            nextIds.add(group.project.id);
            changed = true;
          }
        }
      }

      return changed ? nextIds : currentIds;
    });
  }, [groups]);

  useEffect(() => {
    setExpandedDocumentIds((currentIds) => {
      const liveDocumentIds = new Set(groups.flatMap((group) => group.documents.map((document) => document.id)));
      const nextIds = new Set([...currentIds].filter((id) => liveDocumentIds.has(id)));
      let changed = nextIds.size !== currentIds.size;

      for (const group of groups) {
        for (const document of group.documents) {
          if (!knownDocumentIdsRef.current.has(document.id)) {
            knownDocumentIdsRef.current.add(document.id);
            if (storedStudioTreeExpanded(`studio-note-document-${document.id}`)) {
              nextIds.add(document.id);
              changed = true;
            }
          }
        }
      }

      return changed ? nextIds : currentIds;
    });
  }, [groups]);

  const groupsById = new Map(groups.map((group) => [group.project.id, group]));
  const childGroupsByParentId = new Map<string | null, StudioProjectGroup<StudioNoteDocument>[]>();

  for (const group of groups) {
    const parentId = group.project.id === DEFAULT_STUDIO_PROJECT_ID
      ? null
      : group.project.parent_id && groupsById.has(group.project.parent_id)
        ? group.project.parent_id
        : null;
    const siblings = childGroupsByParentId.get(parentId) ?? [];
    siblings.push(group);
    childGroupsByParentId.set(parentId, siblings);
  }

  const rootGroups = [...(childGroupsByParentId.get(null) ?? [])].sort((first, second) => {
    if (first.project.id === DEFAULT_STUDIO_PROJECT_ID) return -1;
    if (second.project.id === DEFAULT_STUDIO_PROJECT_ID) return 1;
    return 0;
  });

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((currentIds) => {
      const nextIds = new Set(currentIds);
      const nextExpanded = !nextIds.has(projectId);
      if (nextExpanded) {
        nextIds.add(projectId);
      } else {
        nextIds.delete(projectId);
      }
      nextIds.add(DEFAULT_STUDIO_PROJECT_ID);
      storeStudioTreeExpanded(`studio-note-project-${projectId}`, nextExpanded);
      return nextIds;
    });
  };

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
      style={{ paddingLeft: 18 + depth * 18 }}
      onClick={() => {
        onSelectDocument(document.id);
        onSelectPage(entry.page.id);
      }}
      title={t('sidebar.openStudioNoteInNotes')}
    >
      <div className="flex min-w-0 items-center gap-2">
        {entry.page.icon ? (
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[13px]">{entry.page.icon}</span>
        ) : (
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{entry.page.title || t('sidebar.untitled')}</span>
      </div>
      {entry.link?.pdf_page ? (
        <span className="on-studio-note-page-badge">p. {entry.link.pdf_page}</span>
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
          className={`on-studio-note-document-row ${active ? 'on-shell-row-active' : ''}`}
          style={{ paddingLeft: 10 + depth * 18 }}
          aria-expanded={isExpanded}
          onClick={() => toggleDocument(document.id)}
          title={document.original_filename}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">{document.title}</span>
          <span className="on-studio-note-count">{document.noteEntries.length}</span>
        </button>
        {isExpanded && document.noteEntries.map((entry) => renderNoteRow(entry, document, depth + 1))}
      </div>
    );
  };

  const renderProjectGroup = (group: StudioProjectGroup<StudioNoteDocument>, depth: number) => {
    const isExpanded = expandedProjectIds.has(group.project.id);
    const childGroups = childGroupsByParentId.get(group.project.id) ?? [];
    const count = studioNoteCount(group, childGroupsByParentId);

    return (
      <div
        key={`studio-note-project-${group.project.id}`}
        className="on-studio-note-project-node"
        data-studio-note-project-id={group.project.id}
        data-studio-note-project-parent-id={group.project.parent_id ?? ""}
        data-studio-note-project-depth={depth}
      >
        <button
          type="button"
          className="on-studio-note-project-row"
          style={{ paddingLeft: 6 + depth * 18 }}
          aria-expanded={isExpanded}
          onClick={() => toggleProject(group.project.id)}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
          {isExpanded ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" /> : <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate text-left">{group.project.name}</span>
          <span className="on-studio-note-count">{count}</span>
        </button>
        {isExpanded && (
          <>
            {group.documents.map((document) => renderDocument(document, depth + 1))}
            {childGroups.map((childGroup) => renderProjectGroup(childGroup, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return <div className="on-studio-note-tree">{rootGroups.map((group) => renderProjectGroup(group, 0))}</div>;
}

export function Sidebar() {
  const {
    pages,
    fetchPages,
    fetchProfile,
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
    studioDocumentPageLinks,
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
  const t = useT();
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
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    void fetchStudioDocuments();
  }, [fetchStudioDocuments]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const regularNotePages = pages.filter((page) => page.page_kind === 'note');
  const studioNotePages = sortPages(pages.filter((page) => page.page_kind === 'studio_note'));
  const { documents: studioNoteDocuments, linkedPageIds: groupedStudioNoteIds } = buildStudioNoteDocuments(
    studioDocuments,
    studioDocumentPageLinks,
    studioNotePages
  );
  const studioNoteGroups = groupStudioDocumentsByProject(studioNoteDocuments, studioProjects);
  const ungroupedStudioNotes = studioNotePages.filter((page) => !groupedStudioNoteIds.has(page.id));
  const sortedPages = sortPages(regularNotePages);
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

  const handleImportPage = async () => {
    const importedPage = await useAppStore.getState().importPageAction();
    if (importedPage) {
      setCurrentPageId(importedPage.id);
    }
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

    const currentPage = regularNotePages.find(page => page.id === currentPageId);
    if (!currentPage) return;

    const childPages = sortedPages.filter(page => page.parent_id === currentPage.id);
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

  const deleteTitle = pendingDelete?.page.title || t('sidebar.untitled');
  const deleteMessage = pendingDelete?.hasChildren
    ? t('sidebar.deleteDialogBodyWithChildren', { title: deleteTitle })
    : t('sidebar.deleteDialogBody', { title: deleteTitle });
  const deleteDialog = pendingDelete ? createPortal(
    <div className="on-modal-overlay z-[180] items-center justify-center p-4" onMouseDown={() => setPendingDelete(null)}>
      <div className="on-modal-panel on-delete-dialog w-[420px] max-w-[calc(100vw-2rem)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="on-delete-dialog-content">
          <div className="on-delete-dialog-icon">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">{t('sidebar.deleteDialogTitle')}</div>
            <div className="mt-1 text-sm text-muted-foreground">{deleteMessage}</div>
          </div>
        </div>
        <div className="on-delete-dialog-actions">
          <button
            className="on-button-secondary"
            onClick={() => setPendingDelete(null)}
          >
            {t('common.cancel')}
          </button>
          <button
            className="on-button-danger"
            onClick={handleConfirmDelete}
          >
            {t('sidebar.contextDelete')}
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
      className="on-glass-sidebar relative m-2 flex h-[calc(100vh-1rem)] flex-col overflow-hidden text-secondary-foreground outline-none ring-0 focus:outline-none focus:ring-0"
      style={{ width: sidebarWidth }}
      onKeyDown={handleSidebarKeyDown}
      onMouseDown={() => sidebarRef.current?.focus()}
    >
      <div
        className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-border/70"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resizeSidebar')}
        onPointerDown={handleResizePointerDown}
      />
      <div className="on-sidebar-header-spacer flex-shrink-0" />

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
          <span>{t('sidebar.home')}</span>
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
          <span>{t('sidebar.newPage')}</span>
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
              {t('sidebar.blankPage')}
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
                <span className="truncate">{template.title || t('sidebar.untitled')}</span>
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              className="on-menu-item"
              onClick={() => {
                toggleNewPageMenu();
                void handleImportPage();
              }}
            >
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              {t('sidebar.importPage')}
            </button>
          </div>,
          document.body
        )}
        <button
          className="on-shell-row"
          onClick={openCommandPalette}
        >
          <Search className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>{t('sidebar.search')}</span>
        </button>
      </div>
      <div ref={scrollAreaRef} className="on-scroll-fade on-scroll-fade-sidebar flex-1 overflow-y-auto pt-3">
        {isLoading && (
          <div className="px-5 py-4 text-xs text-muted-foreground">{t('sidebar.loadingPages')}</div>
        )}
        {templatePages.length > 0 && (
          <div className="px-2 mb-4">
            <div className="on-section-label mb-1 mt-4">{t('sidebar.sectionTemplates')}</div>
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
            <div className="on-section-label mb-1 mt-4">{t('sidebar.sectionFavorites')}</div>
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
                  <span className="truncate">{page.title || t('sidebar.untitled')}</span>
                </div>
                <button
                  className="on-icon-button ml-1 h-6 w-6 rounded-md opacity-0 group-hover:opacity-100"
                  title={t('sidebar.removeFromFavorites')}
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
          <div className="on-section-label mb-1 mt-4">{t('sidebar.sectionPrivate')}</div>
          {!isLoading && rootPages.length === 0 && (
            <div className="mx-3 mt-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t('sidebar.noPrivatePages')}
              <button
                className="mt-2 block text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void addPage()}
              >
                {t('sidebar.createFirstPage')}
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
          {(studioNoteGroups.length > 0 || ungroupedStudioNotes.length > 0) && (
            <div className="mt-5">
              <div className="on-section-label mb-1">{t('sidebar.sectionStudioNotes')}</div>
              {studioNoteGroups.length > 0 && (
                <StudioNotesTree
                  groups={studioNoteGroups}
                  currentPageId={currentPageId}
                  onSelectPage={setCurrentPageId}
                  onSelectDocument={setCurrentStudioDocumentId}
                />
              )}
              {ungroupedStudioNotes.length > 0 && (
                <div className="mt-2">
                  <div className="on-studio-note-orphan-label">{t('sidebar.sectionUnlinked')}</div>
                  {ungroupedStudioNotes.map((page) => (
                    <button
                      key={`studio-note-orphan-${page.id}`}
                      type="button"
                      data-studio-note-id={page.id}
                      className={`group on-studio-note-tree-row ${currentPageId === page.id ? 'on-shell-row-active' : ''}`}
                      style={{ paddingLeft: 18 }}
                      onClick={() => setCurrentPageId(page.id)}
                      title={t('sidebar.openStudioNoteInNotes')}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {page.icon ? (
                          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[13px]">{page.icon}</span>
                        ) : (
                          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{page.title || t('sidebar.untitled')}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
        </>
      )}
      {deleteDialog}
      <button
        type="button"
        className="on-sidebar-settings-button"
        aria-label={t('sidebar.settings')}
        title={t('sidebar.settings')}
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
