import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { History, RotateCcw, X } from "lucide-react";
import { getPage, listPageVersions, restorePageVersion, type PageVersion } from "../lib/db";
import { useT } from "../lib/i18n";
import { pageContentToSearchText } from "../lib/pageContent";
import { useAppStore } from "../store/useAppStore";

function versionLabel(version: PageVersion, t: ReturnType<typeof useT>): string {
  switch (version.reason) {
    case "trash":
      return t("history.reasonTrash");
    case "restore":
      return t("history.reasonRestore");
    default:
      return t("history.reasonUpdate");
  }
}

function versionPreview(version: PageVersion): string {
  const content = version.snapshot.content;
  if (typeof content === "string" && content.trim()) {
    return pageContentToSearchText(content).slice(0, 180);
  }
  return version.snapshot.title || "";
}

export function PageHistoryDialog({
  pageId,
  open,
  onClose,
  onBeforeRestore,
}: {
  pageId: string;
  open: boolean;
  onClose: () => void;
  onBeforeRestore?: () => Promise<boolean> | boolean;
}) {
  const t = useT();
  const { fetchPages, showError, showSuccess, updatePageOptimistically } = useAppStore();
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoading(true);
    listPageVersions(pageId)
      .then((nextVersions) => {
        if (!cancelled) setVersions(nextVersions);
      })
      .catch((error: unknown) => {
        if (!cancelled) showError(error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pageId, showError]);

  if (!open) return null;

  const handleRestore = async (version: PageVersion) => {
    if (restoringId) return;
    setRestoringId(version.id);
    try {
      const saved = await onBeforeRestore?.();
      if (saved === false) {
        showError(new Error(t("history.saveBeforeRestoreFailed")));
        return;
      }
      const restored = await restorePageVersion(version.id);
      const fullPage = await getPage(restored.id);
      updatePageOptimistically(restored.id, fullPage ?? restored);
      await fetchPages();
      showSuccess("history.restored");
      onClose();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setRestoringId(null);
    }
  };

  return createPortal(
    <div className="on-modal-overlay z-[245] items-center justify-center p-4" onMouseDown={onClose}>
      <div className="on-modal-panel w-[540px] max-w-[calc(100vw-2rem)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <History className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1 text-sm font-semibold">{t("history.title")}</div>
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={onClose} aria-label={t("settings.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[min(60vh,520px)] overflow-y-auto p-3">
          {isLoading ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">{t("common.loadingWorkspace")}</div>
          ) : versions.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">{t("history.empty")}</div>
          ) : versions.map((version) => (
            <div key={version.id} className="flex gap-3 rounded-lg px-3 py-3 hover:bg-muted/70">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{versionLabel(version, t)}</span>
                  <span className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleString()}</span>
                </div>
                {version.snapshot.title ? <div className="mt-1 truncate text-xs text-muted-foreground">{version.snapshot.title}</div> : null}
                {versionPreview(version) ? <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{versionPreview(version)}</div> : null}
              </div>
              <button
                type="button"
                className="on-button-secondary shrink-0 gap-2 self-start"
                disabled={restoringId !== null}
                onClick={() => void handleRestore(version)}
              >
                <RotateCcw className="h-4 w-4" />
                {t("history.restore")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
