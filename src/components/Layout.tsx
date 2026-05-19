import React from 'react';
import { Sidebar } from './Sidebar';
import { useAppStore } from '../store/useAppStore';
import { PanelLeft } from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, toggleSidebar } = useAppStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
      {isSidebarOpen && <Sidebar />}
      <div
        className={`fixed top-2 z-[90] flex items-center gap-2 ${isSidebarOpen ? 'left-[198px]' : 'left-[84px]'}`}
        data-tauri-drag-region
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
