import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { MoreHorizontal, ExternalLink, FileText, Folder, FolderOpen, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StudioDocument, StudioProject } from "../lib/studio";
import { clampContextMenuPosition } from "../lib/contextMenu";
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from "../lib/overlay";
import { DEFAULT_STUDIO_PROJECT_ID, groupStudioDocumentsByProject, recentStudioDocuments, studioDocumentMetadata, studioProjectDepth } from "../lib/studioDocuments";

type StudioSidebarProps = {
  documents: StudioDocument[];
  projects: StudioProject[];
  currentDocumentId: string | null;
  isLoading: boolean;
  onImport: () => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onMoveDocument: (documentId: string, projectId: string | null) => void;
  onSelectDocument: (id: string) => void;
  onRenameDocument: (id: string, title: string) => void;
  onDeleteDocument: (id: string) => void;
};

const STUDIO_DOCUMENT_MENU_WIDTH = 220;
const STUDIO_DOCUMENT_MENU_HEIGHT = 178;
const STUDIO_PROJECT_MENU_WIDTH = 190;
const STUDIO_PROJECT_MENU_HEIGHT = 92;

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
    const nextTitle = window.prompt("Rename Studio document", document.title)?.trim();
    if (nextTitle) onRename(nextTitle);
  };

  const handleDelete = () => {
    setMenuPosition(null);
    if (window.confirm(`Delete "${document.title}" and its linked note? This cannot be undone.`)) {
      onDelete();
    }
  };

  const handleReveal = () => {
    setMenuPosition(null);
    void revealItemInDir(document.stored_file_path);
  };

  const handleOpen = () => {
    setMenuPosition(null);
    void openPath(document.stored_file_path);
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
    </>
  );
}

function StudioProjectHeader({
  project,
  count,
  depth,
  onRename,
  onDelete,
}: {
  project: StudioProject;
  count: number;
  depth: number;
  onRename: (name: string) => void;
  onDelete: () => void;
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
        className="mb-1 flex items-center gap-2 px-3 py-1 text-xs font-medium text-muted-foreground"
        style={{ paddingLeft: 12 + depth * 10 }}
      >
        <Folder className="h-3.5 w-3.5 flex-shrink-0" />
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
          <span
            className="min-w-0 flex-1 truncate text-foreground/80"
            onDoubleClick={() => {
              if (!isInbox) handleRename();
            }}
          >
            {project.name}
          </span>
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
  onDeleteProject,
  onMoveDocument,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
}: StudioSidebarProps) {
  const recent = recentStudioDocuments(documents, 4);
  const projectGroups = groupStudioDocumentsByProject(documents, projects);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  const [dropProjectId, setDropProjectId] = useState<string | null>(null);

  const handleCreateProject = () => {
    const name = window.prompt("New Studio project")?.trim();
    if (name) onCreateProject(name);
  };

  const clearDragState = () => {
    setDraggedDocumentId(null);
    setDropProjectId(null);
  };

  const moveDraggedDocument = (documentId: string, projectId: string) => {
    const targetProjectId = projectId === DEFAULT_STUDIO_PROJECT_ID ? null : projectId;
    const document = documents.find((candidate) => candidate.id === documentId);
    if (!document) return;
    if ((document.project_id ?? null) === targetProjectId) return;
    onMoveDocument(documentId, targetProjectId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2">
        <button type="button" className="on-studio-import-button" onClick={onImport}>
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
          <section>
            <div className="mb-1 flex items-center justify-between">
              <div className="on-section-label">Projects</div>
              <button
                type="button"
                aria-label="New Studio project"
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
            {projectGroups.map((group) => {
              const depth = studioProjectDepth(group.project, projects);
              const isDropTarget = dropProjectId === group.project.id;

              return (
                <div
                  key={group.project.id}
                  className={`mb-3 rounded-lg transition-colors ${isDropTarget ? "bg-primary/5 ring-1 ring-primary/35" : ""}`}
                  data-studio-project-id={group.project.id}
                  data-studio-project-parent-id={group.project.parent_id ?? ""}
                  data-studio-project-depth={depth}
                  onDragEnter={(event) => {
                    if (!draggedDocumentId) return;
                    event.preventDefault();
                    setDropProjectId(group.project.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggedDocumentId) return;
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
                    const documentId = event.dataTransfer.getData("application/x-opennotion-studio-document-id") || draggedDocumentId;
                    clearDragState();
                    if (documentId) moveDraggedDocument(documentId, group.project.id);
                  }}
                >
                  <StudioProjectHeader
                    project={group.project}
                    count={group.documents.length}
                    depth={depth}
                    onRename={(name) => onRenameProject(group.project.id, name)}
                    onDelete={() => onDeleteProject(group.project.id)}
                  />
                  {group.documents.length === 0 && (
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
    </div>
  );
}
