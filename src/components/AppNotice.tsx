import { useEffect } from "react";
import AlertCircle from "lucide-react/dist/esm/icons/circle-alert.mjs";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";

const SUCCESS_NOTICE_AUTO_DISMISS_MS = 4_200;
const ERROR_NOTICE_AUTO_DISMISS_MS = 6_500;

export function AppNotice() {
  const t = useT();
  const { notice, clearNotice } = useAppStore();
  const autoDismissMs = notice?.kind === "error"
    ? ERROR_NOTICE_AUTO_DISMISS_MS
    : SUCCESS_NOTICE_AUTO_DISMISS_MS;

  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(clearNotice, autoDismissMs);
    return () => window.clearTimeout(timeoutId);
  }, [autoDismissMs, clearNotice, notice]);

  if (!notice) return null;

  const message = "messageKey" in notice
    ? t(notice.messageKey, notice.params)
    : notice.rawMessage;

  const NoticeIcon = notice.kind === "error" ? AlertCircle : CheckCircle2;
  const ariaLive = notice.kind === "error" ? "assertive" : "polite";

  return (
    <div className="pointer-events-none fixed left-1/2 top-5 z-[120] w-[min(440px,calc(100vw-24px))] -translate-x-1/2">
      <div
        className={`on-notice pointer-events-auto flex items-center gap-3 px-3.5 py-3 text-sm ${
          notice.kind === "error"
            ? "on-notice-error"
            : "on-notice-success"
        }`}
        role={notice.kind === "error" ? "alert" : "status"}
        aria-live={ariaLive}
      >
        <div className="on-notice-icon" aria-hidden="true">
          <NoticeIcon className="h-4 w-4" strokeWidth={2} />
        </div>
        <span className="on-notice-message min-w-0 flex-1">{message}</span>
        <button
          className="on-notice-close"
          onClick={clearNotice}
          aria-label={t("appNotice.dismiss")}
          title={t("appNotice.dismiss")}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <div
          className="on-notice-progress"
          style={{ animationDuration: `${autoDismissMs}ms` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
