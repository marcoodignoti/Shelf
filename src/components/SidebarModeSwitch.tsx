type SidebarModeSwitchProps = {
  mode: "notes" | "studio";
  onChange: (mode: "notes" | "studio") => void;
};

export function SidebarModeSwitch({ mode, onChange }: SidebarModeSwitchProps) {
  return (
    <div className="on-mode-switch" aria-label="Workspace mode">
      <button
        type="button"
        className={`on-mode-switch-segment ${mode === "notes" ? "on-mode-switch-segment-active" : ""}`}
        onClick={() => onChange("notes")}
      >
        Note
      </button>
      <button
        type="button"
        className={`on-mode-switch-segment ${mode === "studio" ? "on-mode-switch-segment-active" : ""}`}
        onClick={() => onChange("studio")}
      >
        Studio
      </button>
    </div>
  );
}
