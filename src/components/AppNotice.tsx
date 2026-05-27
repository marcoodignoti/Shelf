import { X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export function AppNotice() {
  const { notice, clearNotice } = useAppStore();

  if (!notice) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-8 z-[120] w-[min(520px,calc(100vw-32px))] -translate-x-1/2">
      <div
        className={`on-notice pointer-events-auto flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
          notice.kind === "error"
            ? "on-notice-error"
            : "text-foreground"
        }`}
      >
        <span>{notice.message}</span>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={clearNotice}
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
