import { ChevronLeft, MoreHorizontal, ExternalLink, FileText, Folder, FolderOpen, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openStudioDocumentFile, revealStudioDocumentFile, StudioDocument, StudioProject } from "../lib/studio";
import { clampContextMenuPosition } from "../lib/contextMenu";
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from "../lib/overlay";
import { DEFAULT_STUDIO_PROJECT_ID, groupStudioDocumentsByProject, recentStudioDocuments, studioDocumentMetadata, studioProjectDepth } from "../lib/studioDocuments";

type StudioSidebarProps = {
  documents: StudioDocument[];
  projects: StudioProject[];
  currentDocumentId: string | null;
  isLoading: boolean;
  onImport: (projectId?: string | null) => void;
  onCreateProject: (name: string, parentId?: string | null) => void;
  onRenameProject: (id: string, name: string) => void;
  onMoveProject: (id: string, parentId: string | null) => void;
  onDeleteProject: (id: string) => void;
  onMoveDocument: (documentId: string, projectId: string | null) => void;
  onSelectDocument: (id: string) => void;
  onRenameDocument: (id: string, title: string) => void;
  onDeleteDocument: (id: string) => void;
};

const STUDIO_DOCUMENT_MENU_WIDTH = 220;
const STUDIO_DOCUMENT_MENU_HEIGHT = 178;
const STUDIO_PROJECT_MENU_WIDTH = 190;
const STUDIO_PROJECT_MENU_HEIGHT = 134;

type ProjectNameDialogRequest = {
  title: string;
  parentId: string | null;
};

function StudioProjectNameDialog({
  request,
  onCancel,
  onSubmit,
}: {
  request: ProjectNameDialogRequest;
  onCancel: () => void;
  onSubmit: (name: string, parentId: string | null) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return createPortal(
    <div className="on-modal-overlay z-[240] items-center justify-center p-4" onMouseDown={onCancel}>
      <form
        role="dialog"
        aria-label={request.title}
        className="on-modal-panel w-[340px] max-w-[calc(100vw-2rem)] p-4"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedName = name.trim();
          if (trimmedName) onSubmit(trimmedName, request.parentId);
        }}
      >
        <div className="text-sm font-semibold text-foreground">{request.title}</div>
        <input
          ref={inputRef}
          aria-label="Project name"
          className="mt-3 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="on-button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="on-button-primary" disabled={!name.trim()}>
            Create
          </button>
        </div>
      </form>
    </div>,
    globalThis.document.body
  );
}

function StudioDocumentRenameDialog({
  initialTitle,
  onCancel,
  onSubmit,
}: {
  initialTitle: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return createPortal(
    <div className="on-modal-overlay z-[240] items-center justify-center p-4" onMouseDown={onCancel}>
      <form
        role="dialog"
        aria-label="Rename Studio document"
        className="on-modal-panel w-[360px] max-w-[calc(100vw-2rem)] p-4"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const nextTitle = title.trim();
          if (nextTitle) onSubmit(nextTitle);
        }}
      >
        <div className="text-sm font-semibold text-foreground">Rename Studio document</div>
        <input
          ref={inputRef}
          aria-label="Document title"
          className="mt-3 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="on-button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="on-button-primary" disabled={!title.trim()}>
            Rename
          </button>
        </div>
      </form>
    </div>,
    globalThis.document.body
  );
}

function StudioDocumentRow({
  document,
  active,
  onSelect,
  onRename,
  onDelete,
  projects,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  document: StudioDocument;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  projects: StudioProject[];
  onMove: (projectId: string | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);

  useEffect(() => {
    if (!menuPosition) return;

    const closeMenu = () => setMenuPosition(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);
    };
  }, [menuPosition]);

  const openMenu = (clientX: number, clientY: number) => {
    closeOpenOverlays();
    setMenuPosition(
      clampContextMenuPosition(
        clientX,
        clientY,
        window.innerWidth,
        window.innerHeight,
        STUDIO_DOCUMENT_MENU_WIDTH,
        STUDIO_DOCUMENT_MENU_HEIGHT
      )
    );
  };

  const handleRename = () => {
    setMenuPosition(null);
    setIsRenameDialogOpen(true);
  };

  const handleDelete = () => {
    setMenuPosition(null);
    if (window.confirm(`Delete "${document.title}" and its linked note? This cannot be undone.`)) {
      onDelete();
    }
  };

  const handleReveal = () => {
    setMenuPosition(null);
    void revealStudioDocumentFile(document.id);
  };

  const handleOpen = () => {
    setMenuPosition(null);
    void openStudioDocumentFile(document.id);
  };

  const handleMove = (projectId: string | null) => {
    setMenuPosition(null);
    onMove(projectId);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        draggable
        data-studio-document-id={document.id}
        className={`on-shell-row on-sidebar-page-row group mb-[1px] justify-between py-[3px] text-[13px] ${active ? "on-shell-row-active" : ""}`}
        onClick={onSelect}
        onDragStart={(event) => {
          closeOpenOverlays();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-opennotion-studio-document-id", document.id);
          event.dataTransfer.setData("text/plain", document.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        }}
        title={document.original_filename}
      >
        <div className="flex min-w-0 items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="min-w-0 text-left">
            <span className="block truncate">{document.title}</span>
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {studioDocumentMetadata(document)}
            </span>
          </span>
        </div>
        <button
          type="button"
          aria-label={`Actions for ${document.title}`}
          className={`ml-2 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground ${menuPosition ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openMenu(event.clientX, event.clientY);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(rect.right, rect.bottom);
            }
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      {menuPosition &&
        createPortal(
          <div
            className="fixed z-[220] on-popover p-1"
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: STUDIO_DOCUMENT_MENU_WIDTH,
              maxHeight: Math.max(120, window.innerHeight - menuPosition.top - 12),
              overflowY: "auto",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="on-menu-item" onClick={handleRename}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Rename
            </button>
            <button type="button" className="on-menu-item" onClick={handleReveal}>
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              Reveal in Finder
            </button>
            <button type="button" className="on-menu-item" onClick={handleOpen}>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              Open PDF
            </button>
            <div className="my-1 border-t border-border/70" />
            <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Move to project
            </div>
            <button type="button" role="menuitem" className="on-menu-item" onClick={() => handleMove(null)}>
              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
              Move to Inbox
            </button>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                role="menuitem"
                className="on-menu-item"
                onClick={() => handleMove(project.id)}
              >
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                Move to {project.name}
              </button>
            ))}
            <div className="my-1 border-t border-border/70" />
            <button type="button" className="on-menu-item text-destructive hover:text-destructive" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete document
            </button>
          </div>,
          globalThis.document.body
        )}
      {isRenameDialogOpen && (
        <StudioDocumentRenameDialog
          initialTitle={document.title}
          onCancel={() => setIsRenameDialogOpen(false)}
          onSubmit={(title) => {
            setIsRenameDialogOpen(false);
            onRename(title);
          }}
        />
      )}
    </>
  );
}

function StudioProjectHeader({
  project,
  count,
  depth,
  active,
  onOpen,
  onCreateChild,
  onRename,
  onDelete,
  onProjectDragStart,
  onProjectDragEnd,
}: {
  project: StudioProject;
  count: number;
  depth: number;
  active: boolean;
  onOpen: () => void;
  onCreateChild: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onProjectDragStart: () => void;
  onProjectDragEnd: () => void;
}) {
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isInbox = project.id === DEFAULT_STUDIO_PROJECT_ID;

  useEffect(() => {
    if (!menuPosition) return;

    const closeMenu = () => setMenuPosition(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, closeMenu);
    };
  }, [menuPosition]);

  const openMenu = (clientX: number, clientY: number) => {
    closeOpenOverlays();
    setMenuPosition(
      clampContextMenuPosition(
        clientX,
        clientY,
        window.innerWidth,
        window.innerHeight,
        STUDIO_PROJECT_MENU_WIDTH,
        STUDIO_PROJECT_MENU_HEIGHT
      )
    );
  };

  const handleRename = () => {
    setMenuPosition(null);
    setDraftName(project.name);
    setIsRenaming(true);
  };

  const handleCreateChild = () => {
    setMenuPosition(null);
    onCreateChild();
  };

  const handleDelete = () => {
    setMenuPosition(null);
    if (window.confirm(`Delete "${project.name}"? Documents move back to Inbox.`)) {
      onDelete();
    }
  };

  useEffect(() => {
    if (!isRenaming) setDraftName(project.name);
  }, [isRenaming, project.name]);

  useEffect(() => {
    if (!isRenaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isRenaming]);

  const submitRename = () => {
    const nextName = draftName.trim();
    setIsRenaming(false);
    setDraftName(project.name);
    if (nextName && nextName !== project.name) onRename(nextName);
  };

  return (
    <>
      <div
        className={`mb-1 flex items-center gap-2 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground ${active ? "bg-accent/60" : ""}`}
        style={{ paddingLeft: 12 + depth * 10 }}
      >
        <span
          draggable={!isInbox}
          data-studio-project-drag-handle={isInbox ? undefined : ""}
          className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center ${isInbox ? "" : "cursor-grab active:cursor-grabbing"}`}
          onDragStart={(event) => {
            if (isInbox) return;
            closeOpenOverlays();
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-opennotion-studio-project-id", project.id);
            event.dataTransfer.setData("text/plain", project.id);
            onProjectDragStart();
          }}
          onDragEnd={onProjectDragEnd}
        >
          {active ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
        </span>
        {isRenaming && !isInbox ? (
          <input
            ref={inputRef}
            aria-label="Project name"
            className="min-w-0 flex-1 rounded-md border border-border/70 bg-background/70 px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-ring"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={submitRename}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setIsRenaming(false);
                setDraftName(project.name);
              }
            }}
          />
        ) : (
          <button
            type="button"
            aria-label={`Open project ${project.name}`}
            className="min-w-0 flex-1 truncate text-left text-foreground/80 hover:text-foreground"
            onClick={onOpen}
            onDoubleClick={() => {
              if (!isInbox) handleRename();
            }}
          >
            {project.name}
          </button>
        )}
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
        {!isInbox && (
          <button
            type="button"
            aria-label={`Actions for project ${project.name}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              openMenu(event.clientX, event.clientY);
            }}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {menuPosition &&
        createPortal(
          <div
            className="fixed z-[220] on-popover p-1"
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: STUDIO_PROJECT_MENU_WIDTH,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" className="on-menu-item" onClick={handleRename}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Rename project
            </button>
            <button type="button" role="menuitem" className="on-menu-item" onClick={handleCreateChild}>
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              New subfolder
            </button>
            <button type="button" role="menuitem" className="on-menu-item text-destructive hover:text-destructive" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete project
            </button>
          </div>,
          globalThis.document.body
        )}
    </>
  );
}

export function StudioSidebar({
  documents,
  projects,
  currentDocumentId,
  isLoading,
  onImport,
  onCreateProject,
  onRenameProject,
  onMoveProject,
  onDeleteProject,
  onMoveDocument,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
}: StudioSidebarProps) {
  const recent = recentStudioDocuments(documents, 4);
  const projectGroups = groupStudioDocumentsByProject(documents, projects);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dropProjectId, setDropProjectId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectNameDialog, setProjectNameDialog] = useState<ProjectNameDialogRequest | null>(null);

  const currentProject = currentProjectId === DEFAULT_STUDIO_PROJECT_ID
    ? projectGroups.find((group) => group.project.id === DEFAULT_STUDIO_PROJECT_ID)?.project ?? null
    : projects.find((project) => project.id === currentProjectId) ?? null;
  const currentImportProjectId = currentProjectId && currentProjectId !== DEFAULT_STUDIO_PROJECT_ID
    ? currentProjectId
    : null;

  useEffect(() => {
    if (!currentProjectId) return;
    if (currentProjectId === DEFAULT_STUDIO_PROJECT_ID) return;
    if (!projects.some((project) => project.id === currentProjectId)) {
      setCurrentProjectId(null);
    }
  }, [currentProjectId, projects]);

  const handleCreateProject = () => {
    setProjectNameDialog({
      title: currentImportProjectId ? "New Studio subfolder" : "New Studio project",
      parentId: currentImportProjectId,
    });
  };

  const handleSubmitProjectName = (name: string, parentId: string | null) => {
    setProjectNameDialog(null);
    onCreateProject(name, parentId);
  };

  const openChildProjectDialog = (parentId: string) => {
    setProjectNameDialog({
      title: "New Studio subfolder",
      parentId,
    });
  };

  const clearDragState = () => {
    setDraggedDocumentId(null);
    setDraggedProjectId(null);
    setDropProjectId(null);
  };

  const isProjectDescendant = (projectId: string, possibleDescendantId: string): boolean => {
    let parentId = projects.find((project) => project.id === possibleDescendantId)?.parent_id ?? null;
    const seenProjectIds = new Set<string>([possibleDescendantId]);

    while (parentId) {
      if (parentId === projectId) return true;
      if (seenProjectIds.has(parentId)) return false;
      seenProjectIds.add(parentId);
      parentId = projects.find((project) => project.id === parentId)?.parent_id ?? null;
    }

    return false;
  };

  const canMoveProject = (projectId: string, targetParentId: string): boolean => {
    if (projectId === targetParentId) return false;
    if (targetParentId === DEFAULT_STUDIO_PROJECT_ID) return false;
    return !isProjectDescendant(projectId, targetParentId);
  };

  const moveDraggedProject = (projectId: string, targetParentId: string) => {
    if (!canMoveProject(projectId, targetParentId)) return;
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    if ((project.parent_id ?? null) === targetParentId) return;
    onMoveProject(projectId, targetParentId);
  };

  const moveDraggedDocument = (documentId: string, projectId: string) => {
    const targetProjectId = projectId === DEFAULT_STUDIO_PROJECT_ID ? null : projectId;
    const document = documents.find((candidate) => candidate.id === documentId);
    if (!document) return;
    if ((document.project_id ?? null) === targetProjectId) return;
    onMoveDocument(documentId, targetProjectId);
  };

  const visibleProjectGroups = projectGroups.filter((group) => {
    if (!currentProjectId) {
      return group.project.id === DEFAULT_STUDIO_PROJECT_ID || !group.project.parent_id;
    }

    if (currentProjectId === DEFAULT_STUDIO_PROJECT_ID) {
      return group.project.id === DEFAULT_STUDIO_PROJECT_ID;
    }

    return group.project.id === currentProjectId || group.project.parent_id === currentProjectId;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2">
        <button type="button" className="on-studio-import-button" onClick={() => onImport(currentImportProjectId)}>
          <Upload className="h-4 w-4" />
          <span>Import PDF</span>
        </button>
      </div>
      <div className="on-scroll-fade on-scroll-fade-sidebar flex-1 overflow-y-auto px-2 pb-20 pt-3">
        {isLoading && (
          <div className="mx-1 flex items-center gap-2 rounded-xl border border-border/60 bg-background/35 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading Studio documents...
          </div>
        )}
        {!isLoading && documents.length === 0 && (
          <div className="mx-1 rounded-xl border border-dashed border-border/70 bg-background/35 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground/80">No Studio documents</div>
            <div className="mt-1">Import a PDF to create a linked note.</div>
          </div>
        )}
        {recent.length > 0 && (
          <section className="mb-4">
            <div className="on-section-label mb-1">Recenti</div>
            {recent.map((document) => (
              <StudioDocumentRow
                key={`recent-${document.id}`}
                document={document}
                active={document.id === currentDocumentId}
                onSelect={() => onSelectDocument(document.id)}
                onRename={(title) => onRenameDocument(document.id, title)}
                onDelete={() => onDeleteDocument(document.id)}
                projects={projects}
                onMove={(projectId) => onMoveDocument(document.id, projectId)}
                onDragStart={() => setDraggedDocumentId(document.id)}
                onDragEnd={clearDragState}
              />
            ))}
          </section>
        )}
        {!isLoading && (
          <section data-studio-current-project-id={currentProjectId ?? "root"}>
            <div className="mb-1 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-1">
                {currentProjectId && (
                  <button
                    type="button"
                    aria-label="Back to Projects"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setCurrentProjectId(currentProject?.parent_id ?? null)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="on-section-label truncate">{currentProject?.name ?? "Projects"}</div>
              </div>
              <button
                type="button"
                aria-label={currentImportProjectId ? "New Studio subfolder" : "New Studio project"}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={handleCreateProject}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {projectGroups.length === 0 && (
              <div className="mx-1 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                Create a project to organize PDFs.
              </div>
            )}
            {visibleProjectGroups.map((group) => {
              const depth = studioProjectDepth(group.project, projects);
              const isDropTarget = dropProjectId === group.project.id;
              const canAcceptDraggedProject = draggedProjectId
                ? canMoveProject(draggedProjectId, group.project.id)
                : false;
              const canAcceptDraggedDocument = Boolean(draggedDocumentId);
              const canAcceptDrop = canAcceptDraggedDocument || canAcceptDraggedProject;
              const hasChildProjects = projects.some((project) => project.parent_id === group.project.id);

              return (
                <div
                  key={group.project.id}
                  className={`mb-3 rounded-lg transition-colors ${isDropTarget ? "bg-primary/5 ring-1 ring-primary/35" : ""}`}
                  data-studio-project-id={group.project.id}
                  data-studio-project-parent-id={group.project.parent_id ?? ""}
                  data-studio-project-depth={depth}
                  onDragEnter={(event) => {
                    if (!canAcceptDrop) return;
                    event.preventDefault();
                    setDropProjectId(group.project.id);
                  }}
                  onDragOver={(event) => {
                    if (!canAcceptDrop) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDragLeave={(event) => {
                    const relatedTarget = event.relatedTarget;
                    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                      setDropProjectId(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const projectId = event.dataTransfer.getData("application/x-opennotion-studio-project-id") || draggedProjectId;
                    const documentId = event.dataTransfer.getData("application/x-opennotion-studio-document-id") || draggedDocumentId;
                    clearDragState();
                    if (projectId) {
                      moveDraggedProject(projectId, group.project.id);
                      return;
                    }
                    if (documentId) moveDraggedDocument(documentId, group.project.id);
                  }}
                >
                  <StudioProjectHeader
                    project={group.project}
                    count={group.documents.length}
                    depth={currentProjectId ? Math.max(0, depth - studioProjectDepth(currentProject ?? group.project, projects)) : depth}
                    active={group.project.id === currentProjectId}
                    onOpen={() => setCurrentProjectId(group.project.id)}
                    onCreateChild={() => openChildProjectDialog(group.project.id)}
                    onRename={(name) => onRenameProject(group.project.id, name)}
                    onDelete={() => onDeleteProject(group.project.id)}
                    onProjectDragStart={() => setDraggedProjectId(group.project.id)}
                    onProjectDragEnd={clearDragState}
                  />
                  {group.documents.length === 0 && !hasChildProjects && (
                    <div
                      className="mx-3 mb-2 rounded-md border border-dashed border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground"
                      data-studio-project-empty
                    >
                      Drop PDFs here
                    </div>
                  )}
                  {group.documents.map((document) => (
                    <StudioDocumentRow
                      key={`project-${group.project.id}-${document.id}`}
                      document={document}
                      active={document.id === currentDocumentId}
                      onSelect={() => onSelectDocument(document.id)}
                      onRename={(title) => onRenameDocument(document.id, title)}
                      onDelete={() => onDeleteDocument(document.id)}
                      projects={projects}
                      onMove={(projectId) => onMoveDocument(document.id, projectId)}
                      onDragStart={() => setDraggedDocumentId(document.id)}
                      onDragEnd={clearDragState}
                    />
                  ))}
                </div>
              );
            })}
          </section>
        )}
      </div>
      {projectNameDialog && (
        <StudioProjectNameDialog
          request={projectNameDialog}
          onCancel={() => setProjectNameDialog(null)}
          onSubmit={handleSubmitProjectName}
        />
      )}
    </div>
  );
}
