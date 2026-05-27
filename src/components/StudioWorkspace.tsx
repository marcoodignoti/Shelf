import { ChevronLeft, ChevronRight, Columns2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Page } from "../lib/db";
import {
  buildStudioPanelGridColumns,
  clampStudioPage,
  clampStudioPanelRatio,
  clampStudioZoom,
  StudioDocument,
  studioPdfSrc,
} from "../lib/studio";
import { Editor } from "./PageEditor";

type StudioWorkspaceProps = {
  document: StudioDocument;
  note: Page | null;
  pages: Page[];
  onSelectPage: (id: string) => void;
  onUpdateViewer: (
    id: string,
    updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: "pdf-left" | "note-left" }
  ) => void;
};

export function StudioWorkspace({
  document,
  note,
  pages,
  onSelectPage,
  onUpdateViewer,
}: StudioWorkspaceProps) {
  const pdfSrc = useMemo(() => studioPdfSrc(document), [document]);
  const currentPage = clampStudioPage(document.viewer_page);
  const currentZoom = clampStudioZoom(document.viewer_zoom);
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  const [pdfPanelRatio, setPdfPanelRatio] = useState(() => getStoredPanelRatio(document.id));
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);
  const nextLayout = document.panel_layout === "pdf-left" ? "note-left" : "pdf-left";
  const panelGridColumns = buildStudioPanelGridColumns(document.panel_layout, pdfPanelRatio);

  useEffect(() => {
    setPageDraft(String(currentPage));
    setPdfLoadFailed(false);
  }, [currentPage, pdfSrc]);

  useEffect(() => {
    setPdfPanelRatio(getStoredPanelRatio(document.id));
  }, [document.id]);

  const updatePage = (page: number) => {
    const viewerPage = clampStudioPage(page);
    setPageDraft(String(viewerPage));
    onUpdateViewer(document.id, { viewer_page: viewerPage });
  };

  const commitPageDraft = () => {
    updatePage(Number(pageDraft));
  };

  const updateZoom = (zoom: number) => {
    onUpdateViewer(document.id, { viewer_zoom: clampStudioZoom(zoom) });
  };

  const handleSplitterPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement;
    if (!container) return;

    event.preventDefault();
    window.document.body.style.cursor = "col-resize";
    window.document.body.style.userSelect = "none";

    const containerRect = container.getBoundingClientRect();
    const updateRatio = (clientX: number) => {
      const pointerRatio = ((clientX - containerRect.left) / containerRect.width) * 100;
      const nextRatio = document.panel_layout === "pdf-left" ? pointerRatio : 100 - pointerRatio;
      const clampedRatio = clampStudioPanelRatio(nextRatio);
      setPdfPanelRatio(clampedRatio);
      storePanelRatio(document.id, clampedRatio);
    };

    updateRatio(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      window.document.body.style.cursor = "";
      window.document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const pdfPanel = (
    <section className="on-studio-panel min-w-0 bg-muted/20">
      {pdfLoadFailed ? (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
          <div>
            <div className="font-medium text-foreground">PDF preview unavailable</div>
            <div className="mt-2 max-w-sm">
              The document was imported, but the built-in preview could not render it.
            </div>
          </div>
        </div>
      ) : (
        <iframe
          key={pdfSrc}
          title={document.title}
          src={pdfSrc}
          className="h-full w-full bg-background"
          onLoad={() => setPdfLoadFailed(false)}
          onError={() => setPdfLoadFailed(true)}
        />
      )}
    </section>
  );
  const notePanel = (
    <section className="on-studio-panel min-w-0 overflow-hidden">
      {note ? (
        <Editor page={note} pages={pages} onSelectPage={onSelectPage} variant="studio" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Linked note missing.</div>
      )}
    </section>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border/70 px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{document.title}</div>
          <div className="truncate text-xs text-muted-foreground">{document.original_filename}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="on-icon-button"
            title="Previous page"
            onClick={() => updatePage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            className="h-8 w-14 rounded-md border border-border bg-background px-2 text-center text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Current PDF page"
            inputMode="numeric"
            value={pageDraft}
            onChange={(event) => setPageDraft(event.target.value)}
            onBlur={commitPageDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPageDraft();
              }
              if (event.key === "Escape") {
                setPageDraft(String(currentPage));
              }
            }}
          />
          <button
            className="on-icon-button"
            title="Next page"
            onClick={() => updatePage(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            className="on-icon-button"
            title="Zoom out"
            onClick={() => updateZoom(currentZoom - 25)}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            className="h-8 min-w-14 rounded-md px-2 text-center text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Reset zoom"
            onClick={() => updateZoom(100)}
          >
            {currentZoom}%
          </button>
          <button
            className="on-icon-button"
            title="Zoom in"
            onClick={() => updateZoom(currentZoom + 25)}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            className="on-icon-button"
            title="Swap panels"
            onClick={() => onUpdateViewer(document.id, { panel_layout: nextLayout })}
          >
            <Columns2 className="h-4 w-4" />
          </button>
          {pdfLoadFailed && (
            <button
              className="on-icon-button"
              title="Retry PDF preview"
              onClick={() => setPdfLoadFailed(false)}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div
        className="on-studio-split min-h-0 flex-1 bg-border/70"
        style={{ gridTemplateColumns: panelGridColumns }}
      >
        {document.panel_layout === "pdf-left" ? (
          <>
            {pdfPanel}
            <StudioSplitter onPointerDown={handleSplitterPointerDown} />
            {notePanel}
          </>
        ) : (
          <>
            {notePanel}
            <StudioSplitter onPointerDown={handleSplitterPointerDown} />
            {pdfPanel}
          </>
        )}
      </div>
    </div>
  );
}

function StudioSplitter({ onPointerDown }: { onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      className="on-studio-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Studio panels"
      onPointerDown={onPointerDown}
    />
  );
}

function panelRatioStorageKey(documentId: string): string {
  return `opennotion-studio-panel-ratio-${documentId}`;
}

function getStoredPanelRatio(documentId: string): number {
  const storedRatio = Number(localStorage.getItem(panelRatioStorageKey(documentId)));
  return clampStudioPanelRatio(Number.isFinite(storedRatio) ? storedRatio : 50);
}

function storePanelRatio(documentId: string, ratio: number): void {
  localStorage.setItem(panelRatioStorageKey(documentId), String(clampStudioPanelRatio(ratio)));
}
