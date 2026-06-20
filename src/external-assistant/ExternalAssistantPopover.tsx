import { useEffect, useState } from "react";
import { ExternalAssistantHeader } from "./ExternalAssistantHeader";
import { AssistantWebview } from "./AssistantWebview";
import { SHELL_PROVIDERS } from "./providers";
import type { ProviderId } from "../lib/externalAssistant";

declare global {
  interface Window {
    externalAssistantShell?: {
      getInitialState: () => Promise<{ provider: ProviderId }>;
      setProvider: (provider: ProviderId) => Promise<null>;
      close: () => void;
    };
  }
}

export function ExternalAssistantPopover() {
  const [provider, setProvider] = useState<ProviderId>("chatgpt");

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

  return (
    <div className="ea-popover-root">
      <ExternalAssistantHeader
        provider={provider}
        onProviderChange={handleProviderChange}
        onClose={() => window.externalAssistantShell?.close()}
      />
      <div className="ea-popover-body">
        {SHELL_PROVIDERS.map((p) => (
          <AssistantWebview key={p.id} provider={p} visible={p.id === provider} />
        ))}
      </div>
      <footer className="ea-popover-footer">
        {provider === "chatgpt"
          ? "Served by OpenAI — your chats go to their servers."
          : "Served by Google — your chats go to their servers."}
      </footer>
    </div>
  );
}
