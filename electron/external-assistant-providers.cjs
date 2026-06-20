// Electron-side source of truth for providers + allowlist logic. Mirrored
// (and kept in sync by external-assistant.test.cjs) with the TS
// helpers in src/lib/externalAssistant.ts.

const PROVIDERS = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    partition: "persist:external-assistant-chatgpt",
    allowlist: ["chatgpt.com", "*.chatgpt.com", "auth.openai.com", "auth0.openai.com", "chat.openai.com"],
  },
  {
    id: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/",
    partition: "persist:external-assistant-gemini",
    allowlist: ["gemini.google.com", "accounts.google.com"],
  },
];

const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

function providerById(id) {
  return PROVIDER_BY_ID[id];
}

function hostMatchesAllowlistEntry(host, entry) {
  if (entry.startsWith("*.")) {
    const suffix = entry.slice(1);
    return host.endsWith(suffix) || host === entry.slice(2);
  }
  return host === entry;
}

function isAllowedNavigation(providerId, url) {
  const provider = providerById(providerId);
  if (!provider) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return provider.allowlist.some((entry) => hostMatchesAllowlistEntry(parsed.hostname, entry));
}

function validateWebviewAttachment(params) {
  const provider = providerById(params.providerId);
  if (!provider) return { ok: false, reason: "unknown provider" };
  if (params.partition !== provider.partition) return { ok: false, reason: "partition mismatch" };
  if (params.preload !== undefined) return { ok: false, reason: "preload forbidden" };
  if (params.nodeIntegration !== false) return { ok: false, reason: "node integration must be disabled" };
  if (params.contextIsolation !== true) return { ok: false, reason: "context isolation must be enabled" };
  if (!isAllowedNavigation(params.providerId, params.src)) return { ok: false, reason: "src not on allowlist" };
  return { ok: true };
}

module.exports = {
  PROVIDERS,
  providerById,
  isAllowedNavigation,
  validateWebviewAttachment,
};
