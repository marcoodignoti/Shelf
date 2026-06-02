import { ArrowLeftRight, BookOpen, Check, ChevronLeft, ChevronRight, Columns2, FilePlus, FileText, LayoutList, PanelLeft, RotateCcw, Square, ZoomIn, ZoomOut } from "lucide-react";
import type { TouchEvent, WheelEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { Page } from "../lib/db";
import { useAppStore } from "../store/useAppStore";
import {
  buildStudioPanelGridColumns,
  clampStudioPage,
  clampStudioPanelRatio,
  clampStudioZoom,
  isStudioPdfPageCountAllowed,
  MAX_STUDIO_PDF_PAGES,
  StudioDocument,
  studioPanelRatioFromPointer,
  studioPdfSrc,
} from "../lib/studio";
import { Editor } from "./PageEditor";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type StudioViewMode = "split" | "pdf" | "note";
type StudioPdfDisplayMode = "continuous" | "single" | "two-page";

type StudioWorkspaceProps = {
  document: StudioDocument;
  note: Page | null;
  pages: Page[];
  onSelectPage: (id: string) => void;
  onCreateMissingNote: (documentId: string) => void;
  onReplacePdfFile: (documentId: string) => void;
  onUpdateViewer: (
    id: string,
    updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: "pdf-left" | "note-left" }
  ) => void;
};

const PDF_DISPLAY_MODE_OPTIONS: Array<{
  value: StudioPdfDisplayMode;
  label: string;
  shortcut: string;
  shortcutKey: string;
  icon: typeof LayoutList;
}> = [
  { value: "continuous", label: "Continuous scroll", shortcut: "Cmd 1", shortcutKey: "1", icon: LayoutList },
  { value: "single", label: "Single page", shortcut: "Cmd 2", shortcutKey: "2", icon: Square },
  { value: "two-page", label: "Two pages", shortcut: "Cmd 3", shortcutKey: "3", icon: BookOpen },
];

export function StudioWorkspace({
  document,
  note,
  pages,
  onSelectPage,
  onCreateMissingNote,
  onReplacePdfFile,
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
  const [pdfDisplayMode, setPdfDisplayMode] = useState<StudioPdfDisplayMode>(() => getStoredPdfDisplayMode(document.id));
  const [isPdfViewMenuOpen, setIsPdfViewMenuOpen] = useState(false);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const zoomPersistTimeoutRef = useRef<number | null>(null);
  const attemptedNoteRecoveryRef = useRef<string | null>(null);
  const nextLayout = document.panel_layout === "pdf-left" ? "note-left" : "pdf-left";
  const panelGridColumns = buildStudioPanelGridColumns(document.panel_layout, pdfPanelRatio);
  const effectiveViewMode: StudioViewMode = viewMode === "note" && !note ? "pdf" : viewMode;
  const showPdfPanel = effectiveViewMode === "split" || effectiveViewMode === "pdf";
  const showPdfControls = showPdfPanel;
  const toolbarOverNoteSurface = effectiveViewMode === "note" || (effectiveViewMode === "split" && document.panel_layout === "pdf-left");

  useEffect(() => {
    setPageDraft(String(currentPage));
    setPdfLoadFailed(false);
    setPdfLoadError(null);
  }, [currentPage, pdfSrc, document.updated_at]);

  useEffect(() => {
    setPdfPanelRatio(getStoredPanelRatio(document.id));
    setViewMode(getStoredViewMode(document.id));
    setPdfDisplayMode(getStoredPdfDisplayMode(document.id));
    setIsPdfViewMenuOpen(false);
  }, [document.id]);

  useEffect(() => {
    setLocalZoom(persistedZoom);
  }, [document.id, persistedZoom]);

  useEffect(() => {
    if (note) {
      attemptedNoteRecoveryRef.current = null;
      return;
    }
    if (attemptedNoteRecoveryRef.current === document.id) return;

    attemptedNoteRecoveryRef.current = document.id;
    onCreateMissingNote(document.id);
  }, [document.id, note, onCreateMissingNote]);

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
    setPdfLoadError(null);
    setPdfPageCount(pageCount);
    if (currentPage > pageCount) {
      updatePage(pageCount);
    }
  }, [currentPage, updatePage]);

  const handlePdfError = useCallback((message?: string) => {
    setPdfLoadFailed(true);
    setPdfLoadError(message ?? null);
  }, []);

  const handleReplacePdfFile = useCallback(() => {
    setPdfLoadFailed(false);
    setPdfLoadError(null);
    onReplacePdfFile(document.id);
  }, [document.id, onReplacePdfFile]);

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

  const updatePdfDisplayMode = useCallback((mode: StudioPdfDisplayMode) => {
    setPdfDisplayMode(mode);
    storePdfDisplayMode(document.id, mode);
    setIsPdfViewMenuOpen(false);
  }, [document.id]);

  useEffect(() => {
    const handlePdfDisplayModeShortcut = (event: KeyboardEvent) => {
      if (!showPdfControls || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const option = PDF_DISPLAY_MODE_OPTIONS.find((candidate) => candidate.shortcutKey === event.key);
      if (!option) return;

      event.preventDefault();
      updatePdfDisplayMode(option.value);
    };

    window.addEventListener("keydown", handlePdfDisplayModeShortcut);
    return () => window.removeEventListener("keydown", handlePdfDisplayModeShortcut);
  }, [showPdfControls, updatePdfDisplayMode]);

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
          <div className="max-w-sm">
            <div className="font-medium text-foreground">PDF preview unavailable</div>
            <div className="mt-2">
              {pdfLoadError ?? "The imported PDF file is missing or cannot be rendered."}
            </div>
            <button
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={handleReplacePdfFile}
            >
              <FilePlus className="h-4 w-4" />
              Reimport PDF
            </button>
          </div>
        </div>
      ) : (
        <StudioPdfViewer
          key={`${document.id}-${document.stored_file_path}`}
          src={pdfSrc}
          title={document.title}
          page={currentPage}
          zoom={currentZoom}
          displayMode={pdfDisplayMode}
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
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
          <div className="max-w-sm">
            <div className="font-medium text-foreground">Linked note missing.</div>
            <div className="mt-2">Create a new linked note to keep writing beside this PDF.</div>
            <button
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => onCreateMissingNote(document.id)}
            >
              <FilePlus className="h-4 w-4" />
              Create linked note
            </button>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className={`on-studio-floating-toolbar pointer-events-none absolute inset-x-0 top-0 z-[80] flex h-14 items-center justify-between px-4 ${isSidebarOpen ? "" : "pl-36"}`}>
        <div className="on-studio-toolbar-title pointer-events-auto min-w-0">
          <div className="on-studio-toolbar-title-primary truncate text-sm font-medium text-foreground">{document.title}</div>
          <div className="on-studio-toolbar-title-secondary truncate text-xs">{document.original_filename}</div>
        </div>
        <div className={`on-studio-toolbar-controls pointer-events-auto flex shrink-0 items-center gap-2 ${toolbarOverNoteSurface ? "on-studio-toolbar-controls-note-surface" : ""}`}>
          {showPdfControls && (
            <>
              <div className="on-studio-toolbar-group on-studio-page-controls">
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
                  <span className="on-studio-page-total">/ {pdfPageCount}</span>
                ) : null}
                <button
                  className="on-icon-button"
                  title="Next page"
                  onClick={() => updatePage(currentPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="on-studio-toolbar-group on-studio-zoom-controls">
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
              </div>
              <div className="relative">
                <button
                  className="on-icon-button"
                  title="PDF view options"
                  aria-haspopup="menu"
                  aria-expanded={isPdfViewMenuOpen}
                  onClick={() => setIsPdfViewMenuOpen((isOpen) => !isOpen)}
                >
                  {pdfDisplayMode === "two-page" ? (
                    <BookOpen className="h-4 w-4" />
                  ) : pdfDisplayMode === "single" ? (
                    <Square className="h-4 w-4" />
                  ) : (
                    <LayoutList className="h-4 w-4" />
                  )}
                </button>
                {isPdfViewMenuOpen ? (
                  <div className="on-studio-pdf-view-menu" role="menu" aria-label="PDF view options">
                    {PDF_DISPLAY_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        role="menuitemradio"
                        aria-checked={pdfDisplayMode === option.value}
                        className="on-studio-pdf-view-menu-item"
                        onClick={() => updatePdfDisplayMode(option.value)}
                      >
                        <span className="on-studio-pdf-view-check">
                          {pdfDisplayMode === option.value ? <Check className="h-4 w-4" /> : null}
                        </span>
                        <option.icon className="h-4 w-4" />
                        <span className="flex-1 text-left">{option.label}</span>
                        <span className="on-studio-pdf-view-shortcut">{option.shortcut}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
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

const StudioPdfViewer = memo(function StudioPdfViewer({
  src,
  title,
  page,
  zoom,
  displayMode,
  onLoad,
  onError,
  onZoomChange,
}: {
  src: string;
  title: string;
  page: number;
  zoom: number;
  displayMode: StudioPdfDisplayMode;
  onLoad: (pageCount: number) => void;
  onError: (message?: string) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

    setIsLoading(true);
    setPdfDocument(null);
    setPageCount(null);

    const loadTask = (async () => {
      loadingTask = pdfjsLib.getDocument(src);
      const pdf = await loadingTask.promise;
      pdfDocument = pdf;
      if (!isStudioPdfPageCountAllowed(pdf.numPages)) {
        await pdf.destroy();
        pdfDocument = null;
        throw new Error(`PDF has ${pdf.numPages} pages. OpenNotion supports up to ${MAX_STUDIO_PDF_PAGES} pages.`);
      }
      if (isCancelled) {
        await pdfDocument.destroy();
        pdfDocument = null;
        return;
      }

      if (!isCancelled) {
        setPdfDocument(pdf);
        setPageCount(pdf.numPages);
        onLoad(pdf.numPages);
        setIsLoading(false);
      }
    })();

    loadTask.catch((error: unknown) => {
      if (!isCancelled) {
        setIsLoading(false);
        onError(error instanceof Error ? error.message : undefined);
      }
    });

    return () => {
      isCancelled = true;
      if (pdfDocument) {
        void pdfDocument.destroy();
        pdfDocument = null;
      } else {
        void loadingTask?.destroy();
      }
    };
  }, [onError, onLoad, src]);

  const visiblePages = useMemo(() => {
    if (!pageCount) return [clampStudioPage(page)];

    const currentPage = Math.min(clampStudioPage(page), pageCount);
    if (displayMode === "single") return [currentPage];
    if (displayMode === "two-page") {
      return [currentPage, currentPage + 1].filter((pageNumber) => pageNumber <= pageCount);
    }

    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }, [displayMode, page, pageCount]);

  useEffect(() => {
    if (displayMode !== "continuous") return;
    requestAnimationFrame(() => {
      const pageElement = scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page='${clampStudioPage(page)}']`);
      pageElement?.scrollIntoView({ block: "start" });
    });
  }, [displayMode, page, pageCount]);

  return (
    <div
      ref={scrollRef}
      className="on-scroll-fade on-scroll-fade-pdf relative h-full w-full overflow-auto bg-zinc-100"
      data-pdf-view-mode={displayMode}
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
      <div className={`on-studio-pdf-pages on-studio-pdf-pages-${displayMode}`}>
        {pdfDocument ? visiblePages.map((pageNumber) => (
          <StudioPdfPageCanvas
            key={`${displayMode}-${pageNumber}`}
            pdfDocument={pdfDocument}
            pageNumber={pageNumber}
            zoom={zoom}
            title={pageNumber === clampStudioPage(page) ? title : `${title} page ${pageNumber}`}
            eager={displayMode !== "continuous" || Math.abs(pageNumber - clampStudioPage(page)) <= 1}
            onError={onError}
          />
        )) : null}
      </div>
    </div>
  );
});

const StudioPdfPageCanvas = memo(function StudioPdfPageCanvas({
  pdfDocument,
  pageNumber,
  zoom,
  title,
  eager,
  onError,
}: {
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  title: string;
  eager: boolean;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(eager);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (eager) {
      setShouldRender(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldRender(true);
        observer.disconnect();
      }
    }, { rootMargin: "720px 0px" });

    observer.observe(container);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!shouldRender) return;

    let isCancelled = false;
    let activeRenderTask: pdfjsLib.RenderTask | null = null;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      onError();
      return;
    }

    const render = async () => {
      const pdfPage = await pdfDocument.getPage(pageNumber);
      if (isCancelled) return;

      const viewport = pdfPage.getViewport({ scale: clampStudioZoom(zoom) / 100 });
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      activeRenderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
      await activeRenderTask.promise;
      activeRenderTask = null;

      if (!isCancelled) {
        setPageSize({ width: viewport.width, height: viewport.height });
      }
    };

    render().catch(() => {
      if (!isCancelled) onError();
    });

    return () => {
      isCancelled = true;
      activeRenderTask?.cancel();
      activeRenderTask = null;
    };
  }, [onError, pageNumber, pdfDocument, shouldRender, zoom]);

  const fallbackScale = clampStudioZoom(zoom) / 100;
  const fallbackSize = {
    width: Math.round(612 * fallbackScale),
    height: Math.round(792 * fallbackScale),
  };
  const size = pageSize ?? fallbackSize;

  return (
    <div
      ref={containerRef}
      className="on-studio-pdf-page relative flex-shrink-0 bg-white shadow-sm ring-1 ring-black/10"
      data-pdf-page={pageNumber}
      style={{ width: size.width, height: size.height }}
    >
      <canvas
        ref={canvasRef}
        aria-label={title}
        className="absolute left-0 top-0 h-auto max-w-none bg-white"
      />
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

function pdfDisplayModeStorageKey(documentId: string): string {
  return `opennotion-studio-pdf-display-mode-${documentId}`;
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

function getStoredPdfDisplayMode(documentId: string): StudioPdfDisplayMode {
  const storedMode = localStorage.getItem(pdfDisplayModeStorageKey(documentId));
  return storedMode === "single" || storedMode === "two-page" ? storedMode : "continuous";
}

function storePdfDisplayMode(documentId: string, mode: StudioPdfDisplayMode): void {
  localStorage.setItem(pdfDisplayModeStorageKey(documentId), mode);
}
