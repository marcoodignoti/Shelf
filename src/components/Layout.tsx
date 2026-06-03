import React from 'react';
import { Sidebar } from './Sidebar';
import { useAppStore } from '../store/useAppStore';
import { PanelLeft } from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, sidebarWidth, toggleSidebar } = useAppStore();
  const sidebarGap = 12;
  const sidebarToggleRightInset = 18;
  const sidebarToggleTopInset = 1;
  const sidebarToggleSize = 28;
  const closedSidebarToggleLeft = 104;
  const closedSidebarToggleTop = 14;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
      {isSidebarOpen && <Sidebar />}
      <div
        className="fixed z-[90] flex items-center gap-2"
        style={{
          left: isSidebarOpen
            ? sidebarGap + sidebarWidth - sidebarToggleRightInset - sidebarToggleSize
            : closedSidebarToggleLeft,
          top: isSidebarOpen ? sidebarGap + sidebarToggleTopInset : closedSidebarToggleTop,
        }}
      >
        <button
          onClick={toggleSidebar}
          className="on-icon-button"
          title="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>
      <main className="flex-1 overflow-y-auto relative transition-all duration-300 flex flex-col">
        {children}
      </main>
    </div>
  );
}
