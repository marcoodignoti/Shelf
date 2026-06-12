import packageJson from "../../package.json";

export const CURRENT_APP_VERSION = packageJson.version;
export const BETA_CHANNEL_MANIFEST_URL =
  "https://github.com/marcoodignoti/Shelf/releases/download/beta/beta-update.json";
export const LATEST_RELEASE_MANIFEST_URL =
  "https://github.com/marcoodignoti/Shelf/releases/latest/download/beta-update.json";
export const DEFAULT_UPDATE_MANIFEST_URLS = [
  LATEST_RELEASE_MANIFEST_URL,
  BETA_CHANNEL_MANIFEST_URL,
];

export type BetaUpdateDownload = {
  url: string;
  label: string;
  sha256: string;
  size?: string;
};

export type VerifiedUpdateDownload = {
  path: string;
  bytes: number;
  sha256: string;
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
    windowsInstallerX64?: BetaUpdateDownload;
  };
};

export type BetaUpdateState =
  | { status: "idle" | "checking" | "current" | "disabled" }
  | { status: "available"; manifest: BetaUpdateManifest; download: BetaUpdateDownload | null }
  | { status: "error"; message: string };

const MAX_CHANGE_ITEMS = 5;
const DOWNLOAD_URL_PATTERN =
  /^https:\/\/github\.com\/marcoodignoti\/Shelf\/releases\/download\/[^/]+\/Shelf_[^/]+\.(dmg|zip|exe)$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function manifestUrls(): string[] {
  const configuredUrl = import.meta.env.VITE_SHELF_UPDATE_MANIFEST_URL || import.meta.env.VITE_OPENNOTION_UPDATE_MANIFEST_URL;
  if (configuredUrl) return [configuredUrl];
  return DEFAULT_UPDATE_MANIFEST_URLS;
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
  if (!isString(record.url) || !DOWNLOAD_URL_PATTERN.test(record.url)) return undefined;
  if (!isString(record.label)) return undefined;
  if (!isString(record.sha256) || !SHA256_PATTERN.test(record.sha256)) return undefined;

  return {
    url: record.url,
    label: record.label,
    sha256: record.sha256.toLowerCase(),
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
      windowsInstallerX64: parseDownload(downloads.windowsInstallerX64),
    },
  };
}

export function downloadForPlatform(manifest: BetaUpdateManifest, platformName: string, userAgentName: string): BetaUpdateDownload | null {
  const platform = platformName.toLowerCase();
  const userAgent = userAgentName.toLowerCase();
  if (platform.includes("mac")) return manifest.downloads.macosArm64 ?? null;
  if (platform.includes("win") || userAgent.includes("windows")) {
    return manifest.downloads.windowsInstallerX64 ?? manifest.downloads.windowsX64 ?? null;
  }
  return null;
}

export function downloadForCurrentPlatform(manifest: BetaUpdateManifest): BetaUpdateDownload | null {
  return downloadForPlatform(manifest, navigator.platform, navigator.userAgent);
}

export async function downloadVerifiedUpdate(download: BetaUpdateDownload): Promise<VerifiedUpdateDownload> {
  if (typeof window === "undefined" || !window.openNotion) {
    throw new Error("Shelf desktop bridge is not available");
  }

  return await window.openNotion.invoke<VerifiedUpdateDownload>("download_update_artifact", {
    url: download.url,
    sha256: download.sha256,
  });
}

export async function checkForBetaUpdate(): Promise<BetaUpdateState> {
  const urls = manifestUrls().filter((url) => url.trim().length > 0);
  if (urls.length === 0) return { status: "disabled" };

  let lastError: unknown = null;
  try {
    for (const url of urls) {
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
        lastError = error;
      }
    }

    throw lastError ?? new Error("Update check failed");
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
