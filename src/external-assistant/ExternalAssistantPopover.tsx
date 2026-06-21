import { useEffect, useRef, useState } from "react";
import { ExternalAssistantHeader } from "./ExternalAssistantHeader";
import { AssistantWebview } from "./AssistantWebview";
import { SHELL_PROVIDERS } from "./providers";
import type { ProviderId } from "../lib/externalAssistant";

declare global {
  interface Window {
    externalAssistantShell?: {
      getInitialState: () => Promise<{ provider: ProviderId }>;
      setProvider: (provider: ProviderId) => Promise<null>;
      openProviderExternal: (provider: ProviderId) => Promise<null>;
      close: () => void;
    };
  }
}

export function ExternalAssistantPopover() {
  const [provider, setProvider] = useState<ProviderId>("chatgpt");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.externalAssistantShell?.getInitialState().then((state) => {
      if (cancelled || !state) return;
      setProvider(state.provider);
    });
    return () => { cancelled = true; };
  }, []);

  const handleProviderChange = (next: ProviderId) => {
    setProvider(next);
    void window.externalAssistantShell?.setProvider(next);
  };

  const reloadActiveProvider = () => {
    const activeWebview = bodyRef.current?.querySelector(
      `webview[data-provider="${provider}"]`,
    ) as (HTMLElement & { reload?: () => void }) | null;
    activeWebview?.reload?.();
  };

  return (
    <div className="ea-popover-root">
      <ExternalAssistantHeader
        provider={provider}
        onProviderChange={handleProviderChange}
        onReload={reloadActiveProvider}
        onOpenExternal={() => void window.externalAssistantShell?.openProviderExternal(provider)}
        onClose={() => window.externalAssistantShell?.close()}
      />
      <div ref={bodyRef} className="ea-popover-body">
        {SHELL_PROVIDERS.map((p) => (
          <AssistantWebview key={p.id} provider={p} visible={p.id === provider} />
        ))}
      </div>
    </div>
  );
}
