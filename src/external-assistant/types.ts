import type { ProviderId } from "../lib/externalAssistant";

export type { ProviderId };

export interface ExternalAssistantShellState {
  provider: ProviderId;
}
