import { useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import type { ProviderId } from "../lib/externalAssistant";
import { SHELL_PROVIDERS } from "./providers";

interface Props {
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  onReload: () => void;
  onOpenExternal: () => void;
  onClose: () => void;
}

const PROVIDER_META: Record<ProviderId, { icon: string; subtitle: string; shortUrl: string }> = {
  chatgpt: {
    icon: "◎",
    subtitle: "Spiegazione Q&A",
    shortUrl: "https://chatgpt.com",
  },
  gemini: {
    icon: "✦",
    subtitle: "Immagini e testo",
    shortUrl: "https://gemini.google.com",
  },
};

export function ExternalAssistantHeader({
  provider,
  onProviderChange,
  onReload,
  onOpenExternal,
  onClose,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = SHELL_PROVIDERS.find((p) => p.id === provider) ?? SHELL_PROVIDERS[0];
  const activeMeta = PROVIDER_META[active.id];

  const selectProvider = (next: ProviderId) => {
    onProviderChange(next);
    setMenuOpen(false);
  };

  return (
    <div className="ea-popover-header">
      <div className="ea-popover-traffic-safe" />
      <div className="ea-popover-toolbar">
        <div className="ea-provider-control">
          <button
            type="button"
            className="ea-provider-trigger"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="ea-provider-icon" aria-hidden="true">{activeMeta.icon}</span>
            <ChevronDown className="ea-provider-chevron" aria-hidden="true" />
            <span className="ea-provider-url">{activeMeta.shortUrl}</span>
          </button>
          {menuOpen ? (
            <div className="ea-provider-menu" role="menu">
              {SHELL_PROVIDERS.map((p) => {
                const meta = PROVIDER_META[p.id];
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="ea-provider-menu-item"
                    role="menuitemradio"
                    aria-checked={p.id === provider}
                    onClick={() => selectProvider(p.id)}
                  >
                    <span className="ea-provider-menu-icon" aria-hidden="true">{meta.icon}</span>
                    <span className="ea-provider-menu-copy">
                      <span className="ea-provider-menu-label">{p.label}</span>
                      <span className="ea-provider-menu-subtitle">{meta.subtitle}</span>
                    </span>
                    {p.id === provider ? <Check className="ea-provider-check" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="ea-toolbar-button"
          aria-label="Reload"
          title="Reload"
          onClick={onReload}
        >
          <RefreshCw className="ea-toolbar-icon" />
        </button>
        <button
          type="button"
          className="ea-toolbar-button"
          aria-label="Open in browser"
          title="Open in browser"
          onClick={onOpenExternal}
        >
          <ExternalLink className="ea-toolbar-icon" />
        </button>
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
      {menuOpen ? (
        <button
          type="button"
          className="ea-provider-backdrop"
          aria-label="Close provider menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
    </div>
  );
}
