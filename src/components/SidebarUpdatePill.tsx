import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BetaUpdateDownload,
  BetaUpdateState,
  UpdateDownloadProgress,
  UpdateDownloadTask,
  checkForBetaUpdate,
  startVerifiedUpdateDownload,
} from "../lib/betaUpdates";
import { desktopAutoUpdateActive } from "../lib/desktop";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";
import Download from "lucide-react/dist/esm/icons/download.mjs";

const AUTO_CHECK_DELAY_MS = 1_500;

type PillPhase = "idle" | "available" | "downloading" | "paused" | "done";

function isExpiredUpdateToken(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("update download is not linked to a verified manifest")
  );
}

/**
 * Compact update pill. Phases:
 *  - available: "Aggiorna" (or Download icon when compact) — click to download
 *  - downloading: real-time progress bar (click to cancel)
 *  - paused: frozen progress bar (click to cancel)
 *  - done: "Pronto" — click to show install instructions
 *
 * The available pill and the progress bar are rendered as stacked crossfade
 * layers so the transition from "Aggiorna" to the loading bar is fluid.
 *
 * When `compact` is true (sidebar closed), renders a tiny icon-only variant
 * anchored near the sidebar toggle so the update affordance stays visible.
 */
export function SidebarUpdatePill({
  compact = false,
  onExpandedChange,
}: {
  compact?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const t = useT();
  const showError = useAppStore((state) => state.showError);
  const showErrorKey = useAppStore((state) => state.showErrorKey);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const [state, setState] = useState<BetaUpdateState>({ status: "idle" });
  const [phase, setPhase] = useState<PillPhase>("idle");
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const downloadTaskRef = useRef<UpdateDownloadTask | null>(null);
  const [showInstallHint, setShowInstallHint] = useState(false);

  useEffect(() => {
    if (desktopAutoUpdateActive()) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void checkForBetaUpdate().then((result) => {
        if (cancelled) return;
        if (result.status !== "available") return;
        setState(result);
        setPhase("available");
      });
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const runDownload = useCallback(
    async (download: BetaUpdateDownload) => {
      try {
        setPhase("downloading");
        setDownloadProgress(null);
        const task = startVerifiedUpdateDownload(download, setDownloadProgress);
        downloadTaskRef.current = task;
        await task.promise;
        setPhase("done");
        setShowInstallHint(false);
        showSuccess("notice.updateDownloaded");
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "Update download cancelled") {
          setDownloadProgress(null);
          setPhase("available");
          showSuccess("settings.updates.cancelled");
        } else if (isExpiredUpdateToken(error)) {
          const refreshed = await checkForBetaUpdate();
          if (refreshed.status === "available" && refreshed.download) {
            setState(refreshed);
            setDownloadProgress(null);
            await runDownload(refreshed.download);
          } else {
            setState(refreshed);
            setPhase(refreshed.status === "available" ? "available" : "idle");
            showError(error);
          }
        } else {
          setPhase(state.status === "available" ? "available" : "idle");
          showError(error);
        }
      } finally {
        downloadTaskRef.current = null;
      }
    },
    [showError, showSuccess, state.status],
  );

  const handleStartDownload = useCallback(async () => {
    if (state.status !== "available") return;
    if (!state.download) {
      showErrorKey("notice.noPlatformDownload");
      return;
    }
    // Blur so the now-hidden available layer doesn't retain focus behind
    // the progress bar layer (aria-hidden + focus warning from Chromium).
    (document.activeElement as HTMLElement | null)?.blur?.();
    await runDownload(state.download);
  }, [runDownload, showErrorKey, state]);

  const handleCancelDownload = useCallback(async () => {
    await downloadTaskRef.current?.cancel();
  }, []);

  const handleDoneClick = useCallback(() => {
    setShowInstallHint((value) => !value);
  }, []);

  const isBar = phase === "downloading" || phase === "paused";
  const showAvailable = phase === "available";

  useEffect(() => {
    if (!compact || !onExpandedChange) return;
    onExpandedChange(isBar);
  }, [compact, isBar, onExpandedChange]);

  if (phase === "idle" || phase === "available") {
    if (state.status !== "available") return null;
  }

  const percent =
    downloadProgress?.percent !== null && downloadProgress?.percent !== undefined
      ? Math.max(2, Math.min(100, downloadProgress.percent))
      : 0;

  if (compact) {
    const compactLabel = isBar
      ? t("sidebarUpdate.cancelTitle")
      : phase === "done"
        ? t("sidebarUpdate.ready")
        : t("sidebarUpdate.update");
    const compactClick = isBar
      ? () => void handleCancelDownload()
      : phase === "done"
        ? handleDoneClick
        : () => void handleStartDownload();
    return (
      <button
        type="button"
        className={`on-sidebar-update-pill-compact ${isBar ? "on-sidebar-update-pill-compact-bar" : phase === "done" ? "on-sidebar-update-pill-compact-done" : "on-sidebar-update-pill-compact-available"}${phase === "paused" ? " on-sidebar-update-pill-compact-paused" : ""}`}
        onClick={compactClick}
        disabled={!isBar && phase !== "done" && (state.status !== "available" || !state.download)}
        title={compactLabel}
        aria-label={compactLabel}
        role={isBar ? "progressbar" : undefined}
        aria-valuenow={isBar ? Math.round(percent) : undefined}
        aria-valuemin={isBar ? 0 : undefined}
        aria-valuemax={isBar ? 100 : undefined}
      >
        <Download className={`on-sidebar-update-pill-compact-icon${isBar ? " on-sidebar-update-pill-compact-icon-hidden" : ""}`} />
        <span
          className={`on-sidebar-update-pill-compact-bar-fill${isBar ? " on-sidebar-update-pill-compact-bar-fill-visible" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </button>
    );
  }

  const fullPill = (
    <div className="on-sidebar-update-pill-group">
      {phase === "done" ? (
        <button
          type="button"
          className="on-sidebar-update-pill on-sidebar-update-pill-done"
          onClick={handleDoneClick}
          title={t("betaUpdate.closeInstallReopen")}
        >
          <span>{t("sidebarUpdate.ready")}</span>
          {showInstallHint && (
            <span className="on-sidebar-update-pill-hint">{t("betaUpdate.closeInstallReopen")}</span>
          )}
        </button>
      ) : (
        <>
          <div
            className={`on-sidebar-update-pill-layer on-sidebar-update-pill-layer-available${showAvailable ? " is-active" : " is-hidden"}`}
            inert={!showAvailable}
          >
            <button
              type="button"
              className="on-sidebar-update-pill on-sidebar-update-pill-available"
              onClick={() => void handleStartDownload()}
              disabled={state.status !== "available" || !state.download}
            >
              <span>{t("sidebarUpdate.update")}</span>
            </button>
          </div>
          <div
            className={`on-sidebar-update-pill-layer on-sidebar-update-pill-layer-bar${isBar ? " is-active" : " is-hidden"}`}
            inert={!isBar}
          >
            <button
              type="button"
              className={`on-sidebar-update-pill on-sidebar-update-pill-bar${isBar ? ` on-sidebar-update-pill-${phase}` : ""}`}
              role="progressbar"
              aria-valuenow={Math.round(percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("sidebarUpdate.cancelTitle")}
              title={t("sidebarUpdate.cancelTitle")}
              onClick={() => void handleCancelDownload()}
            >
              <span
                className="on-sidebar-update-pill-bar-fill"
                style={{ width: `${percent}%` }}
              />
            </button>
          </div>
        </>
      )}
    </div>
  );

  // When not compact, portal into the sidebar so the pill appears inside it
  // while keeping this component instance (and its state) always mounted.
  const target = typeof document !== "undefined"
    ? document.getElementById("on-sidebar-update-pill-target")
    : null;
  if (target) return createPortal(fullPill, target);
  return fullPill;
}
