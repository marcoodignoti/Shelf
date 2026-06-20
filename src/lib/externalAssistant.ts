// Pure helpers for the External Assistant popover. No Electron, no React.
// All security-critical decisions (navigation allowlist, webview attachment
// validation) live here so they are fully unit-testable.

export type ProviderId = "chatgpt" | "gemini";

export interface Provider {
  id: ProviderId;
  label: string;
  url: string;
  partition: string;
  /** Hosts that belong to the provider app itself and should stay in the current webview. */
  appHosts: ReadonlyArray<string>;
  /** Hosts (exact or wildcard) the provider's webview may navigate to, https only. */
  allowlist: ReadonlyArray<string>;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    partition: "persist:external-assistant-chatgpt",
    appHosts: ["chatgpt.com", "*.chatgpt.com", "chat.openai.com"],
    allowlist: [
      "chatgpt.com",
      "*.chatgpt.com",
      "auth.openai.com",
      "auth0.openai.com",
      "chat.openai.com",
      "accounts.google.com",
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/",
    partition: "persist:external-assistant-gemini",
    appHosts: ["gemini.google.com"],
    allowlist: ["gemini.google.com", "accounts.google.com"],
  },
] as const;

const PROVIDER_BY_ID: Readonly<Record<ProviderId, Provider>> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
) as Record<ProviderId, Provider>;

export function providerById(id: ProviderId): Provider | undefined {
  return PROVIDER_BY_ID[id];
}

export function nextProvider(current: ProviderId): ProviderId {
  return current === "chatgpt" ? "gemini" : "chatgpt";
}

/** A host matches an allowlist entry if it equals it or matches a `*.domain` wildcard. */
function hostMatchesAllowlistEntry(host: string, entry: string): boolean {
  if (entry.startsWith("*.")) {
    const suffix = entry.slice(1); // ".chatgpt.com"
    return host.endsWith(suffix) || host === entry.slice(2);
  }
  return host === entry;
}

export function isAllowedNavigation(providerId: ProviderId, url: string): boolean {
  const provider = providerById(providerId);
  if (!provider) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return provider.allowlist.some((entry) => hostMatchesAllowlistEntry(parsed.hostname, entry));
}

export function isProviderAppNavigation(providerId: ProviderId, url: string): boolean {
  const provider = providerById(providerId);
  if (!provider) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return provider.appHosts.some((entry) => hostMatchesAllowlistEntry(parsed.hostname, entry));
}

export interface WebviewAttachmentParams {
  src: string;
  partition: string;
  preload: string | undefined;
  nodeIntegration: boolean;
  contextIsolation: boolean;
  providerId: ProviderId;
}

export type WebviewAttachmentResult = { ok: true } | { ok: false; reason: string };

export function validateWebviewAttachment(params: WebviewAttachmentParams): WebviewAttachmentResult {
  const provider = providerById(params.providerId);
  if (!provider) return { ok: false, reason: "unknown provider" };
  if (params.partition !== provider.partition) {
    return { ok: false, reason: "partition mismatch" };
  }
  if (params.preload !== undefined) {
    return { ok: false, reason: "preload forbidden on assistant webviews" };
  }
  if (params.nodeIntegration !== false) {
    return { ok: false, reason: "node integration must be disabled" };
  }
  if (params.contextIsolation !== true) {
    return { ok: false, reason: "context isolation must be enabled" };
  }
  if (!isAllowedNavigation(params.providerId, params.src)) {
    return { ok: false, reason: "src not on provider allowlist" };
  }
  return { ok: true };
}

export interface ExternalAssistantState {
  x: number;
  y: number;
  width: number;
  height: number;
  provider: ProviderId;
  lastOpenedAt: string;
}

const DEFAULT_PROVIDER: ProviderId = "chatgpt";

function isProviderId(value: unknown): value is ProviderId {
  return value === "chatgpt" || value === "gemini";
}

export function parseAssistantState(raw: string | null): ExternalAssistantState | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const { x, y, width, height, provider, lastOpenedAt } = obj;
  if (
    typeof x !== "number" || !Number.isFinite(x) ||
    typeof y !== "number" || !Number.isFinite(y) ||
    typeof width !== "number" || !Number.isFinite(width) || width <= 0 ||
    typeof height !== "number" || !Number.isFinite(height) || height <= 0 ||
    typeof lastOpenedAt !== "string"
  ) {
    return null;
  }
  return {
    x,
    y,
    width,
    height,
    provider: isProviderId(provider) ? provider : DEFAULT_PROVIDER,
    lastOpenedAt,
  };
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampBoundsToBounds(bounds: Bounds, container: Rect): Bounds {
  const minVisibleWidth = 80; // keep the titlebar / drag region reachable
  const minVisibleHeight = 40; // keep the header/footer reachable
  const width = Math.min(bounds.width, container.width);
  const height = Math.min(bounds.height, container.height);
  const maxX = Math.max(container.left, container.left + container.width - minVisibleWidth);
  const maxY = Math.max(container.top, container.top + container.height - minVisibleHeight);
  const x = Math.min(Math.max(bounds.x, container.left), maxX);
  const y = Math.min(Math.max(bounds.y, container.top), maxY);
  return { x, y, width, height };
}

export function defaultBoundsFor(container: Rect): Bounds {
  const width = 420;
  const height = 640;
  const margin = 16;
  return {
    width,
    height,
    x: container.left + container.width - width - margin,
    y: container.top + container.height - height - margin,
  };
}
