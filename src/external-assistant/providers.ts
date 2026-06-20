import { PROVIDERS } from "../lib/externalAssistant";
import type { Provider } from "../lib/externalAssistant";

export { PROVIDERS, providerById, nextProvider } from "../lib/externalAssistant";

export const SHELL_PROVIDERS: readonly Provider[] = PROVIDERS;
