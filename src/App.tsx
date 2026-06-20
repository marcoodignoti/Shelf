import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Layout } from "./components/Layout";
import { useAppStore } from "./store/useAppStore";
import { useUIStore } from "./store/useUIStore";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppNotice } from "./components/AppNotice";
import { BetaUpdateNotice } from "./components/BetaUpdateNotice";
import { DesktopUpdateRestartNotice } from "./components/DesktopUpdateRestartNotice";
import { SettingsModal } from "./components/SettingsModal";
import { isNewPageShortcut } from "./lib/shortcuts";
import { HOME_PAGE_ID } from "./lib/navigation";
import { resolveLocale, useT } from "./lib/i18n";
import { HomeView } from "./components/HomeView";
import { setNativeThemeSource, type DesktopUpdateInfo } from "./lib/desktop";
import { isStudioPageUnified } from "./lib/studioDocuments";

const Editor = lazy(() => import("./components/PageEditor").then((module) => ({ default: module.Editor })));
const StudioWorkspace = lazy(() => import("./components/StudioWorkspace").then((module) => ({ default: module.StudioWorkspace })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })));

function WorkspaceLoadingFallback() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {t("common.loadingWorkspace")}
    </div>
  );
}

export default function App() {
  const pages = useAppStore((state) => state.pages);
  const currentPageId = useAppStore((state) => state.currentPageId);
  const theme = useUIStore((state) => state.theme);
  const localePreference = useUIStore((state) => state.localePreference);
  const isSettingsWindowOpen = useUIStore((state) => state.isSettingsWindowOpen);
  const settingsSection = useUIStore((state) => state.settingsSection);
  const closeSettingsWindow = useUIStore((state) => state.closeSettingsWindow);
  const isLoading = useAppStore((state) => state.isLoading);
  const addPage = useAppStore((state) => state.addPage);
  const setCurrentPageId = useAppStore((state) => state.setCurrentPageId);
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const studioDocuments = useAppStore((state) => state.studioDocuments);
  const currentStudioDocumentId = useAppStore((state) => state.currentStudioDocumentId);
  const updateStudioViewerAction = useAppStore((state) => state.updateStudioViewerAction);
  const createMissingStudioNoteAction = useAppStore((state) => state.createMissingStudioNoteAction);
  const replaceStudioPdfAction = useAppStore((state) => state.replaceStudioPdfAction);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const showError = useAppStore((state) => state.showError);
  const showErrorKey = useAppStore((state) => state.showErrorKey);
  const [readyUpdate, setReadyUpdate] = useState<{ version: string | null } | null>(null);

  useLayoutEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    void setNativeThemeSource(theme);
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
    document.documentElement.lang = resolveLocale(localePreference, navigator.language);
  }, [localePreference]);

  useEffect(() => {
    const root = window.document.documentElement;
    const syncWindowFocusClass = () => {
      root.classList.toggle("app-window-inactive", !document.hasFocus());
    };

    syncWindowFocusClass();
    window.addEventListener("focus", syncWindowFocusClass);
    window.addEventListener("blur", syncWindowFocusClass);

    return () => {
      window.removeEventListener("focus", syncWindowFocusClass);
      window.removeEventListener("blur", syncWindowFocusClass);
      root.classList.remove("app-window-inactive");
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey
        && event.key.toLowerCase() === "a") {
        event.preventDefault();
        void window.openNotion?.externalAssistant?.toggle();
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

  useEffect(() => {
    const unsubscribe = window.openNotion?.onDesktopUpdate?.((eventName, payload) => {
      const updateInfo = payload && typeof payload === "object" ? payload as DesktopUpdateInfo : {};
      const version = updateInfo.version ? ` ${updateInfo.version}` : "";
      if (eventName === "desktop-update-available") {
        showSuccess("notice.updateAvailable", { version });
      }
      if (eventName === "desktop-update-downloaded") {
        setReadyUpdate({ version: updateInfo.version ?? null });
      }
      if (eventName === "desktop-update-error") {
        if (typeof payload === "string") {
          showError(payload);
        } else {
          showErrorKey("notice.windowsUpdateFailed");
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [showError, showErrorKey, showSuccess]);

  const pagesById = useMemo(
    () => new Map(pages.map((page) => [page.id, page])),
    [pages]
  );
  const currentPage = currentPageId ? pagesById.get(currentPageId) : undefined;
  const currentStudioDocument = useMemo(
    () => studioDocuments.find((document) => document.id === currentStudioDocumentId),
    [currentStudioDocumentId, studioDocuments]
  );
  const isUnifiedStudio = useMemo(
    () => isStudioPageUnified(studioDocuments),
    [studioDocuments]
  );
  const currentPageStudioDocument = useMemo(
    () => studioDocuments.find((document) => document.id === currentPageId && document.note_page_id === currentPageId) ?? null,
    [currentPageId, studioDocuments]
  );
  const activeStudioDocument = currentPageStudioDocument ?? (!isUnifiedStudio ? currentStudioDocument : null);
  const currentStudioNote = useMemo(
    () => activeStudioDocument
      ? pagesById.get(activeStudioDocument.note_page_id) ?? null
      : null,
    [activeStudioDocument, pagesById]
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

  if (isSettingsWindowOpen) {
    return (
      <div className="on-app-shell h-screen overflow-hidden bg-background text-foreground font-sans">
        <SettingsModal
          isOpen
          embedded
          initialSection={settingsSection}
          onClose={closeSettingsWindow}
        />
        {readyUpdate ? (
          <DesktopUpdateRestartNotice version={readyUpdate.version} onDismiss={() => setReadyUpdate(null)} />
        ) : (
          <BetaUpdateNotice />
        )}
        <AppNotice />
      </div>
    );
  }

  return (
    <Layout>
      {isLoading ? (
        <WorkspaceLoadingFallback />
      ) : activeStudioDocument ? (
          <ErrorBoundary key={activeStudioDocument.id}>
            <Suspense fallback={<WorkspaceLoadingFallback />}>
              <StudioWorkspace
                document={activeStudioDocument}
                note={currentStudioNote}
                pages={pages}
                onSelectPage={setCurrentPageId}
                onCreateMissingNote={handleCreateMissingStudioNote}
                onReplacePdfFile={handleReplaceStudioPdf}
                onUpdateViewer={handleUpdateStudioViewer}
              />
            </Suspense>
          </ErrorBoundary>
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
      </Suspense>
      {readyUpdate ? (
        <DesktopUpdateRestartNotice version={readyUpdate.version} onDismiss={() => setReadyUpdate(null)} />
      ) : (
        <BetaUpdateNotice />
      )}
      <AppNotice />
    </Layout>
  );
}
