import { useEffect, useRef, useState } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import type { ProviderId } from "../lib/externalAssistant";
import { SHELL_PROVIDERS } from "./providers";
import { ProviderIcon } from "./ProviderIcons";

interface Props {
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  onReload: () => void;
  onOpenExternal: () => void;
  onClose: () => void;
}

const COMPACT_THRESHOLD = 360;
const COMPACT_RELEASE = 380;

export function ExternalAssistantHeader({
  provider,
  onProviderChange,
  onReload,
  onOpenExternal,
  onClose,
}: Props) {
  const [compact, setCompact] = useState(false);
  const [actionValue, setActionValue] = useState("");
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      setCompact((prev) => (prev ? width < COMPACT_RELEASE : width < COMPACT_THRESHOLD));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleActionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const action = event.target.value;
    setActionValue("");
    if (action === "reload") onReload();
    else if (action === "open") onOpenExternal();
    else if (action === "close") onClose();
  };

  const headerClass = `ea-popover-header${compact ? " ea-popover-header-compact" : ""}`;

  return (
    <div className={headerClass} ref={headerRef}>
      <div className="ea-popover-toolbar ea-popover-toolbar-left">
        <label className="ea-native-select ea-provider-select">
          <span className="ea-provider-select-icon" aria-hidden="true">
            <ProviderIcon providerId={provider} className="ea-provider-select-svg" />
          </span>
          <select
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as ProviderId)}
            aria-label="Assistant provider"
          >
            {SHELL_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown className="ea-native-select-chevron" aria-hidden="true" />
        </label>
      </div>
      <div className="ea-popover-toolbar ea-popover-toolbar-right">
        <label className="ea-native-select ea-action-select">
          <select
            value={actionValue}
            onChange={handleActionChange}
            aria-label="Assistant actions"
          >
            <option value="" disabled>⋯</option>
            <option value="reload">Reload</option>
            <option value="open">Open in browser</option>
          </select>
          <ChevronDown className="ea-native-select-chevron" aria-hidden="true" />
        </label>
        <button
          type="button"
          className="ea-toolbar-button ea-popover-close"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <X className="ea-toolbar-icon" />
        </button>
      </div>
    </div>
  );
}
