import { useCallback, useRef } from "react";
import type { Page } from "../lib/db";
import { Editor } from "./PageEditor";
import { useAppStore } from "../store/useAppStore";
import type { SplitPane } from "../store/slices/splitSlice";

export function SplitView({
  primary,
  secondary,
  pages,
  onSelectPrimaryPage,
  onSelectSecondaryPage,
}: {
  primary: Page;
  secondary: Page;
  pages: Page[];
  onSelectPrimaryPage: (id: string) => void;
  onSelectSecondaryPage: (id: string) => void;
}) {
  const splitViewRatio = useAppStore((s) => s.splitViewRatio);
  const setSplitViewRatio = useAppStore((s) => s.setSplitViewRatio);
  const setActivePane = useAppStore((s) => s.setActivePane);
  const containerRef = useRef<HTMLDivElement>(null);

  const markActive = useCallback(
    (pane: SplitPane) => () => setActivePane(pane),
    [setActivePane]
  );

  const handleDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const container = containerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width || 1;
    const startX = event.clientX;
    const startRatio = splitViewRatio;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const newRatio = startRatio + delta / containerWidth;
      setSplitViewRatio(newRatio);
    };
    const handlePointerUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <div ref={containerRef} data-testid="split-container" className="flex h-full w-full flex-row">
      <div
        className="flex min-w-0 flex-1 flex-col"
        style={{
          flexBasis: `${splitViewRatio * 100}%`,
          flexGrow: splitViewRatio,
          flexShrink: splitViewRatio,
        }}
        onFocus={markActive("primary")}
        onPointerDown={markActive("primary")}
      >
        <Editor page={primary} pages={pages} onSelectPage={onSelectPrimaryPage} />
      </div>
      <div
        data-testid="split-divider"
        role="separator"
        aria-orientation="vertical"
        className="w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-border"
        onPointerDown={handleDividerPointerDown}
      />
      <div
        className="flex min-w-0 flex-1 flex-col border-l border-border/40"
        style={{
          flexBasis: `${(1 - splitViewRatio) * 100}%`,
          flexGrow: 1 - splitViewRatio,
          flexShrink: 1 - splitViewRatio,
        }}
        onFocus={markActive("secondary")}
        onPointerDown={markActive("secondary")}
      >
        <Editor page={secondary} pages={pages} onSelectPage={onSelectSecondaryPage} />
      </div>
    </div>
  );
}
