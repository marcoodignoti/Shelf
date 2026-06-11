import { AlertTriangle, ArrowLeftRight, Bookmark, BookOpen, Check, ChevronLeft, ChevronRight, Columns2, FilePlus, FileText, LayoutList, Link2, PanelLeft, Plus, RotateCcw, Search, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { TouchEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { createStudioNotePage, Page } from "../lib/db";
import { useT } from "../lib/i18n";
import { arrowKeyPageIntent, isTextEntryElement, pageForNavigationIntent, swipePageIntent, wheelSwipePageIntent } from "../lib/pdfNavigation";
import { useAppStore } from "../store/useAppStore";
import {
  buildStudioPanelGridColumns,
  clampStudioPage,
  clampStudioPanelRatio,
  clampStudioZoom,
  estimatedStudioPdfPageSlotHeight,
  isStudioPdfPageCountAllowed,
  linkStudioDocumentPage,
  listStudioDocumentPageLinks,
  MAX_STUDIO_PDF_PAGES,
  studioPdfCanvasPixelRatio,
  StudioDocument,
  StudioDocumentPageLink,
  studioPanelRatioFromPointer,
  studioPdfSrc,
  studioPdfViewportScale,
} from "../lib/studio";
import { FloatingPopover } from "./FloatingPopover";
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

const PDF_DISPLAY_MODE_SHORTCUT_KEYS = ["1", "2", "3"] as const;
const PDF_DISPLAY_MODE_VALUES: StudioPdfDisplayMode[] = ["continuous", "single", "two-page"];

export function StudioWorkspace({
  document,
  note,
  pages,
  onSelectPage,
  onCreateMissingNote,
  onReplacePdfFile,
  onUpdateViewer,
}: StudioWorkspaceProps) {
  const t = useT();
  const pdfDisplayModeOptions = useMemo(() => [
    { value: "continuous" as StudioPdfDisplayMode, label: t("studio.displayModeContinuous"), shortcut: t("studio.displayModeShortcut1"), shortcutKey: "1", icon: LayoutList },
    { value: "single" as StudioPdfDisplayMode, label: t("studio.displayModeSingle"), shortcut: t("studio.displayModeShortcut2"), shortcutKey: "2", icon: Square },
    { value: "two-page" as StudioPdfDisplayMode, label: t("studio.displayModeTwoPage"), shortcut: t("studio.displayModeShortcut3"), shortcutKey: "3", icon: BookOpen },
  ], [t]);
  const isSidebarOpen = useAppStore((state) => state.isSidebarOpen);
  const fetchPages = useAppStore((state) => state.fetchPages);
  const fetchStudioDocuments = useAppStore((state) => state.fetchStudioDocuments);
  const removePage = useAppStore((state) => state.removePage);
  const showError = useAppStore((state) => state.showError);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const pdfSrc = useMemo(() => studioPdfSrc(document).split("#")[0], [document.id, document.stored_file_path]);
  const currentPage = clampStudioPage(document.viewer_page);
  const persistedZoom = clampStudioZoom(document.viewer_zoom);
  const [localZoom, setLocalZoom] = useState(persistedZoom);
  const currentZoom = localZoom;
  const [targetPdfPage, setTargetPdfPage] = useState(currentPage);
  const [visiblePdfPage, setVisiblePdfPage] = useState(currentPage);
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  const [pdfPanelRatio, setPdfPanelRatio] = useState(() => getStoredPanelRatio(document.id));
  const [viewMode, setViewMode] = useState<StudioViewMode>(() => getStoredViewMode(document.id));
  const [pdfDisplayMode, setPdfDisplayMode] = useState<StudioPdfDisplayMode>(() => getStoredPdfDisplayMode(document.id));
  const [isPdfViewMenuOpen, setIsPdfViewMenuOpen] = useState(false);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [linkedPageLinks, setLinkedPageLinks] = useState<StudioDocumentPageLink[]>([]);
  const [selectedLinkedPageId, setSelectedLinkedPageId] = useState<string | null>(document.note_page_id);
  const [isCreatingLinkedPage, setIsCreatingLinkedPage] = useState(false);
  const [isExistingPagePickerOpen, setIsExistingPagePickerOpen] = useState(false);
  const [existingPageQuery, setExistingPageQuery] = useState("");
  const [pendingDeleteLinkedPage, setPendingDeleteLinkedPage] = useState<StudioDocumentPageLink | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const existingPagePickerButtonRef = useRef<HTMLButtonElement>(null);
  const zoomPersistTimeoutRef = useRef<number | null>(null);
  const nextLayout = document.panel_layout === "pdf-left" ? "note-left" : "pdf-left";
  const panelGridColumns = buildStudioPanelGridColumns(document.panel_layout, pdfPanelRatio);
  const activeLinkedPage = useMemo(() => {
    const selectedId = selectedLinkedPageId ?? document.note_page_id;
    return pages.find((page) => page.id === selectedId)
      ?? linkedPageLinks.find((link) => link.page_id === selectedId)?.page
      ?? note;
  }, [document.note_page_id, linkedPageLinks, note, pages, selectedLinkedPageId]);
  const effectiveViewMode: StudioViewMode = viewMode === "note" && !activeLinkedPage ? "pdf" : viewMode;
  const showPdfPanel = effectiveViewMode === "split" || effectiveViewMode === "pdf";
  const showPdfControls = showPdfPanel;
  const toolbarOverNoteSurface = effectiveViewMode === "note" || (effectiveViewMode === "split" && document.panel_layout === "pdf-left");
  const visibleLinkedPageLinks = useMemo(() => {
    if (linkedPageLinks.length > 0) return linkedPageLinks;
    if (!note) return [];
    return [{
      id: `fallback-${document.id}`,
      document_id: document.id,
      page_id: note.id,
      pdf_page: null,
      label: t("studio.primaryNote"),
      sort_order: 0,
      created_at: note.created_at,
      updated_at: note.updated_at,
      page: note,
    }];
  }, [document.id, linkedPageLinks, note, t]);
  const linkedPageIds = useMemo(
    () => new Set(visibleLinkedPageLinks.map((link) => link.page_id)),
    [visibleLinkedPageLinks]
  );
  const existingPageCandidates = useMemo(() => {
    const query = existingPageQuery.trim().toLowerCase();
    return pages
      .filter((candidate) => candidate.is_deleted === 0 && !linkedPageIds.has(candidate.id))
      .filter((candidate) => {
        if (!query) return true;
        return (candidate.title || t("studio.untitled")).toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [existingPageQuery, linkedPageIds, pages, t]);
  const normalizePdfPage = useCallback((page: number) => {
    const viewerPage = clampStudioPage(page);
    return pdfPageCount ? Math.min(viewerPage, pdfPageCount) : viewerPage;
  }, [pdfPageCount]);
  const activePdfPage = normalizePdfPage(visiblePdfPage);

  useEffect(() => {
    const viewerPage = normalizePdfPage(currentPage);
    setTargetPdfPage(viewerPage);
    setVisiblePdfPage(viewerPage);
    setPageDraft(String(viewerPage));
    setPdfLoadFailed(false);
    setPdfLoadError(null);
  }, [currentPage, normalizePdfPage, pdfSrc]);

  useEffect(() => {
    setPdfPanelRatio(getStoredPanelRatio(document.id));
    setViewMode(getStoredViewMode(document.id));
    setPdfDisplayMode(getStoredPdfDisplayMode(document.id));
    setIsPdfViewMenuOpen(false);
    setIsExistingPagePickerOpen(false);
    setExistingPageQuery("");
    setSelectedLinkedPageId(document.note_page_id);
    setLinkedPageLinks([]);
  }, [document.id]);

  useEffect(() => {
    let cancelled = false;
    listStudioDocumentPageLinks(document.id)
      .then((links) => {
        if (cancelled) return;
        setLinkedPageLinks(links);
        setSelectedLinkedPageId((currentId) =>
          currentId && links.some((link) => link.page_id === currentId)
            ? currentId
            : links[0]?.page_id ?? document.note_page_id
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) showError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [document.id, document.note_page_id, showError]);

  useEffect(() => {
    const livePageIds = new Set(pages.filter((page) => page.is_deleted === 0).map((page) => page.id));
    setLinkedPageLinks((links) => links.filter((link) => livePageIds.has(link.page_id)));
    setSelectedLinkedPageId((currentId) => {
      if (currentId && livePageIds.has(currentId)) return currentId;
      if (note && livePageIds.has(note.id)) return note.id;
      return null;
    });
  }, [note, pages]);

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
    const viewerPage = normalizePdfPage(page);
    setTargetPdfPage(viewerPage);
    setVisiblePdfPage(viewerPage);
    setPageDraft(String(viewerPage));
    onUpdateViewer(document.id, { viewer_page: viewerPage });
  }, [document.id, normalizePdfPage, onUpdateViewer]);

  const updateVisiblePdfPage = useCallback((page: number) => {
    const viewerPage = normalizePdfPage(page);
    setVisiblePdfPage((currentPage) => currentPage === viewerPage ? currentPage : viewerPage);
    setPageDraft((currentDraft) => currentDraft === String(viewerPage) ? currentDraft : String(viewerPage));
  }, [normalizePdfPage]);

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

  const handleSelectLinkedPage = (link: StudioDocumentPageLink) => {
    setSelectedLinkedPageId(link.page_id);
    if (link.pdf_page) {
      updatePage(link.pdf_page);
    }
  };

  const handleCreateLinkedNote = async (pdfPage: number | null) => {
    if (isCreatingLinkedPage) return;
    setIsCreatingLinkedPage(true);
    try {
      const title = pdfPage ? `${document.title} p. ${pdfPage}` : `${document.title} Note`;
      const page = await createStudioNotePage(crypto.randomUUID(), title);
      const link = await linkStudioDocumentPage(document.id, page.id, {
        pdfPage,
        label: pdfPage ? `p. ${pdfPage}` : t("studio.linkedNote"),
      });
      setLinkedPageLinks((links) => [...links.filter((candidate) => candidate.id !== link.id), link]);
      setSelectedLinkedPageId(page.id);
      await fetchPages();
      await fetchStudioDocuments();
      showSuccess(pdfPage ? t("studio.pdfBookmarkNoteCreated") : t("studio.linkedNoteCreated"));
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsCreatingLinkedPage(false);
    }
  };

  const handleLinkExistingPage = async (page: Page, pdfPage: number | null) => {
    try {
      const link = await linkStudioDocumentPage(document.id, page.id, {
        pdfPage,
        label: pdfPage ? `p. ${pdfPage}` : null,
      });
      setLinkedPageLinks((links) => [...links.filter((candidate) => candidate.page_id !== link.page_id), link]);
      setSelectedLinkedPageId(page.id);
      setIsExistingPagePickerOpen(false);
      setExistingPageQuery("");
      await fetchStudioDocuments();
      showSuccess(pdfPage ? t("studio.pdfBookmarkLinked") : t("studio.pageLinked"));
    } catch (error: unknown) {
      showError(error);
    }
  };

  const handleConfirmDeleteLinkedPage = async () => {
    const link = pendingDeleteLinkedPage;
    if (!link) return;

    setPendingDeleteLinkedPage(null);
    setLinkedPageLinks((links) => links.filter((candidate) => candidate.page_id !== link.page_id));
    setSelectedLinkedPageId((currentId) => currentId === link.page_id ? null : currentId);
    await removePage(link.page_id);
    showSuccess(t("studio.linkedNoteDeleted"));
  };

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
    if (mode !== "continuous") {
      updatePage(activePdfPage);
    }
  }, [activePdfPage, document.id, updatePage]);

  useEffect(() => {
    const handlePdfDisplayModeShortcut = (event: KeyboardEvent) => {
      if (!showPdfControls || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const keyIndex = PDF_DISPLAY_MODE_SHORTCUT_KEYS.indexOf(event.key as typeof PDF_DISPLAY_MODE_SHORTCUT_KEYS[number]);
      if (keyIndex === -1) return;

      event.preventDefault();
      updatePdfDisplayMode(PDF_DISPLAY_MODE_VALUES[keyIndex]);
    };

    window.addEventListener("keydown", handlePdfDisplayModeShortcut);
    return () => window.removeEventListener("keydown", handlePdfDisplayModeShortcut);
  }, [showPdfControls, updatePdfDisplayMode]);

  useEffect(() => {
    const handleArrowPageNavigation = (event: KeyboardEvent) => {
      if (!showPdfControls) return;
      // `document` here is the StudioDocument prop; the DOM document is on window.
      if (isTextEntryElement(window.document.activeElement)) return;

      const nextPage = pageForNavigationIntent(arrowKeyPageIntent(event), activePdfPage);
      if (nextPage === null) return;

      event.preventDefault();
      updatePage(nextPage);
    };

    window.addEventListener("keydown", handleArrowPageNavigation);
    return () => window.removeEventListener("keydown", handleArrowPageNavigation);
  }, [activePdfPage, showPdfControls, updatePage]);

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
    <section className="on-studio-panel min-w-0 bg-muted/20" aria-label={t("studio.pdfPanelAriaLabel")}>
      {pdfLoadFailed ? (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
          <div className="max-w-sm">
            <div className="font-medium text-foreground">{t("studio.pdfPreviewUnavailable")}</div>
            <div className="mt-2">
              {pdfLoadError ?? t("studio.pdfMissingError")}
            </div>
            <button
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={handleReplacePdfFile}
            >
              <FilePlus className="h-4 w-4" />
              {t("studio.reimportPdf")}
            </button>
          </div>
        </div>
      ) : (
        <StudioPdfViewer
          key={`${document.id}-${document.stored_file_path}`}
          src={pdfSrc}
          title={document.title}
          page={targetPdfPage}
          zoom={currentZoom}
          displayMode={pdfDisplayMode}
          onLoad={handlePdfLoad}
          onError={handlePdfError}
          onZoomChange={updateZoom}
          onVisiblePageChange={updateVisiblePdfPage}
          onRequestPageChange={updatePage}
        />
      )}
    </section>
  );
  const notePanel = (
    <section className="on-studio-panel min-w-0 overflow-hidden" aria-label={t("studio.notesPanelAriaLabel")}>
      {activeLinkedPage ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="on-studio-linked-pages-bar">
            <div className="on-studio-linked-pages-list" aria-label={t("studio.linkedPdfNotesAriaLabel")}>
              {visibleLinkedPageLinks.map((link) => {
                const isActive = link.page_id === activeLinkedPage.id;
                return (
                  <div
                    key={link.id}
                    className={`on-studio-linked-page-pill ${isActive ? "on-studio-linked-page-pill-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="on-studio-linked-page-chip"
                      onClick={() => handleSelectLinkedPage(link)}
                      title={link.page.title || t("studio.untitled")}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span className="truncate">{link.page.title || t("studio.untitled")}</span>
                      {link.pdf_page ? <span className="on-studio-linked-page-badge">p. {link.pdf_page}</span> : null}
                    </button>
                    <button
                      type="button"
                      className="on-studio-linked-page-delete"
                      title={t("studio.deleteLinkedNote", { title: link.page.title || t("studio.untitled") })}
                      aria-label={t("studio.deleteLinkedNote", { title: link.page.title || t("studio.untitled") })}
                      onClick={() => setPendingDeleteLinkedPage(link)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="on-studio-linked-pages-actions">
              <button
                type="button"
                className="on-studio-linked-page-action"
                disabled={isCreatingLinkedPage}
                onClick={() => void handleCreateLinkedNote(null)}
                title={t("studio.newLinkedNote")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="on-studio-linked-page-action"
                disabled={isCreatingLinkedPage}
                onClick={() => void handleCreateLinkedNote(activePdfPage)}
                title={t("studio.bookmarkCurrentPage")}
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
              <button
                ref={existingPagePickerButtonRef}
                type="button"
                className="on-studio-linked-page-action"
                onClick={() => setIsExistingPagePickerOpen((open) => !open)}
                title={t("studio.linkExistingPage")}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
              <FloatingPopover
                anchorElement={existingPagePickerButtonRef.current}
                open={isExistingPagePickerOpen}
                width={300}
                zIndex={210}
                onOpenChange={setIsExistingPagePickerOpen}
                className="on-studio-link-picker-popover"
              >
                <div className="on-studio-link-picker-panel" onMouseDown={(event) => event.stopPropagation()}>
                  <label className="on-studio-link-picker-search">
                    <Search className="h-3.5 w-3.5" />
                    <input
                      value={existingPageQuery}
                      placeholder={t("studio.searchPages")}
                      spellCheck={false}
                      onChange={(event) => setExistingPageQuery(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setIsExistingPagePickerOpen(false);
                      }}
                    />
                  </label>
                  <div className="on-studio-link-picker-list">
                    {existingPageCandidates.map((candidate) => (
                      <div key={candidate.id} className="on-studio-link-picker-row">
                        <button
                          type="button"
                          className="on-studio-link-picker-main"
                          onClick={() => void handleLinkExistingPage(candidate, null)}
                        >
                          {candidate.icon ? (
                            <span className="on-studio-link-picker-icon-text">{candidate.icon}</span>
                          ) : (
                            <FileText className="h-3.5 w-3.5" />
                          )}
                          <span className="truncate">{candidate.title || t("studio.untitled")}</span>
                        </button>
                        <button
                          type="button"
                          className="on-studio-link-picker-bookmark"
                          title={t("studio.bookmarkPage", { page: String(activePdfPage) })}
                          onClick={() => void handleLinkExistingPage(candidate, activePdfPage)}
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {existingPageCandidates.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground">{t("studio.noPagesFound")}</div>
                    ) : null}
                  </div>
                </div>
              </FloatingPopover>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <Editor key={activeLinkedPage.id} page={activeLinkedPage} pages={pages} onSelectPage={onSelectPage} variant="studio" />
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
          <div className="max-w-sm">
            <div className="font-medium text-foreground">{t("studio.linkedNoteMissing")}</div>
            <div className="mt-2">{t("studio.createLinkedNotePrompt")}</div>
            <button
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => onCreateMissingNote(document.id)}
            >
              <FilePlus className="h-4 w-4" />
              {t("studio.createLinkedNote")}
            </button>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className={`on-studio-floating-toolbar pointer-events-none z-[80] flex items-center gap-3 px-4 py-2 ${isSidebarOpen ? "" : "pl-36"}`}>
        <div className="on-studio-toolbar-title pointer-events-auto min-w-0">
          <div className="on-studio-toolbar-title-primary truncate text-sm font-medium text-foreground">{document.title}</div>
          <div className="on-studio-toolbar-title-secondary truncate text-xs">{document.original_filename}</div>
        </div>
        <div className={`on-studio-toolbar-controls pointer-events-auto ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 ${toolbarOverNoteSurface ? "on-studio-toolbar-controls-note-surface" : ""}`}>
          {showPdfControls && (
            <>
              <div className="on-studio-toolbar-group on-studio-page-controls">
                <button
                  className="on-icon-button"
                  title={t("studio.previousPage")}
                  onClick={() => updatePage(activePdfPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="on-studio-page-indicator">
                  <input
                    className="on-studio-page-input"
                    aria-label={pdfPageCount ? t("studio.currentPdfPageOf", { count: String(pdfPageCount) }) : t("studio.currentPdfPage")}
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
                        setPageDraft(String(activePdfPage));
                      }
                    }}
                  />
                  {pdfPageCount ? (
                    <>
                      <span className="on-studio-page-slash">/</span>
                      <span className="on-studio-page-total">{pdfPageCount}</span>
                    </>
                  ) : null}
                </div>
                <button
                  className="on-icon-button"
                  title={t("studio.nextPage")}
                  onClick={() => updatePage(activePdfPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="on-studio-toolbar-group on-studio-zoom-controls">
                <button
                  className="on-icon-button"
                  title={t("studio.zoomOut")}
                  onClick={() => updateZoom(currentZoom - 25)}
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  className="on-studio-zoom-button"
                  title={t("studio.resetZoom")}
                  onClick={() => updateZoom(100)}
                >
                  {currentZoom}%
                </button>
                <button
                  className="on-icon-button"
                  title={t("studio.zoomIn")}
                  onClick={() => updateZoom(currentZoom + 25)}
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
              <div className="relative">
                <button
                  className="on-icon-button"
                  title={t("studio.pdfViewOptions")}
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
                  <div className="on-studio-pdf-view-menu" role="menu" aria-label={t("studio.pdfViewMenuAriaLabel")}>
                    {pdfDisplayModeOptions.map((option) => (
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
          <div className="on-studio-view-switch" role="group" aria-label={t("studio.studioViewAriaLabel")}>
            <button
              className={`on-studio-view-switch-button ${effectiveViewMode === "pdf" ? "on-studio-view-switch-button-active" : ""}`}
              title={t("studio.pdfOnly")}
              onClick={() => updateViewMode("pdf")}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <button
              className={`on-studio-view-switch-button ${effectiveViewMode === "split" ? "on-studio-view-switch-button-active" : ""}`}
              title={t("studio.splitView")}
              onClick={() => updateViewMode("split")}
            >
              <Columns2 className="h-4 w-4" />
            </button>
            <button
              className={`on-studio-view-switch-button ${effectiveViewMode === "note" ? "on-studio-view-switch-button-active" : ""}`}
              title={activeLinkedPage ? t("studio.notesOnly") : t("studio.linkedNoteMissing")}
              disabled={!activeLinkedPage}
              onClick={() => {
                if (activeLinkedPage) updateViewMode("note");
              }}
            >
              <FileText className="h-4 w-4" />
            </button>
          </div>
          {effectiveViewMode === "split" && (
            <button
              className="on-icon-button"
              title={t("studio.swapPdfAndNotes")}
              onClick={() => onUpdateViewer(document.id, { panel_layout: nextLayout })}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          )}
          {pdfLoadFailed && (
            <button
              className="on-icon-button"
              title={t("studio.retryPdfPreview")}
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
      {pendingDeleteLinkedPage ? (
        <div className="on-modal-overlay z-[240] items-center justify-center p-4" onMouseDown={() => setPendingDeleteLinkedPage(null)}>
          <div className="on-modal-panel on-delete-dialog w-[420px] max-w-[calc(100vw-2rem)]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="on-delete-dialog-content">
              <div className="on-delete-dialog-icon">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{t("studio.deleteLinkedNoteTitle")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("studio.deleteLinkedNoteBody", { title: pendingDeleteLinkedPage.page.title || t("studio.untitled") })}
                </div>
              </div>
            </div>
            <div className="on-delete-dialog-actions">
              <button
                type="button"
                className="on-button-secondary"
                onClick={() => setPendingDeleteLinkedPage(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="on-button-danger"
                onClick={() => void handleConfirmDeleteLinkedPage()}
              >
                {t("sidebar.contextDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  onVisiblePageChange,
  onRequestPageChange,
}: {
  src: string;
  title: string;
  page: number;
  zoom: number;
  displayMode: StudioPdfDisplayMode;
  onLoad: (pageCount: number) => void;
  onError: (message?: string) => void;
  onZoomChange: (zoom: number) => void;
  onVisiblePageChange: (page: number) => void;
  onRequestPageChange: (page: number) => void;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const wheelSwipeRef = useRef({ accumulatedDeltaX: 0, lastEventAt: 0, lockedUntil: 0 });
  const reportedVisiblePageRef = useRef(page);
  const pendingScrollTargetPageRef = useRef<number | null>(null);
  const suppressVisiblePageUpdatesUntilRef = useRef(0);
  const visiblePageRefreshTimerRef = useRef<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const updateScrollWindow = useCallback(() => {
    // Keeps call sites explicit while continuous mode reads DOM directly.
  }, []);

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

  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      updateZoomFromPoint(zoom + direction, event.clientX, event.clientY);
      return;
    }

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    // Trackpad horizontal swipe pages through the paged modes, like Preview.
    // Only when the gesture is clearly horizontal and the viewer has no real
    // horizontal overflow to scroll.
    if (displayMode !== "continuous" && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const state = wheelSwipeRef.current;
      const now = performance.now();
      if (now < state.lockedUntil) {
        event.preventDefault();
        return;
      }
      if (now - state.lastEventAt > 300) {
        state.accumulatedDeltaX = 0;
      }
      state.lastEventAt = now;

      // With classic (non-overlay) scrollbars, scrollbar-gutter: stable makes
      // scrollWidth overstate the reachable scroll range by the gutter width,
      // so a plain scrollLeft + clientWidth < scrollWidth - 1 check never
      // reports the right edge and wheel paging would be unreachable.
      const scrollbarInset = scrollElement.offsetWidth - scrollElement.clientWidth;
      const canScrollLeft = scrollElement.scrollLeft > 0;
      const canScrollRight =
        scrollElement.scrollLeft + scrollElement.clientWidth < scrollElement.scrollWidth - 1 - scrollbarInset;
      // While the viewer can still scroll in the gesture's direction, the
      // gesture is a plain horizontal scroll — keep it native.
      if ((event.deltaX > 0 && canScrollRight) || (event.deltaX < 0 && canScrollLeft)) {
        state.accumulatedDeltaX = 0;
        return;
      }
      state.accumulatedDeltaX += event.deltaX;

      const intent = wheelSwipePageIntent(state.accumulatedDeltaX, { canScrollLeft, canScrollRight });
      const nextPage = pageForNavigationIntent(intent, page);
      if (nextPage !== null) {
        state.accumulatedDeltaX = 0;
        state.lockedUntil = now + 350;
        event.preventDefault();
        onRequestPageChange(nextPage);
      }
      return;
    }

    if (scrollElement.scrollTop <= 0 && event.deltaY < 0) {
      event.preventDefault();
      scrollElement.scrollTop = 0;
      updateScrollWindow();
    }
  }, [displayMode, onRequestPageChange, page, updateScrollWindow, updateZoomFromPoint, zoom]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    scrollElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollElement.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const commitVisiblePageFromScroll = useCallback(() => {
    if (displayMode !== "continuous") return;
    if (pendingScrollTargetPageRef.current !== null) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    if (scrollElement.scrollTop < 0) {
      scrollElement.scrollTop = 0;
      return;
    }
    const nextPage = visiblePdfPageFromScroll(scrollElement, pageCount, zoom);
    if (!nextPage || nextPage === reportedVisiblePageRef.current) return;

    reportedVisiblePageRef.current = nextPage;
    onVisiblePageChange(nextPage);
  }, [displayMode, onVisiblePageChange, pageCount, zoom]);

  const handleScroll = useCallback(() => {
    updateScrollWindow();
    if (displayMode !== "continuous") return;
    if (pendingScrollTargetPageRef.current !== null) return;

    const now = performance.now();
    const suppressUntil = suppressVisiblePageUpdatesUntilRef.current;
    if (now < suppressUntil) {
      if (visiblePageRefreshTimerRef.current === null) {
        visiblePageRefreshTimerRef.current = window.setTimeout(() => {
          visiblePageRefreshTimerRef.current = null;
          commitVisiblePageFromScroll();
        }, Math.max(16, suppressUntil - now + 16));
      }
      return;
    }

    if (visiblePageRefreshTimerRef.current !== null) {
      window.clearTimeout(visiblePageRefreshTimerRef.current);
      visiblePageRefreshTimerRef.current = null;
    }
    commitVisiblePageFromScroll();
  }, [commitVisiblePageFromScroll, displayMode, updateScrollWindow]);

  useEffect(() => () => {
    if (visiblePageRefreshTimerRef.current !== null) {
      window.clearTimeout(visiblePageRefreshTimerRef.current);
      visiblePageRefreshTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      pinchRef.current = null;
      // Single-finger horizontal swipes turn pages in the paged modes;
      // continuous mode keeps native scrolling untouched.
      swipeStartRef.current = event.touches.length === 1 && displayMode !== "continuous"
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : null;
      return;
    }

    swipeStartRef.current = null;
    const [first, second] = Array.from(event.touches);
    pinchRef.current = {
      distance: touchDistance(first, second),
      zoom,
    };
  }, [displayMode, zoom]);

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
    swipeStartRef.current = null;
  }, []);

  const handleTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const swipeStart = swipeStartRef.current;
    pinchRef.current = null;
    swipeStartRef.current = null;
    if (!swipeStart || event.touches.length > 0) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const intent = swipePageIntent(touch.clientX - swipeStart.x, touch.clientY - swipeStart.y);
    const nextPage = pageForNavigationIntent(intent, page);
    if (nextPage !== null) onRequestPageChange(nextPage);
  }, [onRequestPageChange, page]);

  useEffect(() => {
    reportedVisiblePageRef.current = page;
  }, [page]);

  // The document must reload only when the file itself changes. The parent
  // recreates onLoad/onError on unrelated re-renders (page changes, viewer
  // state persistence), and depending on them here would destroy and re-parse
  // the whole PDF on every page turn — so the latest callbacks live in refs.
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const tRef = useRef(t);
  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
    tRef.current = t;
  });

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
        throw new Error(tRef.current("studio.pdfTooManyPages", { numPages: String(pdf.numPages), maxPages: String(MAX_STUDIO_PDF_PAGES) }));
      }
      if (isCancelled) {
        await pdfDocument.destroy();
        pdfDocument = null;
        return;
      }

      if (!isCancelled) {
        setPdfDocument(pdf);
        setPageCount(pdf.numPages);
        onLoadRef.current(pdf.numPages);
        setIsLoading(false);
        requestAnimationFrame(updateScrollWindow);
      }
    })();

    loadTask.catch((error: unknown) => {
      if (!isCancelled) {
        setIsLoading(false);
        onErrorRef.current(error instanceof Error ? error.message : undefined);
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
  }, [src]);

  const visiblePages = useMemo(() => {
    if (!pageCount) return [clampStudioPage(page)];

    const currentPage = Math.min(clampStudioPage(page), pageCount);
    if (displayMode === "continuous") {
      return Array.from({ length: pageCount }, (_value, index) => index + 1);
    }
    if (displayMode === "single") return [currentPage];
    if (displayMode === "two-page") {
      return [currentPage, currentPage + 1].filter((pageNumber) => pageNumber <= pageCount);
    }

    return [currentPage];
  }, [displayMode, page, pageCount]);

  useEffect(() => {
    if (displayMode !== "continuous" || !pageCount) return;
    const currentPage = Math.min(clampStudioPage(page), pageCount);
    pendingScrollTargetPageRef.current = currentPage;
    reportedVisiblePageRef.current = currentPage;
    suppressVisiblePageUpdatesUntilRef.current = performance.now() + 1_800;

    let attempts = 0;
    const scrollToPendingPage = () => {
      attempts += 1;
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      const finishTargetScroll = () => {
        pendingScrollTargetPageRef.current = null;
        reportedVisiblePageRef.current = currentPage;
        suppressVisiblePageUpdatesUntilRef.current = performance.now() + 220;
        onVisiblePageChange(currentPage);
        updateScrollWindow();
      };
      const pageElement = scrollElement.querySelector<HTMLElement>(`[data-pdf-page='${currentPage}']`);
      if (!pageElement && attempts < 90) {
        requestAnimationFrame(scrollToPendingPage);
        return;
      }
      if (!pageElement) {
        finishTargetScroll();
        return;
      }
      const isTargetReady = pageElement.dataset.pdfRendered === "true";
      if (!isTargetReady && attempts < 90) {
        requestAnimationFrame(scrollToPendingPage);
        return;
      }
      const scrollRect = scrollElement.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      const pageTop = pageRect.top - scrollRect.top + scrollElement.scrollTop;
      scrollElement.scrollTop = currentPage <= 1 ? 0 : Math.max(0, pageTop);
      finishTargetScroll();
    };

    requestAnimationFrame(scrollToPendingPage);
  }, [displayMode, onVisiblePageChange, page, pageCount, updateScrollWindow]);

  return (
    <div
      ref={scrollRef}
      className="on-scroll-fade on-scroll-fade-pdf relative h-full w-full overflow-auto bg-zinc-100"
      data-pdf-view-mode={displayMode}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={clearPinch}
    >
      {isLoading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          {t("studio.loadingPdf")}
        </div>
      ) : null}
      <div className={`on-studio-pdf-pages on-studio-pdf-pages-${displayMode}`}>
        {pdfDocument ? visiblePages.map((pageNumber, slotIndex) => (
          <StudioPdfPageCanvas
            // In the paged modes the canvas is keyed by slot, not by page
            // number, so page changes update the existing canvas in place
            // (no remount → no blank flash while the new page renders).
            key={displayMode === "continuous" ? `${displayMode}-${pageNumber}` : `${displayMode}-slot-${slotIndex}`}
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
  const [renderedKey, setRenderedKey] = useState<string | null>(null);

  useEffect(() => {
    if (eager) {
      setShouldRender(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Stay subscribed after the first render: pages that scroll far away
    // flip shouldRender back to false so their canvas bitmap is released,
    // keeping memory bounded on long PDFs instead of accumulating every
    // page ever scrolled past.
    const observer = new IntersectionObserver((entries) => {
      const isNear = entries.some((entry) => entry.isIntersecting);
      setShouldRender((previous) => (previous === isNear ? previous : isNear));
    }, { rootMargin: "720px 0px" });

    observer.observe(container);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!shouldRender) {
      // Release the off-screen bitmap; pageSize is kept so the placeholder
      // preserves layout and scroll height. The page re-renders when it
      // approaches the viewport again.
      const canvas = canvasRef.current;
      if (canvas && (canvas.width > 0 || canvas.height > 0)) {
        canvas.width = 0;
        canvas.height = 0;
      }
      setRenderedKey(null);
      return;
    }

    let isCancelled = false;
    let activeRenderTask: pdfjsLib.RenderTask | null = null;
    const nextRenderedKey = `${pageNumber}:${clampStudioZoom(zoom)}`;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      onError();
      return;
    }
    setRenderedKey(null);

    const render = async () => {
      const pdfPage = await pdfDocument.getPage(pageNumber);
      if (isCancelled) return;

      const rawViewport = pdfPage.getViewport({ scale: clampStudioZoom(zoom) / 100 });
      const viewportScale = studioPdfViewportScale({
        width: rawViewport.width,
        height: rawViewport.height,
      });
      const viewport = viewportScale < 1
        ? pdfPage.getViewport({ scale: (clampStudioZoom(zoom) / 100) * viewportScale })
        : rawViewport;
      const pixelRatio = studioPdfCanvasPixelRatio({
        width: viewport.width,
        height: viewport.height,
        devicePixelRatio: window.devicePixelRatio || 1,
      });

      // Render to an offscreen canvas and blit only when finished, so the
      // previous page stays visible during page/zoom changes instead of
      // flashing a blank canvas while pdf.js renders.
      const offscreen = window.document.createElement("canvas");
      offscreen.width = Math.floor(viewport.width * pixelRatio);
      offscreen.height = Math.floor(viewport.height * pixelRatio);
      const offscreenContext = offscreen.getContext("2d");
      if (!offscreenContext) {
        if (!isCancelled) onError();
        return;
      }
      offscreenContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      activeRenderTask = pdfPage.render({ canvas: offscreen, canvasContext: offscreenContext, viewport });
      await activeRenderTask.promise;
      activeRenderTask = null;

      if (!isCancelled) {
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(offscreen, 0, 0);
        setPageSize({ width: viewport.width, height: viewport.height });
        setRenderedKey(nextRenderedKey);
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
      data-pdf-rendered={renderedKey === `${pageNumber}:${clampStudioZoom(zoom)}` ? "true" : "false"}
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

function visiblePdfPageFromScroll(scrollElement: HTMLElement, pageCount: number | null, zoom: number): number | null {
  const scrollRect = scrollElement.getBoundingClientRect();
  const anchorY = scrollRect.top + scrollRect.height * 0.35;
  const pageElements = Array.from(scrollElement.querySelectorAll<HTMLElement>("[data-pdf-page]"));
  let nearestPage: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const pageElement of pageElements) {
    const pageNumber = Number(pageElement.dataset.pdfPage);
    if (!Number.isInteger(pageNumber)) continue;

    const pageRect = pageElement.getBoundingClientRect();
    const distance = anchorY >= pageRect.top && anchorY <= pageRect.bottom
      ? 0
      : Math.min(Math.abs(anchorY - pageRect.top), Math.abs(anchorY - pageRect.bottom));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPage = pageNumber;
    }
  }

  if (nearestPage) return pageCount ? Math.min(nearestPage, pageCount) : nearestPage;
  if (!pageCount) return null;

  const estimatedPage = Math.floor(scrollElement.scrollTop / estimatedStudioPdfPageSlotHeight(zoom)) + 1;
  return Math.min(Math.max(1, estimatedPage), pageCount);
}

function StudioSplitter({ onPointerDown }: { onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void }) {
  const t = useT();
  return (
    <div
      className="on-studio-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("studio.resizePanels")}
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
