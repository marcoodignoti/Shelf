import { useCallback, useEffect, useState } from "react";
import Clipboard from "lucide-react/dist/esm/icons/clipboard.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { BetaUpdateState, checkForBetaUpdate, dismissedUpdateKey, downloadVerifiedUpdate } from "../lib/betaUpdates";
import { desktopAutoUpdateActive } from "../lib/desktop";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";

const AUTO_CHECK_DELAY_MS = 1_500;
const HOMEBREW_UPDATE_COMMAND = [
  "brew tap marcoodignoti/shelf",
  "brew upgrade --cask shelf-beta || brew install --cask shelf-beta",
].join("\n");

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

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
}

export function BetaUpdateNotice() {
  const t = useT();
  const showError = useAppStore((state) => state.showError);
  const showErrorKey = useAppStore((state) => state.showErrorKey);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const [state, setState] = useState<BetaUpdateState>({ status: "idle" });
  const [copiedHomebrewCommand, setCopiedHomebrewCommand] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

	  useEffect(() => {
	    // Legacy bridge builds can opt out; current desktop builds use the
	    // signed manifest notice on every platform.
	    if (desktopAutoUpdateActive()) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void checkForBetaUpdate().then((result) => {
        if (cancelled) return;
        if (result.status !== "available") return;
        if (hasDismissedUpdate(result.manifest.version)) return;
        setState(result);
      });
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (state.status !== "available") return;
    dismissUpdate(state.manifest.version);
    setState({ status: "idle" });
  }, [state]);

  const handleDownload = useCallback(async () => {
    if (state.status !== "available") return;
    if (!state.download) {
      showErrorKey("notice.noPlatformDownload");
      return;
    }

    try {
      setIsDownloading(true);
      await downloadVerifiedUpdate(state.download);
      showSuccess("notice.updateDownloaded");
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsDownloading(false);
    }
  }, [showError, showErrorKey, showSuccess, state]);

  const handleCopyHomebrewCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(HOMEBREW_UPDATE_COMMAND);
      setCopiedHomebrewCommand(true);
      window.setTimeout(() => setCopiedHomebrewCommand(false), 2_000);
    } catch (error: unknown) {
      showError(error);
    }
  }, [showError]);

  if (state.status !== "available") return null;

  const { manifest, download } = state;
  const showHomebrewCommand = isMacPlatform();

  return (
    <aside className="on-beta-update" role="status" aria-live="polite">
      <div className="on-beta-update-header">
        <span>{t("betaUpdate.title")}</span>
        <button type="button" onClick={handleDismiss} aria-label={t("betaUpdate.dismiss")} title={t("betaUpdate.dismiss")}>
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="on-beta-update-title">{manifest.title}</div>
      <p>{manifest.summary}</p>
      {manifest.changes.length > 0 && (
        <ul className="on-beta-update-list">
          {manifest.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="on-button-secondary on-beta-update-button"
        onClick={() => void handleDownload()}
        disabled={isDownloading || !download}
      >
        <Download className="h-4 w-4" strokeWidth={1.9} />
        {isDownloading
          ? t("settings.updates.verifying")
          : download
            ? t("settings.updates.download", { label: manifest.version })
            : t("settings.updates.noBuild")}
      </button>
      {download?.size && <div className="on-beta-update-size">{download.label} - {download.size}</div>}
      <div className="on-beta-update-steps">
        <span>{t("betaUpdate.closeInstallReopen")}</span>
        {showHomebrewCommand && <span>{t("betaUpdate.homebrewInstead")}</span>}
      </div>
      {showHomebrewCommand && (
        <button type="button" className="on-beta-update-copy" onClick={() => void handleCopyHomebrewCommand()}>
          <Clipboard className="h-3.5 w-3.5" strokeWidth={1.9} />
          {copiedHomebrewCommand ? t("betaUpdate.copiedHomebrew") : t("betaUpdate.copyHomebrew")}
        </button>
      )}
    </aside>
  );
}
