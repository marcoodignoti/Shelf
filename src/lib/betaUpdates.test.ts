import { describe, expect, it } from "vitest";
import {
  compareVersions,
  downloadForPlatform,
  parseBetaUpdateManifest,
} from "./betaUpdates";

describe("beta update manifest", () => {
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
        macosArm64: { url: "https://example.com/OpenNotion.dmg", label: "macOS Apple Silicon", size: "120 MB" },
        windowsX64: { url: "https://example.com/OpenNotion.zip", label: "Windows x64" },
        ignored: { url: "http://example.com/bad.zip", label: "Bad" },
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
        windowsX64: { url: "https://example.com/OpenNotion.zip", label: "Windows x64" },
      },
    });

    expect(downloadForPlatform(manifest, "Win32", "Windows")?.label).toBe("Windows x64");
  });
});
