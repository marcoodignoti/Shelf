import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { MoreHorizontal, ExternalLink, FileText, FolderOpen, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StudioDocument } from "../lib/studio";
import { clampContextMenuPosition } from "../lib/contextMenu";
import { recentStudioDocuments, remainingStudioDocuments, studioDocumentMetadata } from "../lib/studioDocuments";

type StudioSidebarProps = {
  documents: StudioDocument[];
  currentDocumentId: string | null;
  isLoading: boolean;
  onImport: () => void;
  onSelectDocument: (id: string) => void;
  onRenameDocument: (id: string, title: string) => void;
  onDeleteDocument: (id: string) => void;
};

const STUDIO_DOCUMENT_MENU_WIDTH = 220;
const STUDIO_DOCUMENT_MENU_HEIGHT = 178;

function StudioDocumentRow({
  document,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  document: StudioDocument;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
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

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuPosition]);

  const openMenu = (clientX: number, clientY: number) => {
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

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={`on-shell-row on-sidebar-page-row group mb-[1px] justify-between py-[3px] text-[13px] ${active ? "on-shell-row-active" : ""}`}
        onClick={onSelect}
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

export function StudioSidebar({
  documents,
  currentDocumentId,
  isLoading,
  onImport,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
}: StudioSidebarProps) {
  const recent = recentStudioDocuments(documents, 4);
  const remaining = remainingStudioDocuments(documents, recent);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2">
        <button type="button" className="on-studio-import-button" onClick={onImport}>
          <Upload className="h-4 w-4" />
          <span>Import PDF</span>
        </button>
      </div>
      <div className="mt-4 flex-1 overflow-y-auto px-2 pb-20">
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
              />
            ))}
          </section>
        )}
        {remaining.length > 0 && (
          <section>
            <div className="on-section-label mb-1">Tutti i documenti</div>
            {remaining.map((document) => (
              <StudioDocumentRow
                key={`all-${document.id}`}
                document={document}
                active={document.id === currentDocumentId}
                onSelect={() => onSelectDocument(document.id)}
                onRename={(title) => onRenameDocument(document.id, title)}
                onDelete={() => onDeleteDocument(document.id)}
              />
            ))}
          </section>
        )}
        {!isLoading && documents.length > 0 && remaining.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Tutti i documenti sono gia in Recenti.
          </div>
        )}
      </div>
    </div>
  );
}
