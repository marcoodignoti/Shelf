import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { Layout } from "./components/Layout";
import { useAppStore } from "./store/useAppStore";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppNotice } from "./components/AppNotice";
import { isNewPageShortcut } from "./lib/shortcuts";
import { HOME_PAGE_ID } from "./lib/navigation";
import { HomeView } from "./components/HomeView";

const Editor = lazy(() => import("./components/PageEditor").then((module) => ({ default: module.Editor })));
const StudioWorkspace = lazy(() => import("./components/StudioWorkspace").then((module) => ({ default: module.StudioWorkspace })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })));
const AiActionModal = lazy(() => import("./components/AiActionModal").then((module) => ({ default: module.AiActionModal })));

function WorkspaceLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading workspace...
    </div>
  );
}

export default function App() {
  const pages = useAppStore((state) => state.pages);
  const currentPageId = useAppStore((state) => state.currentPageId);
  const theme = useAppStore((state) => state.theme);
  const isLoading = useAppStore((state) => state.isLoading);
  const addPage = useAppStore((state) => state.addPage);
  const setCurrentPageId = useAppStore((state) => state.setCurrentPageId);
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const workspaceMode = useAppStore((state) => state.workspaceMode);
  const studioDocuments = useAppStore((state) => state.studioDocuments);
  const currentStudioDocumentId = useAppStore((state) => state.currentStudioDocumentId);
  const updateStudioViewerAction = useAppStore((state) => state.updateStudioViewerAction);
  const createMissingStudioNoteAction = useAppStore((state) => state.createMissingStudioNoteAction);
  const replaceStudioPdfAction = useAppStore((state) => state.replaceStudioPdfAction);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      
      const listener = (e: MediaQueryListEvent) => {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      };
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', listener);
      return () => window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', listener);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (isNewPageShortcut(event)) {
        event.preventDefault();
        void addPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addPage, openCommandPalette]);

  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", preventNativeContextMenu);
    return () => window.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);

  const currentPage = useMemo(
    () => pages.find(p => p.id === currentPageId),
    [currentPageId, pages]
  );
  const currentStudioDocument = useMemo(
    () => studioDocuments.find((document) => document.id === currentStudioDocumentId),
    [currentStudioDocumentId, studioDocuments]
  );
  const currentStudioNote = useMemo(
    () => currentStudioDocument
      ? pages.find((page) => page.id === currentStudioDocument.note_page_id) ?? null
      : null,
    [currentStudioDocument, pages]
  );
  const handleUpdateStudioViewer = useCallback((id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: "pdf-left" | "note-left" }) => {
    void updateStudioViewerAction(id, updates);
  }, [updateStudioViewerAction]);
  const handleCreateMissingStudioNote = useCallback((documentId: string) => {
    void createMissingStudioNoteAction(documentId);
  }, [createMissingStudioNoteAction]);
  const handleReplaceStudioPdf = useCallback((documentId: string) => {
    void replaceStudioPdfAction(documentId);
  }, [replaceStudioPdfAction]);

  return (
    <Layout>
      {isLoading ? (
        <WorkspaceLoadingFallback />
      ) : workspaceMode === 'studio' ? (
        currentStudioDocument ? (
          <ErrorBoundary key={currentStudioDocument.id}>
            <Suspense fallback={<WorkspaceLoadingFallback />}>
              <StudioWorkspace
                document={currentStudioDocument}
                note={currentStudioNote}
                pages={pages}
                onSelectPage={setCurrentPageId}
                onCreateMissingNote={handleCreateMissingStudioNote}
                onReplacePdfFile={handleReplaceStudioPdf}
                onUpdateViewer={handleUpdateStudioViewer}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            Import a PDF from the Studio sidebar to start.
          </div>
        )
      ) : currentPageId === HOME_PAGE_ID ? (
        <HomeView
          pages={pages}
          onSelectPage={setCurrentPageId}
        />
      ) : currentPage ? (
        <ErrorBoundary key={currentPage.id}>
          <Suspense fallback={<WorkspaceLoadingFallback />}>
            <Editor page={currentPage} pages={pages} onSelectPage={setCurrentPageId} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center">
          <div className="max-w-sm">
            <div className="text-lg font-semibold text-foreground">No page selected</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Create a page to start writing in this workspace.
            </div>
            <button
              className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => void addPage()}
            >
              New page
            </button>
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        <CommandPalette />
        <AiActionModal />
      </Suspense>
      <AppNotice />
    </Layout>
  );
}
