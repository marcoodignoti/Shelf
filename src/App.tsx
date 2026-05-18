import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { useAppStore } from "./store/useAppStore";
import { Editor } from "./components/PageEditor";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CommandPalette } from "./components/CommandPalette";

export default function App() {
  const { pages, currentPageId, theme } = useAppStore();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      
      const listener = (e: MediaQueryListEvent) => {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      };
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', listener);
      return () => window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', listener);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  const currentPage = pages.find(p => p.id === currentPageId);

  return (
    <Layout>
      {currentPage ? (
        <ErrorBoundary key={currentPage.id}>
          <Editor page={currentPage} />
        </ErrorBoundary>
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          Select or create a page
        </div>
      )}
      <CommandPalette />
    </Layout>
  );
}
