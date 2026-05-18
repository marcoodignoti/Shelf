import { useAppStore } from '../store/useAppStore';
import { getAllPages } from '../lib/db';
import { Moon, Sun, Monitor, Download, X } from 'lucide-react';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { theme, setTheme } = useAppStore();

  if (!isOpen) return null;

  const handleExport = async () => {
    const pages = await getAllPages();
    const backup = {
      exported_at: new Date().toISOString(),
      pages
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", "opennotion_backup.json");
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-card border border-border shadow-2xl rounded-xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-muted-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-8">
          
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-1">Appearance</h3>
              <p className="text-xs text-muted-foreground">Customize how OpenNotion looks on your device.</p>
            </div>
            
            <div className="flex gap-3">
              <button 
                className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 rounded-lg border ${theme === 'light' ? 'border-foreground bg-black/5 dark:bg-white/10' : 'border-border hover:bg-black/5 dark:hover:bg-white/5'} transition-colors`}
                onClick={() => setTheme('light')}
              >
                <Sun className="w-6 h-6" />
                <span className="text-sm font-medium">Light</span>
              </button>
              
              <button 
                className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 rounded-lg border ${theme === 'dark' ? 'border-foreground bg-black/5 dark:bg-white/10' : 'border-border hover:bg-black/5 dark:hover:bg-white/5'} transition-colors`}
                onClick={() => setTheme('dark')}
              >
                <Moon className="w-6 h-6" />
                <span className="text-sm font-medium">Dark</span>
              </button>
              
              <button 
                className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 rounded-lg border ${theme === 'system' ? 'border-foreground bg-black/5 dark:bg-white/10' : 'border-border hover:bg-black/5 dark:hover:bg-white/5'} transition-colors`}
                onClick={() => setTheme('system')}
              >
                <Monitor className="w-6 h-6" />
                <span className="text-sm font-medium">System</span>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-1">Data & Privacy</h3>
              <p className="text-xs text-muted-foreground">Export your entire workspace as a JSON file.</p>
            </div>
            
            <button 
              onClick={handleExport}
              className="flex items-center justify-center w-full px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border rounded-md font-medium text-sm transition-colors"
            >
              <Download className="w-4 h-4 mr-2" />
              Export Database Backup
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
