import { useCallback, useEffect, useRef, useState } from "react";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import {
  BetaUpdateDownload,
  BetaUpdateState,
  UpdateDownloadProgress,
  UpdateDownloadTask,
  checkForBetaUpdate,
  dismissedUpdateKey,
  startVerifiedUpdateDownload,
} from "../lib/betaUpdates";
import { desktopAutoUpdateActive } from "../lib/desktop";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";

const AUTO_CHECK_DELAY_MS = 1_500;

type PillPhase = "idle" | "available" | "downloading" | "done";

function hasDismissedUpdate(version: string): boolean {
  try {
    return window.localStorage.getItem(dismissedUpdateKey(version)) === "1";
  } catch {
    return false;
  }
}

function dismissUpdate(version: string): void {
  try {
    window.localStorage.setItem(dismissedUpdateKey(version), "1");
  } catch {
    // Ignore localStorage failures. Dismissal is only a UI preference.
  }
}

function isExpiredUpdateToken(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("update download is not linked to a verified manifest")
  );
}

/**
 * Compact update pill rendered at the top-right of the sidebar. Replaces the
 * old full-card `BetaUpdateNotice`. Three visible phases:
 *  - available: blue "Aggiorna" pill + dismiss button
 *  - downloading: pill with an inline progress bar; clicking cancels
 *  - done: "Pronto" pill; clicking shows the install instructions
 */
export function SidebarUpdatePill() {
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
    // Legacy bridge builds can opt out; current desktop builds use the
    // signed manifest flow on every platform.
    if (desktopAutoUpdateActive()) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void checkForBetaUpdate().then((result) => {
        if (cancelled) return;
        if (result.status !== "available") return;
        if (hasDismissedUpdate(result.manifest.version)) return;
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
    await runDownload(state.download);
  }, [runDownload, showErrorKey, state]);

  const handleCancelDownload = useCallback(async () => {
    await downloadTaskRef.current?.cancel();
  }, []);

  const handleDismiss = useCallback(() => {
    if (state.status !== "available") return;
    dismissUpdate(state.manifest.version);
    setState({ status: "idle" });
    setPhase("idle");
  }, [state]);

  const handleDoneClick = useCallback(() => {
    setShowInstallHint((value) => !value);
  }, []);

  if (phase === "idle" || phase === "available") {
    if (state.status !== "available") return null;
  }

  if (phase === "downloading") {
    const percent = downloadProgress?.percent;
    const width = percent === null || percent === undefined ? 100 : Math.max(3, Math.min(100, percent));
    const label =
      percent !== null && percent !== undefined
        ? t("sidebarUpdate.downloading", { percent: String(Math.round(percent)) })
        : t("settings.updates.verifying");

    return (
      <button
        type="button"
        className="on-sidebar-update-pill on-sidebar-update-pill-downloading"
        onClick={() => void handleCancelDownload()}
        title={t("sidebarUpdate.cancelTitle")}
      >
        <RefreshCw className="on-sidebar-update-pill-spin h-3 w-3" strokeWidth={2.2} />
        <span className="on-sidebar-update-pill-label">{label}</span>
        <span className="on-sidebar-update-pill-progress" aria-hidden="true">
          <span className="on-sidebar-update-pill-progress-fill" style={{ width: `${width}%` }} />
        </span>
      </button>
    );
  }

  if (phase === "done") {
    return (
      <div className="on-sidebar-update-pill-group">
        <button
          type="button"
          className="on-sidebar-update-pill on-sidebar-update-pill-done"
          onClick={handleDoneClick}
          title={t("betaUpdate.closeInstallReopen")}
        >
          <Check className="h-3 w-3" strokeWidth={2.4} />
          <span>{t("sidebarUpdate.ready")}</span>
        </button>
        {showInstallHint && (
          <span className="on-sidebar-update-pill-hint">{t("betaUpdate.closeInstallReopen")}</span>
        )}
      </div>
    );
  }

  // phase === "available"
  const { download, manifest } = state;
  return (
    <div className="on-sidebar-update-pill-group">
      <button
        type="button"
        className="on-sidebar-update-pill on-sidebar-update-pill-available"
        onClick={() => void handleStartDownload()}
        disabled={!download}
        title={manifest.title}
      >
        <RefreshCw className="h-3 w-3" strokeWidth={2.2} />
        <span>{t("sidebarUpdate.update")}</span>
      </button>
      <button
        type="button"
        className="on-sidebar-update-pill-dismiss"
        onClick={handleDismiss}
        aria-label={t("sidebarUpdate.dismiss")}
        title={t("sidebarUpdate.dismiss")}
      >
        <X className="h-3 w-3" strokeWidth={2.2} />
      </button>
    </div>
  );
}
