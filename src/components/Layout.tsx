import React from 'react';
import { Sidebar } from './Sidebar';
import { useAppStore } from '../store/useAppStore';
import { PanelLeft } from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, toggleSidebar } = useAppStore();

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      {isSidebarOpen && <Sidebar />}
      <div
        className={`fixed top-2 z-[90] flex items-center gap-2 ${isSidebarOpen ? 'left-[198px]' : 'left-[84px]'}`}
        data-tauri-drag-region
      >
        <button
          onClick={toggleSidebar}
          className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
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
