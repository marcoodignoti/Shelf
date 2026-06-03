import React from 'react';
import { Sidebar } from './Sidebar';
import { useAppStore } from '../store/useAppStore';
import { PanelLeft } from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, sidebarWidth, toggleSidebar } = useAppStore();
  const sidebarGap = 8;
  const sidebarMargin = 8;
  const sidebarToggleRightInset = 8;
  const sidebarToggleTopInset = 1;
  const sidebarToggleSize = 24;
  const closedSidebarToggleLeft = 86;
  const closedSidebarToggleTop = sidebarGap + sidebarToggleTopInset;
  const sidebarShellWidth = sidebarWidth + sidebarMargin * 2;
  const [shouldRenderSidebar, setShouldRenderSidebar] = React.useState(isSidebarOpen);
  const [isSidebarShellOpen, setIsSidebarShellOpen] = React.useState(isSidebarOpen);

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

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
      {shouldRenderSidebar && (
        <div
          className={`on-sidebar-shell ${isSidebarShellOpen ? "on-sidebar-shell-open" : "on-sidebar-shell-closed"}`}
          style={{ width: isSidebarShellOpen ? sidebarShellWidth : 0 }}
          aria-hidden={!isSidebarShellOpen}
        >
          <Sidebar />
        </div>
      )}
      <div
        className="fixed z-[90] flex items-center gap-2 transition-[left,top] duration-[220ms] ease-out"
        style={{
          left: isSidebarShellOpen
            ? sidebarGap + sidebarWidth - sidebarToggleRightInset - sidebarToggleSize
            : closedSidebarToggleLeft,
          top: isSidebarShellOpen ? sidebarGap + sidebarToggleTopInset : closedSidebarToggleTop,
        }}
      >
        <button
          onClick={toggleSidebar}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          title="Toggle sidebar"
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <main className="flex-1 overflow-y-auto relative transition-all duration-300 flex flex-col">
        {children}
      </main>
    </div>
  );
}
