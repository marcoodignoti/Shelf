import { useCallback, useEffect } from "react";
import { Layout } from "./components/Layout";
import { useAppStore } from "./store/useAppStore";
import { Editor } from "./components/PageEditor";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CommandPalette } from "./components/CommandPalette";
import { AppNotice } from "./components/AppNotice";
import { isNewPageShortcut } from "./lib/shortcuts";
import { HOME_PAGE_ID } from "./lib/navigation";
import { HomeView } from "./components/HomeView";
import { StudioWorkspace } from "./components/StudioWorkspace";

export default function App() {
  const {
    pages,
    currentPageId,
    theme,
    isLoading,
    addPage,
    setCurrentPageId,
    workspaceMode,
    studioDocuments,
    currentStudioDocumentId,
    updateStudioViewerAction,
    createMissingStudioNoteAction,
  } = useAppStore();

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
      if (isNewPageShortcut(event)) {
        event.preventDefault();
        void addPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addPage]);

  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", preventNativeContextMenu);
    return () => window.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);

  const currentPage = pages.find(p => p.id === currentPageId);
  const currentStudioDocument = studioDocuments.find((document) => document.id === currentStudioDocumentId);
  const currentStudioNote = currentStudioDocument
    ? pages.find((page) => page.id === currentStudioDocument.note_page_id) ?? null
    : null;
  const handleUpdateStudioViewer = useCallback((id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: "pdf-left" | "note-left" }) => {
    void updateStudioViewerAction(id, updates);
  }, [updateStudioViewerAction]);

  return (
    <Layout>
      {isLoading ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading workspace...
        </div>
      ) : workspaceMode === 'studio' ? (
        currentStudioDocument ? (
          <ErrorBoundary key={currentStudioDocument.id}>
            <StudioWorkspace
              document={currentStudioDocument}
              note={currentStudioNote}
              pages={pages}
              onSelectPage={setCurrentPageId}
              onCreateMissingNote={(documentId) => void createMissingStudioNoteAction(documentId)}
              onUpdateViewer={handleUpdateStudioViewer}
            />
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
          <Editor page={currentPage} pages={pages} onSelectPage={setCurrentPageId} />
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
      <CommandPalette />
      <AppNotice />
    </Layout>
  );
}
