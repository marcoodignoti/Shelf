import { ArrowLeftRight, ChevronLeft, ChevronRight, Columns2, FileText, PanelLeft, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { TouchEvent, WheelEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Page } from "../lib/db";
import { useAppStore } from "../store/useAppStore";
import {
  buildStudioPanelGridColumns,
  clampStudioPage,
  clampStudioPanelRatio,
  clampStudioZoom,
  StudioDocument,
  studioPanelRatioFromPointer,
  studioPdfSrc,
} from "../lib/studio";
import { Editor } from "./PageEditor";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type StudioViewMode = "split" | "pdf" | "note";

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
  const isSidebarOpen = useAppStore((state) => state.isSidebarOpen);
  const pdfSrc = useMemo(() => studioPdfSrc(document).split("#")[0], [document.stored_file_path]);
  const currentPage = clampStudioPage(document.viewer_page);
  const persistedZoom = clampStudioZoom(document.viewer_zoom);
  const [localZoom, setLocalZoom] = useState(persistedZoom);
  const currentZoom = localZoom;
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  const [pdfPanelRatio, setPdfPanelRatio] = useState(() => getStoredPanelRatio(document.id));
  const [viewMode, setViewMode] = useState<StudioViewMode>(() => getStoredViewMode(document.id));
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const zoomPersistTimeoutRef = useRef<number | null>(null);
  const nextLayout = document.panel_layout === "pdf-left" ? "note-left" : "pdf-left";
  const panelGridColumns = buildStudioPanelGridColumns(document.panel_layout, pdfPanelRatio);
  const effectiveViewMode: StudioViewMode = viewMode === "note" && !note ? "pdf" : viewMode;
  const showPdfPanel = effectiveViewMode === "split" || effectiveViewMode === "pdf";
  const showPdfControls = showPdfPanel;

  useEffect(() => {
    setPageDraft(String(currentPage));
    setPdfLoadFailed(false);
  }, [currentPage, pdfSrc]);

  useEffect(() => {
    setPdfPanelRatio(getStoredPanelRatio(document.id));
    setViewMode(getStoredViewMode(document.id));
  }, [document.id]);

  useEffect(() => {
    setLocalZoom(persistedZoom);
  }, [document.id, persistedZoom]);

  useEffect(() => {
    return () => {
      if (zoomPersistTimeoutRef.current) {
        window.clearTimeout(zoomPersistTimeoutRef.current);
      }
    };
  }, []);

  const updatePage = useCallback((page: number) => {
    const viewerPage = clampStudioPage(page);
    setPageDraft(String(viewerPage));
    onUpdateViewer(document.id, { viewer_page: viewerPage });
  }, [document.id, onUpdateViewer]);

  const handlePdfLoad = useCallback((pageCount: number) => {
    setPdfLoadFailed(false);
    setPdfPageCount(pageCount);
    if (currentPage > pageCount) {
      updatePage(pageCount);
    }
  }, [currentPage, updatePage]);

  const handlePdfError = useCallback(() => {
    setPdfLoadFailed(true);
  }, []);

  const commitPageDraft = () => {
    updatePage(Number(pageDraft));
  };

  const updateZoom = useCallback((zoom: number) => {
    const nextZoom = clampStudioZoom(zoom);
    setLocalZoom(nextZoom);
    if (zoomPersistTimeoutRef.current) {
      window.clearTimeout(zoomPersistTimeoutRef.current);
    }
    zoomPersistTimeoutRef.current = window.setTimeout(() => {
      onUpdateViewer(document.id, { viewer_zoom: nextZoom });
    }, 180);
  }, [document.id, onUpdateViewer]);

  const updateViewMode = (mode: StudioViewMode) => {
    setViewMode(mode);
    storeViewMode(document.id, mode);
  };

  const handleSplitterPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement;
    if (!container) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingPanels(true);
    window.document.body.style.cursor = "col-resize";
    window.document.body.style.userSelect = "none";

    const containerRect = container.getBoundingClientRect();
    const updateRatio = (clientX: number) => {
      const clampedRatio = studioPanelRatioFromPointer(document.panel_layout, clientX, containerRect);
      setPdfPanelRatio(clampedRatio);
      storePanelRatio(document.id, clampedRatio);
    };

    updateRatio(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      setIsResizingPanels(false);
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
    <section className="on-studio-panel min-w-0 bg-muted/20" aria-label="PDF panel">
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
        <StudioPdfCanvas
          src={pdfSrc}
          title={document.title}
          page={currentPage}
          zoom={currentZoom}
          onLoad={handlePdfLoad}
          onError={handlePdfError}
          onZoomChange={updateZoom}
        />
      )}
    </section>
  );
  const notePanel = (
    <section className="on-studio-panel min-w-0 overflow-hidden" aria-label="Notes panel">
      {note ? (
        <Editor page={note} pages={pages} onSelectPage={onSelectPage} variant="studio" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Linked note missing.</div>
      )}
    </section>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className={`on-studio-floating-toolbar pointer-events-none absolute inset-x-0 top-0 z-[80] flex h-14 items-center justify-between px-4 ${isSidebarOpen ? "" : "pl-36"}`}>
        <div className="on-studio-toolbar-title pointer-events-auto min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{document.title}</div>
          <div className="truncate text-xs text-muted-foreground">{document.original_filename}</div>
        </div>
        <div className="on-studio-toolbar-controls pointer-events-auto flex items-center gap-1.5">
          {showPdfControls && (
            <>
              <button
                className="on-icon-button"
                title="Previous page"
                onClick={() => updatePage(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                className="on-studio-page-input"
                aria-label={pdfPageCount ? `Current PDF page of ${pdfPageCount}` : "Current PDF page"}
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
              {pdfPageCount ? (
                <span className="min-w-8 text-center text-xs text-muted-foreground">/ {pdfPageCount}</span>
              ) : null}
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
                className="on-studio-zoom-button"
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
            </>
          )}
          <div className="on-studio-view-switch" role="group" aria-label="Studio view">
            <button
              className={`on-studio-view-switch-button ${effectiveViewMode === "pdf" ? "on-studio-view-switch-button-active" : ""}`}
              title="PDF only"
              onClick={() => updateViewMode("pdf")}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <button
              className={`on-studio-view-switch-button ${effectiveViewMode === "split" ? "on-studio-view-switch-button-active" : ""}`}
              title="Split view"
              onClick={() => updateViewMode("split")}
            >
              <Columns2 className="h-4 w-4" />
            </button>
            <button
              className={`on-studio-view-switch-button ${effectiveViewMode === "note" ? "on-studio-view-switch-button-active" : ""}`}
              title={note ? "Notes only" : "Linked note missing"}
              disabled={!note}
              onClick={() => {
                if (note) updateViewMode("note");
              }}
            >
              <FileText className="h-4 w-4" />
            </button>
          </div>
          {effectiveViewMode === "split" && (
            <button
              className="on-icon-button"
              title="Swap PDF and notes"
              onClick={() => onUpdateViewer(document.id, { panel_layout: nextLayout })}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          )}
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
      <div className="on-studio-split-frame min-h-0 flex-1">
        <div
          ref={splitRef}
          className="on-studio-split h-full min-h-0 bg-border/70"
          style={{ gridTemplateColumns: effectiveViewMode === "split" ? panelGridColumns : "minmax(0, 1fr)" }}
        >
          {effectiveViewMode === "pdf" ? (
            pdfPanel
          ) : effectiveViewMode === "note" ? (
            notePanel
          ) : document.panel_layout === "pdf-left" ? (
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
      {isResizingPanels && effectiveViewMode === "split" && (
        <div
          className="fixed inset-0 z-[220] cursor-col-resize"
          onPointerMove={(event) => {
            const rect = splitRef.current?.getBoundingClientRect();
            if (!rect) return;
            const nextRatio = studioPanelRatioFromPointer(document.panel_layout, event.clientX, rect);
            setPdfPanelRatio(nextRatio);
            storePanelRatio(document.id, nextRatio);
          }}
          onPointerUp={() => setIsResizingPanels(false)}
          onPointerCancel={() => setIsResizingPanels(false)}
        />
      )}
    </div>
  );
}

const StudioPdfCanvas = memo(function StudioPdfCanvas({
  src,
  title,
  page,
  zoom,
  onLoad,
  onError,
  onZoomChange,
}: {
  src: string;
  title: string;
  page: number;
  zoom: number;
  onLoad: (pageCount: number) => void;
  onError: () => void;
  onZoomChange: (zoom: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const loadedPageKeyRef = useRef<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [renderedZoom, setRenderedZoom] = useState(zoom);
  const [isLoading, setIsLoading] = useState(true);
  const liveScale = canvasSize ? clampStudioZoom(zoom) / clampStudioZoom(renderedZoom) : 1;

  const updateZoomFromPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const scrollElement = scrollRef.current;
    const previousZoom = clampStudioZoom(zoom);
    const clampedZoom = clampStudioZoom(nextZoom);
    if (!scrollElement || clampedZoom === previousZoom) return;

    const rect = scrollElement.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    const scale = clampedZoom / previousZoom;
    const nextScrollLeft = (scrollElement.scrollLeft + offsetX) * scale - offsetX;
    const nextScrollTop = (scrollElement.scrollTop + offsetY) * scale - offsetY;

    onZoomChange(clampedZoom);
    requestAnimationFrame(() => {
      scrollElement.scrollLeft = nextScrollLeft;
      scrollElement.scrollTop = nextScrollTop;
    });
  }, [onZoomChange, zoom]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;

    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    updateZoomFromPoint(zoom + direction, event.clientX, event.clientY);
  }, [updateZoomFromPoint, zoom]);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      pinchRef.current = null;
      return;
    }

    const [first, second] = Array.from(event.touches);
    pinchRef.current = {
      distance: touchDistance(first, second),
      zoom,
    };
  }, [zoom]);

  const handleTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchRef.current) return;

    event.preventDefault();
    const [first, second] = Array.from(event.touches);
    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    const distance = touchDistance(first, second);
    const rawScale = distance / pinchRef.current.distance;
    const scale = 1 + (rawScale - 1) * 0.08;
    updateZoomFromPoint(pinchRef.current.zoom * scale, centerX, centerY);
  }, [updateZoomFromPoint]);

  const clearPinch = useCallback(() => {
    pinchRef.current = null;
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
    let activeRenderTask: pdfjsLib.RenderTask | null = null;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      onError();
      return;
    }

    const pageKey = `${src.split("#")[0]}:${page}`;
    if (loadedPageKeyRef.current !== pageKey) {
      setIsLoading(true);
    }

    const renderTask = (async () => {
      loadingTask = pdfjsLib.getDocument(src);
      const pdf = await loadingTask.promise;
      pdfDocument = pdf;
      if (isCancelled) {
        await pdfDocument.destroy();
        pdfDocument = null;
        return;
      }

      const pageNumber = Math.min(clampStudioPage(page), pdf.numPages);
      const pdfPage = await pdf.getPage(pageNumber);
      if (isCancelled) {
        await pdfDocument.destroy();
        pdfDocument = null;
        return;
      }

      const viewport = pdfPage.getViewport({ scale: clampStudioZoom(zoom) / 100 });
      const pixelRatio = window.devicePixelRatio || 1;
      const nextCanvas = document.createElement("canvas");
      const nextContext = nextCanvas.getContext("2d");
      if (!nextContext) {
        throw new Error("PDF canvas context unavailable");
      }
      nextCanvas.width = Math.floor(viewport.width * pixelRatio);
      nextCanvas.height = Math.floor(viewport.height * pixelRatio);

      nextContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      nextContext.clearRect(0, 0, viewport.width, viewport.height);

      activeRenderTask = pdfPage.render({ canvas: nextCanvas, canvasContext: nextContext, viewport });
      await activeRenderTask.promise;
      activeRenderTask = null;
      await pdfDocument.destroy();
      pdfDocument = null;

      if (!isCancelled) {
        canvas.width = nextCanvas.width;
        canvas.height = nextCanvas.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(nextCanvas, 0, 0);
        setCanvasSize({ width: viewport.width, height: viewport.height });
        setRenderedZoom(clampStudioZoom(zoom));
        onLoad(pdf.numPages);
        loadedPageKeyRef.current = pageKey;
        setIsLoading(false);
      }
    })();

    renderTask.catch(() => {
      if (!isCancelled) {
        setIsLoading(false);
        onError();
      }
    });

    return () => {
      isCancelled = true;
      activeRenderTask?.cancel();
      activeRenderTask = null;
      if (pdfDocument) {
        void pdfDocument.destroy();
        pdfDocument = null;
      } else {
        void loadingTask?.destroy();
      }
    };
  }, [onError, onLoad, page, src, zoom]);

  return (
    <div
      ref={scrollRef}
      className="on-scroll-fade on-scroll-fade-pdf relative h-full w-full overflow-auto bg-zinc-100"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={clearPinch}
      onTouchCancel={clearPinch}
    >
      {isLoading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          Loading PDF...
        </div>
      ) : null}
      <div className="flex min-h-full w-max min-w-full justify-center p-6">
        <div
          className="relative flex-shrink-0 bg-white shadow-sm ring-1 ring-black/10"
          style={{
            width: canvasSize ? canvasSize.width * liveScale : undefined,
            height: canvasSize ? canvasSize.height * liveScale : undefined,
          }}
        >
        <canvas
          ref={canvasRef}
          aria-label={title}
          className="absolute left-0 top-0 h-auto max-w-none origin-top-left bg-white"
          style={{
            transform: `scale(${liveScale})`,
          }}
        />
        </div>
      </div>
    </div>
  );
});

function touchDistance(first: Pick<Touch, "clientX" | "clientY">, second: Pick<Touch, "clientX" | "clientY">): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
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

function viewModeStorageKey(documentId: string): string {
  return `opennotion-studio-view-mode-${documentId}`;
}

function getStoredPanelRatio(documentId: string): number {
  const storedRatio = Number(localStorage.getItem(panelRatioStorageKey(documentId)));
  return clampStudioPanelRatio(Number.isFinite(storedRatio) ? storedRatio : 50);
}

function storePanelRatio(documentId: string, ratio: number): void {
  localStorage.setItem(panelRatioStorageKey(documentId), String(clampStudioPanelRatio(ratio)));
}

function getStoredViewMode(documentId: string): StudioViewMode {
  const storedMode = localStorage.getItem(viewModeStorageKey(documentId));
  return storedMode === "pdf" || storedMode === "note" ? storedMode : "split";
}

function storeViewMode(documentId: string, mode: StudioViewMode): void {
  localStorage.setItem(viewModeStorageKey(documentId), mode);
}
