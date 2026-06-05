import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  downloadForPlatform,
  checkForBetaUpdate,
  downloadVerifiedUpdate,
  parseBetaUpdateManifest,
} from "./betaUpdates";

const VALID_SHA = "a".repeat(64);
const VALID_MAC_URL = "https://github.com/marcoodignoti/OpenNotion/releases/download/v99.0.0/OpenNotion_99.0.0_arm64.dmg";
const VALID_WIN_URL = "https://github.com/marcoodignoti/OpenNotion/releases/download/v99.0.0/OpenNotion_99.0.0_win-x64.zip";

describe("beta update manifest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("compares numeric release versions", () => {
    expect(compareVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("v0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0")).toBe(0);
  });

  it("parses a compact HTTPS manifest and limits changes", () => {
    const manifest = parseBetaUpdateManifest({
      version: "0.1.1",
      channel: "beta",
      publishedAt: "2026-06-04T00:00:00.000Z",
      title: "OpenNotion 0.1.1",
      summary: "Studio links and update flow.",
      changes: ["Studio bookmarks", "Shared search", "Inline page links", "Slash search", "Update notice", "Hidden"],
      downloads: {
        macosArm64: { url: VALID_MAC_URL, label: "macOS Apple Silicon", sha256: VALID_SHA, size: "120 MB" },
        windowsX64: { url: VALID_WIN_URL, label: "Windows x64", sha256: VALID_SHA },
        ignored: { url: "http://example.com/bad.zip", label: "Bad", sha256: VALID_SHA },
      },
    });

    expect(manifest.changes).toEqual([
      "Studio bookmarks",
      "Shared search",
      "Inline page links",
      "Slash search",
      "Update notice",
    ]);
    expect(manifest.downloads.macosArm64?.size).toBe("120 MB");
    expect(manifest.downloads.windowsX64?.label).toBe("Windows x64");
    expect(manifest.downloads.windowsX64?.sha256).toBe(VALID_SHA);
  });

  it("drops downloads without trusted host or checksum", () => {
    const manifest = parseBetaUpdateManifest({
      version: "0.1.1",
      channel: "beta",
      publishedAt: "2026-06-04T00:00:00.000Z",
      title: "OpenNotion 0.1.1",
      summary: "Bad downloads.",
      downloads: {
        macosArm64: { url: "https://example.com/OpenNotion.dmg", label: "macOS Apple Silicon", sha256: VALID_SHA },
        windowsX64: { url: VALID_WIN_URL, label: "Windows x64", sha256: "bad" },
      },
    });

    expect(manifest.downloads.macosArm64).toBeUndefined();
    expect(manifest.downloads.windowsX64).toBeUndefined();
  });

  it("rejects invalid channels", () => {
    expect(() => parseBetaUpdateManifest({
      version: "0.1.1",
      channel: "nightly",
      publishedAt: "2026-06-04T00:00:00.000Z",
      title: "OpenNotion 0.1.1",
      summary: "Invalid channel.",
      downloads: {},
    })).toThrow("Invalid update manifest channel");
  });

  it("selects the current platform download", () => {
    const manifest = parseBetaUpdateManifest({
      version: "0.1.1",
      channel: "beta",
      publishedAt: "2026-06-04T00:00:00.000Z",
      title: "OpenNotion 0.1.1",
      summary: "Windows test.",
      downloads: {
        windowsX64: { url: VALID_WIN_URL, label: "Windows x64", sha256: VALID_SHA },
      },
    });

    expect(downloadForPlatform(manifest, "Win32", "Windows")?.label).toBe("Windows x64");
  });

  it("downloads updates through the desktop verifier", async () => {
    const invoke = vi.fn(async () => ({ path: "/tmp/OpenNotion.dmg", bytes: 7, sha256: VALID_SHA }));
    vi.stubGlobal("window", { openNotion: { invoke } });

    await expect(downloadVerifiedUpdate({
      url: VALID_MAC_URL,
      label: "macOS Apple Silicon",
      sha256: VALID_SHA,
    })).resolves.toEqual({ path: "/tmp/OpenNotion.dmg", bytes: 7, sha256: VALID_SHA });
    expect(invoke).toHaveBeenCalledWith("download_update_artifact", {
      url: VALID_MAC_URL,
      sha256: VALID_SHA,
    });
  });

  it("falls back to the legacy manifest URL when the beta channel URL is unavailable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/releases/download/beta/")) {
        return { ok: false, status: 404 };
      }

      return {
        ok: true,
        json: async () => ({
          version: "99.0.0",
          channel: "beta",
          publishedAt: "2026-06-04T00:00:00.000Z",
          title: "OpenNotion 99.0.0",
          summary: "Fallback test.",
          downloads: {
            macosArm64: { url: VALID_MAC_URL, label: "macOS Apple Silicon", sha256: VALID_SHA },
          },
        }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "macOS" });

    await expect(checkForBetaUpdate()).resolves.toMatchObject({
      status: "available",
      manifest: { version: "99.0.0" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the newest valid manifest when the beta channel is stale", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        version: url.includes("/releases/download/beta/") ? "0.1.0" : "99.0.0",
        channel: "beta",
        publishedAt: "2026-06-04T00:00:00.000Z",
        title: "OpenNotion",
        summary: "Newest manifest test.",
        downloads: {
          macosArm64: { url: VALID_MAC_URL, label: "macOS Apple Silicon", sha256: VALID_SHA },
        },
      }),
    }));

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "macOS" });

    await expect(checkForBetaUpdate()).resolves.toMatchObject({
      status: "available",
      manifest: { version: "99.0.0" },
    });
  });
});
