import { useEffect, useState } from "react";
import { windowMinimize, windowToggleMaximize, windowClose, windowIsMaximized } from "../lib/desktop";

export function WindowsControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void windowIsMaximized().then(setMaximized);
    const interval = setInterval(() => {
      void windowIsMaximized().then(setMaximized);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="on-win-controls" aria-label="Window controls">
      <button
        type="button"
        className="on-win-control-btn on-win-control-minimize"
        aria-label="Minimize"
        onClick={() => void windowMinimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <line x1="0" y1="5" x2="10" y2="5" />
        </svg>
      </button>
      <button
        type="button"
        className="on-win-control-btn on-win-control-maximize"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void windowToggleMaximize().then(() => void windowIsMaximized().then(setMaximized))}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="on-win-control-btn on-win-control-close"
        aria-label="Close"
        onClick={() => void windowClose()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  );
}
