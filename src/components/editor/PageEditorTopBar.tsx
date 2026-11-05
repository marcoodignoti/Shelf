import type { Dispatch, RefObject, SetStateAction } from "react";
import type { EditorSaveState } from "../../lib/editorSaveState";
import { ArrowLeftRight, Check, Columns2, Copy, Download, FileText, FolderInput, History, MoreHorizontal, Star, Trash2, X } from "lucide-react";
import { pageBreadcrumb } from "../../lib/breadcrumb";
import { Page } from "../../lib/db";
import { saveStatusLabel } from "../../lib/editorSaveState";
import { useT } from "../../lib/i18n";
import { useAppStore } from "../../store/useAppStore";
import { FloatingPopover } from "../FloatingPopover";
import { usePageActions } from "../usePageActions";
import { SplitPagePicker } from "../SplitPagePicker";

type PageEditorTopBarProps = {
  page: Page;
  inSplit: boolean;
  breadcrumbs: ReturnType<typeof pageBreadcrumb>;
  saveState: EditorSaveState;
  flushSaveNow: () => Promise<boolean>;
  onSelectPage: (id: string) => void;
  pageMenuOpen: boolean;
  setPageMenuOpen: Dispatch<SetStateAction<boolean>>;
  pageMenuButtonRef: RefObject<HTMLButtonElement | null>;
  isSplitMenuOpen: boolean;
  setIsSplitMenuOpen: Dispatch<SetStateAction<boolean>>;
  splitButtonRef: RefObject<HTMLButtonElement | null>;
  setIsPageHistoryOpen: Dispatch<SetStateAction<boolean>>;
  pageActions: ReturnType<typeof usePageActions>;
};

/** Notes-mode title bar: breadcrumb, save status, split view and page menu. */
export function PageEditorTopBar({
  page,
  inSplit,
  breadcrumbs,
  saveState,
  flushSaveNow,
  onSelectPage,
  pageMenuOpen,
  setPageMenuOpen,
  pageMenuButtonRef,
  isSplitMenuOpen,
  setIsSplitMenuOpen,
  splitButtonRef,
  setIsPageHistoryOpen,
  pageActions,
}: PageEditorTopBarProps) {
  const t = useT();
  const {
    handleDuplicatePage,
    handleExportJSON,
    handleExportMarkdown,
    handleMovePage,
    handleOpenMoveMenu,
    handleRequestDelete,
    handleToggleFavorite,
    handleToggleTemplate,
    handleTurnIntoDatabase,
    movablePages,
    moveMenuOpen,
    moveQuery,
    setMoveMenuOpen,
    setMoveQuery,
  } = pageActions;
  const secondaryPageId = useAppStore((state) => state.secondaryPageId);
  const openInSplit = useAppStore((state) => state.openInSplit);
  const swapSplit = useAppStore((state) => state.swapSplit);
  const closeSplit = useAppStore((state) => state.closeSplit);
  const isSplitPickerOpen = useAppStore((state) => state.isSplitPickerOpen);
  const openSplitPicker = useAppStore((state) => state.openSplitPicker);
  const closeSplitPicker = useAppStore((state) => state.closeSplitPicker);
  const isInSplit = secondaryPageId !== null;

  return (
        <div className={`on-win-titlebar h-11 flex items-center justify-between pr-6 pl-[var(--on-main-titlebar-content-left)] shrink-0 bg-background/95 backdrop-blur z-40 select-none ${inSplit ? "" : "border border-b-0 border-border/70 rounded-t-xl"}`}>
          {/* Breadcrumbs on the left */}
          <nav className="flex items-center gap-1 min-w-0" aria-label={t("editor.pageBreadcrumb")}>
            {breadcrumbs.map((breadcrumb, index) => {
              const isCurrent = breadcrumb.id === page.id;
              return (
                <div key={breadcrumb.id} className="flex items-center min-w-0">
                  {index > 0 && <span className="mx-1 text-muted-foreground/45 text-[11px]">/</span>}
                  <button
                    type="button"
                    title={breadcrumb.title || t("sidebar.untitled")}
                    className={`px-1.5 py-1 rounded-md text-[13px] font-medium transition-colors hover:bg-muted text-muted-foreground truncate ${
                      isCurrent
                        ? "text-foreground font-semibold cursor-default pointer-events-none max-w-[240px] md:max-w-[320px]"
                        : "max-w-[140px] md:max-w-[180px]"
                    }`}
                    disabled={isCurrent}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => onSelectPage(breadcrumb.id)}
                  >
                    {breadcrumb.icon ? `${breadcrumb.icon} ` : ""}
                    {breadcrumb.title || t("sidebar.untitled")}
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Saved Status and Actions on the right */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              className={`text-xs text-muted-foreground/60 transition-colors ${saveState.status === "error" ? "text-destructive" : ""}`}
              title={saveState.status === "error" ? saveState.message : t("editor.saveStatus")}
              role="status"
              aria-live="polite"
            >
              {saveStatusLabel(saveState, t)}
            </div>
            {saveState.status === "error" && (
              <button
                type="button"
                className="text-xs text-destructive underline underline-offset-2 hover:text-foreground"
                onClick={flushSaveNow}
              >
                {t("editor.retrySave")}
              </button>
            )}
            <button
              type="button"
              ref={splitButtonRef}
              className={`rounded-md p-1 transition-colors ${
                isInSplit
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-label={t("editor.splitView")}
              aria-pressed={isInSplit}
              title={t("editor.splitView")}
              onClick={() => {
                if (isInSplit) {
                  setIsSplitMenuOpen((open) => !open);
                } else {
                  openSplitPicker();
                }
              }}
            >
              <Columns2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              ref={pageMenuButtonRef}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("editor.pageActions")}
              onClick={() => setPageMenuOpen((open) => !open)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <FloatingPopover
              anchorElement={pageMenuButtonRef.current}
              open={pageMenuOpen}
              width={224}
              placement="bottom-end"
              onOpenChange={setPageMenuOpen}
              className="on-popover on-page-action-popover"
            >
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleDuplicatePage()}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.duplicate")}
              </button>
              <button
                type="button"
                className="on-menu-item"
                onClick={handleOpenMoveMenu}
              >
                <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
                {t("sidebar.moveTo")}
              </button>
              <button
                type="button"
                className="on-menu-item"
                onClick={() => {
                  setPageMenuOpen(false);
                  setIsPageHistoryOpen(true);
                }}
              >
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.versionHistory")}
              </button>
              <div className="on-menu-separator" />
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleExportMarkdown()}
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.exportMarkdown")}
              </button>
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleExportJSON()}
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                {t("editor.exportJSON")}
              </button>
              <div className="on-menu-separator" />
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleToggleFavorite()}
              >
                <Star className={`h-3.5 w-3.5 text-muted-foreground ${page.is_favorite === 1 ? "fill-current" : ""}`} />
                {page.is_favorite === 1 ? t("sidebar.contextRemoveFromFavorites") : t("sidebar.contextAddToFavorites")}
              </button>
              <button
                type="button"
                className="on-menu-item"
                onClick={() => void handleToggleTemplate()}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                {page.is_template === 1 ? t("sidebar.contextRemoveFromTemplates") : t("sidebar.contextUseAsTemplate")}
              </button>
              {page.is_database !== 1 && (
                <button
                  type="button"
                  className="on-menu-item"
                  onClick={handleTurnIntoDatabase}
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("editor.turnIntoDatabase")}
                </button>
              )}
              <div className="on-menu-separator" />
              <button
                type="button"
                className="on-menu-item on-menu-item-danger"
                onClick={handleRequestDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("sidebar.contextDelete")}
              </button>
            </FloatingPopover>
            <FloatingPopover
              anchorElement={pageMenuButtonRef.current}
              open={moveMenuOpen}
              width={288}
              placement="bottom-end"
              onOpenChange={setMoveMenuOpen}
              className="on-popover"
            >
              <div className="on-popover-search">
                <input
                  className="w-full rounded-full bg-background/60 px-3 py-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder={t("sidebar.moveTo")}
                  value={moveQuery}
                  onChange={(event) => setMoveQuery(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                <button
                  type="button"
                  className="on-menu-item justify-between"
                  onClick={() => void handleMovePage(null)}
                >
                  <span className="truncate text-muted-foreground">{t("sidebar.moveRoot")}</span>
                  {page.parent_id === null && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                {movablePages.map((target) => (
                  <button
                    type="button"
                    key={target.id}
                    className="on-menu-item justify-between"
                    onClick={() => void handleMovePage(target.id)}
                  >
                    <span className="truncate">
                      {target.icon ? `${target.icon} ` : ""}
                      {target.title || t("sidebar.untitled")}
                    </span>
                    {page.parent_id === target.id && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                ))}
                {movablePages.length === 0 && moveQuery.trim() && (
                  <div className="px-2 py-2 text-xs text-muted-foreground">{t("sidebar.noPagesFound")}</div>
                )}
              </div>
            </FloatingPopover>
            <FloatingPopover
              anchorElement={splitButtonRef.current}
              open={isSplitMenuOpen}
              width={200}
              placement="bottom-end"
              onOpenChange={setIsSplitMenuOpen}
              className="on-popover on-split-menu"
            >
              <button
                type="button"
                className="on-menu-item"
                onClick={() => {
                  setIsSplitMenuOpen(false);
                  openSplitPicker();
                }}
              >
                <Columns2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="whitespace-nowrap">{t("editor.chooseSplitPage")}</span>
              </button>
              <button
                type="button"
                className="on-menu-item justify-between"
                onClick={() => {
                  swapSplit();
                  setIsSplitMenuOpen(false);
                }}
              >
                <span className="flex items-center gap-2">
                  <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="whitespace-nowrap">{t("editor.swapPanels")}</span>
                </span>
                <span className="text-xs text-muted-foreground">⌘⇧\</span>
              </button>
              <div className="on-menu-separator" />
              <button
                type="button"
                className="on-menu-item justify-between"
                onClick={() => {
                  closeSplit();
                  setIsSplitMenuOpen(false);
                }}
              >
                <span className="flex items-center gap-2">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="whitespace-nowrap">{t("editor.closeSecondary")}</span>
                </span>
                <span className="text-xs text-muted-foreground">⌘\</span>
              </button>
            </FloatingPopover>
            <FloatingPopover
              anchorElement={splitButtonRef.current}
              open={isSplitPickerOpen}
              width={340}
              placement="bottom-end"
              onOpenChange={(open) => {
                if (!open) closeSplitPicker();
              }}
              className="on-popover"
            >
              <SplitPagePicker
                currentPageId={page.id}
                onChoose={(id) => {
                  openInSplit(id);
                  closeSplitPicker();
                }}
              />
            </FloatingPopover>
          </div>
        </div>
  );
}
