import type { Provider } from "../lib/externalAssistant";

interface Props {
  provider: Provider;
  visible: boolean;
}

export function AssistantWebview({ provider, visible }: Props) {
  return (
    <webview
      // Both webviews are always mounted; only the active one is visible,
      // so switching providers preserves each conversation in memory.
      src={provider.url}
      partition={provider.partition}
      className="ea-popover-webview"
      data-provider={provider.id}
      data-visible={visible}
    />
  );
}
