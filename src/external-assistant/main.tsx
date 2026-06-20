import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { ExternalAssistantPopover } from "./ExternalAssistantPopover";

// Mirror the main renderer's theme handling so the popover matches the
// user's chosen theme. The shell has no access to the Zustand UI store, so
// it reads the same localStorage key ("opennotion-theme") the store writes.
function applyTheme(): (() => void) | undefined {
  const root = window.document.documentElement;
  const stored = window.localStorage.getItem("opennotion-theme");
  const theme = stored === "light" || stored === "dark" ? stored : "system";

  const resolve = (): "light" | "dark" =>
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const apply = () => {
    root.classList.remove("light", "dark");
    root.classList.add(resolve());
  };

  apply();
  if (theme === "system") {
    const listener = (e: MediaQueryListEvent) => {
      root.classList.remove("light", "dark");
      root.classList.add(e.matches ? "dark" : "light");
    };
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", listener);
    return () => window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", listener);
  }
  return undefined;
}

const container = document.getElementById("root");
if (container) {
  applyTheme();
  createRoot(container).render(
    <React.StrictMode>
      <ExternalAssistantPopover />
    </React.StrictMode>,
  );
}
