import React from 'react';
import { Sidebar } from './Sidebar';
import { useAppStore } from '../store/useAppStore';
import { Menu } from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, toggleSidebar } = useAppStore();

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      {isSidebarOpen && <Sidebar />}
      <main className="flex-1 overflow-y-auto relative transition-all duration-300 flex flex-col">
        {!isSidebarOpen && (
          <div className="absolute top-10 left-4 z-50">
            <button 
              onClick={toggleSidebar}
              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-muted-foreground transition-colors"
              title="Open Sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}