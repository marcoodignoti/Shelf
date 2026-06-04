import packageJson from "../../package.json";

export const CURRENT_APP_VERSION = packageJson.version;
export const DEFAULT_UPDATE_MANIFEST_URL =
  "https://github.com/marcoodignoti/OpenNotion/releases/latest/download/beta-update.json";

export type BetaUpdateDownload = {
  url: string;
  label: string;
  size?: string;
};

export type BetaUpdateManifest = {
  version: string;
  channel: "beta" | "stable";
  publishedAt: string;
  title: string;
  summary: string;
  changes: string[];
  downloads: {
    macosArm64?: BetaUpdateDownload;
    windowsX64?: BetaUpdateDownload;
  };
};

export type BetaUpdateState =
  | { status: "idle" | "checking" | "current" | "disabled" }
  | { status: "available"; manifest: BetaUpdateManifest; download: BetaUpdateDownload | null }
  | { status: "error"; message: string };

const MAX_CHANGE_ITEMS = 5;

function manifestUrl(): string {
  return import.meta.env.VITE_OPENNOTION_UPDATE_MANIFEST_URL || DEFAULT_UPDATE_MANIFEST_URL;
}

async function fetchManifest(url: string): Promise<unknown> {
  if (typeof window !== "undefined" && window.openNotion) {
    return await window.openNotion.invoke<unknown>("fetch_update_manifest", { url });
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Update check failed (${response.status})`);
  }

  return await response.json();
}

function normalizeVersionPart(part: string): number {
  const value = Number.parseInt(part.replace(/\D.*/, ""), 10);
  return Number.isFinite(value) ? value : 0;
}

export function compareVersions(first: string, second: string): number {
  const firstParts = first.replace(/^v/i, "").split(/[.-]/).map(normalizeVersionPart);
  const secondParts = second.replace(/^v/i, "").split(/[.-]/).map(normalizeVersionPart);
  const length = Math.max(firstParts.length, secondParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const delta = (firstParts[index] ?? 0) - (secondParts[index] ?? 0);
    if (delta !== 0) return delta;
  }

  return 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseDownload(value: unknown): BetaUpdateDownload | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!isString(record.url) || !record.url.startsWith("https://")) return undefined;
  if (!isString(record.label)) return undefined;

  return {
    url: record.url,
    label: record.label,
    ...(isString(record.size) ? { size: record.size } : {}),
  };
}

export function parseBetaUpdateManifest(value: unknown): BetaUpdateManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid update manifest");
  }

  const record = value as Record<string, unknown>;
  const downloads = typeof record.downloads === "object" && record.downloads !== null && !Array.isArray(record.downloads)
    ? record.downloads as Record<string, unknown>
    : {};
  const changes = Array.isArray(record.changes)
    ? record.changes.filter(isString).slice(0, MAX_CHANGE_ITEMS)
    : [];

  if (!isString(record.version) || !isString(record.publishedAt) || !isString(record.title) || !isString(record.summary)) {
    throw new Error("Invalid update manifest");
  }

  if (record.channel !== "beta" && record.channel !== "stable") {
    throw new Error("Invalid update manifest channel");
  }

  return {
    version: record.version,
    channel: record.channel,
    publishedAt: record.publishedAt,
    title: record.title,
    summary: record.summary,
    changes,
    downloads: {
      macosArm64: parseDownload(downloads.macosArm64),
      windowsX64: parseDownload(downloads.windowsX64),
    },
  };
}

export function downloadForPlatform(manifest: BetaUpdateManifest, platformName: string, userAgentName: string): BetaUpdateDownload | null {
  const platform = platformName.toLowerCase();
  const userAgent = userAgentName.toLowerCase();
  if (platform.includes("mac")) return manifest.downloads.macosArm64 ?? null;
  if (platform.includes("win") || userAgent.includes("windows")) return manifest.downloads.windowsX64 ?? null;
  return null;
}

export function downloadForCurrentPlatform(manifest: BetaUpdateManifest): BetaUpdateDownload | null {
  return downloadForPlatform(manifest, navigator.platform, navigator.userAgent);
}

export async function checkForBetaUpdate(): Promise<BetaUpdateState> {
  const url = manifestUrl();
  if (!url) return { status: "disabled" };

  try {
    const manifest = parseBetaUpdateManifest(await fetchManifest(url));
    if (compareVersions(manifest.version, CURRENT_APP_VERSION) <= 0) {
      return { status: "current" };
    }

    return {
      status: "available",
      manifest,
      download: downloadForCurrentPlatform(manifest),
    };
  } catch (error: unknown) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Update check failed",
    };
  }
}

export function dismissedUpdateKey(version: string): string {
  return `opennotion-dismissed-update-${version}`;
}
