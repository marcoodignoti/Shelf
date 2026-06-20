import X from "lucide-react/dist/esm/icons/x.mjs";
import type { ProviderId } from "../lib/externalAssistant";
import { SHELL_PROVIDERS } from "./providers";

interface Props {
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  onClose: () => void;
}

export function ExternalAssistantHeader({ provider, onProviderChange, onClose }: Props) {
  return (
    <div className="ea-popover-header">
      <div className="ea-popover-switcher">
        {SHELL_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ea-popover-switcher-button"
            data-active={p.id === provider}
            onClick={() => onProviderChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ea-popover-close"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
