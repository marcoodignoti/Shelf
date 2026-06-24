import React from 'react';
import { Sidebar } from './Sidebar';
import { SidebarUpdatePill } from './SidebarUpdatePill';
import { useUIStore } from '../store/useUIStore';
import { useShallow } from 'zustand/react/shallow';
import { PanelLeft } from 'lucide-react';
import { useT } from '../lib/i18n';
import { isWindowsPlatform } from '../lib/platform';
import { WindowsControls } from './WindowsControls';

export function Layout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { isSidebarOpen, sidebarWidth, toggleSidebar, setSidebarWidth } = useUIStore(useShallow((state) => ({
    isSidebarOpen: state.isSidebarOpen,
    sidebarWidth: state.sidebarWidth,
    toggleSidebar: state.toggleSidebar,
    setSidebarWidth: state.setSidebarWidth,
  })));
  const sidebarMargin = 8;
  const sidebarShellWidth = sidebarWidth + sidebarMargin * 2;
  const [shouldRenderSidebar, setShouldRenderSidebar] = React.useState(isSidebarOpen);
  const [isSidebarShellOpen, setIsSidebarShellOpen] = React.useState(isSidebarOpen);
  const [isPillExpanded, setIsPillExpanded] = React.useState(false);
  const isWin = isWindowsPlatform();
  const titlebarOffsets = {
    "--on-main-titlebar-action-left": isWin
      ? "0.75rem"
      : isSidebarShellOpen ? "1.5rem" : "5.25rem",
    "--on-main-titlebar-content-left": isWin
      ? isSidebarShellOpen
        ? "2.75rem"
        : isPillExpanded
          ? "11rem"
          : "5rem"
      : isSidebarShellOpen
        ? "5.25rem"
        : isPillExpanded
          ? "15rem"
          : "9rem",
    "--on-win-controls-inset": isWin ? "142px" : "0px",
  } as React.CSSProperties;

  React.useEffect(() => {
    if (isSidebarOpen) {
      setShouldRenderSidebar(true);
      return;
    }

    setIsSidebarShellOpen(false);
    const timeout = window.setTimeout(() => setShouldRenderSidebar(false), 240);
    return () => window.clearTimeout(timeout);
  }, [isSidebarOpen]);

  React.useEffect(() => {
    if (!isSidebarOpen || !shouldRenderSidebar || isSidebarShellOpen) return;

    let nextFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      nextFrame = window.requestAnimationFrame(() => setIsSidebarShellOpen(true));
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nextFrame);
    };
  }, [isSidebarOpen, isSidebarShellOpen, shouldRenderSidebar]);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(startWidth + moveEvent.clientX - startX);
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
    <div className="on-app-shell relative flex h-screen overflow-hidden bg-transparent text-foreground font-sans">
      {isWin && <WindowsControls />}
      {shouldRenderSidebar && (
        <div
          className={`on-sidebar-shell ${isSidebarShellOpen ? "on-sidebar-shell-open" : "on-sidebar-shell-closed"}`}
          style={{ width: isSidebarShellOpen ? sidebarShellWidth : 0 }}
          aria-hidden={!isSidebarShellOpen}
        >
          <Sidebar />
        </div>
      )}
      {isSidebarShellOpen ? (
        <div
          className="on-main-resize-handle"
          style={{ left: sidebarShellWidth + sidebarMargin }}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("sidebar.resizeSidebar")}
          onPointerDown={handleResizePointerDown}
        />
      ) : null}
      <main
        className="on-main-surface m-2 flex-1 overflow-hidden relative transition-all duration-300 flex flex-col"
        style={titlebarOffsets}
      >
        <div className="on-win-titlebar-actions absolute left-[var(--on-main-titlebar-action-left)] top-3 z-[90] flex items-center gap-2">
          <button
            onClick={toggleSidebar}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            title={t("layout.toggleSidebar")}
            aria-label={t("layout.toggleSidebar")}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
          <SidebarUpdatePill compact={!isSidebarShellOpen} onExpandedChange={setIsPillExpanded} />
        </div>
        {children}
      </main>
    </div>
  );
}
