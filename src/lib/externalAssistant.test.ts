import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  clampBoundsToBounds,
  defaultBoundsFor,
  isAllowedNavigation,
  nextProvider,
  parseAssistantState,
  validateWebviewAttachment,
  type ProviderId,
} from "./externalAssistant";

describe("PROVIDERS", () => {
  it("exposes chatgpt and gemini with https URLs and dedicated persistent partitions", () => {
    for (const provider of PROVIDERS) {
      expect(provider.url.startsWith("https://")).toBe(true);
      expect(provider.partition.startsWith("persist:external-assistant-")).toBe(true);
    }
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(["chatgpt", "gemini"]);
  });
});

describe("nextProvider", () => {
  it("cycles between the two providers", () => {
    expect(nextProvider("chatgpt")).toBe("gemini");
    expect(nextProvider("gemini")).toBe("chatgpt");
  });
});

describe("isAllowedNavigation", () => {
  it("allows the provider host and auth hosts over https only", () => {
    expect(isAllowedNavigation("chatgpt", "https://chatgpt.com/")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://chatgpt.com/c/abc")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://auth.openai.com/login")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://auth0.openai.com/")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://chat.openai.com/auth")).toBe(true);
    expect(isAllowedNavigation("gemini", "https://gemini.google.com/")).toBe(true);
    expect(isAllowedNavigation("gemini", "https://accounts.google.com/signin")).toBe(true);
  });

  it("rejects bare openai.com / google.com roots (generic links go to the system browser)", () => {
    expect(isAllowedNavigation("chatgpt", "https://openai.com/blog/x")).toBe(false);
    expect(isAllowedNavigation("gemini", "https://google.com/search")).toBe(false);
  });

  it("rejects http and non-allowlisted hosts", () => {
    expect(isAllowedNavigation("chatgpt", "http://chatgpt.com/")).toBe(false);
    expect(isAllowedNavigation("chatgpt", "https://evil.example.com/")).toBe(false);
    expect(isAllowedNavigation("gemini", "https://chatgpt.com/")).toBe(false);
  });

  it("rejects unknown providers", () => {
    expect(isAllowedNavigation("claude" as ProviderId, "https://chatgpt.com/")).toBe(false);
  });
});

describe("validateWebviewAttachment", () => {
  const ok = (overrides: Partial<Parameters<typeof validateWebviewAttachment>[0]>) =>
    validateWebviewAttachment({
      src: "https://chatgpt.com/",
      partition: "persist:external-assistant-chatgpt",
      preload: undefined,
      nodeIntegration: false,
      contextIsolation: true,
      providerId: "chatgpt",
      ...overrides,
    });

  it("accepts a well-formed chatgpt webview", () => {
    expect(ok({}).ok).toBe(true);
  });

  it("accepts a well-formed gemini webview", () => {
    expect(ok({
      src: "https://gemini.google.com/",
      partition: "persist:external-assistant-gemini",
      providerId: "gemini",
    }).ok).toBe(true);
  });

  it("rejects a non-allowlisted src", () => {
    const result = ok({ src: "https://evil.example.com/" });
    expect(result.ok).toBe(false);
  });

  it("rejects the wrong partition for the provider", () => {
    const result = ok({ providerId: "chatgpt", partition: "persist:external-assistant-gemini" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-persistent or unknown partition", () => {
    expect(ok({ partition: "default" }).ok).toBe(false);
    expect(ok({ partition: "persist:something-else" }).ok).toBe(false);
  });

  it("rejects any preload", () => {
    const result = ok({ preload: "file:///etc/passwd" });
    expect(result.ok).toBe(false);
  });

  it("rejects node integration enabled", () => {
    const result = ok({ nodeIntegration: true });
    expect(result.ok).toBe(false);
  });

  it("rejects context isolation disabled", () => {
    const result = ok({ contextIsolation: false });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown provider id", () => {
    const result = ok({ providerId: "claude" as ProviderId });
    expect(result.ok).toBe(false);
  });
});

describe("parseAssistantState", () => {
  it("returns null for invalid input", () => {
    expect(parseAssistantState(null)).toBeNull();
    expect(parseAssistantState("not json")).toBeNull();
    expect(parseAssistantState("{}")).toBeNull();
  });

  it("parses a well-formed state", () => {
    const json = JSON.stringify({
      x: 10, y: 20, width: 420, height: 640, provider: "gemini",
      lastOpenedAt: "2026-06-20T10:00:00Z",
    });
    const state = parseAssistantState(json);
    expect(state).toEqual({
      x: 10, y: 20, width: 420, height: 640, provider: "gemini",
      lastOpenedAt: "2026-06-20T10:00:00Z",
    });
  });

  it("normalizes an unknown provider to the default (chatgpt)", () => {
    // A full valid state except for the provider field (which is unknown),
    // so the parser reaches provider-normalization rather than rejecting.
    const json = JSON.stringify({ x: 0, y: 0, width: 420, height: 640, provider: "claude", lastOpenedAt: "2026-06-20T10:00:00Z" });
    expect(parseAssistantState(json)?.provider).toBe("chatgpt");
  });
});

describe("clampBoundsToBounds", () => {
  const container = { left: 0, top: 0, width: 1000, height: 800 };

  it("leaves in-bounds bounds untouched", () => {
    expect(clampBoundsToBounds({ x: 100, y: 100, width: 420, height: 640 }, container))
      .toEqual({ x: 100, y: 100, width: 420, height: 640 });
  });

  it("clamps so the titlebar stays reachable inside the container", () => {
    // Moved completely off the right edge.
    const clamped = clampBoundsToBounds({ x: 2000, y: 100, width: 420, height: 640 }, container);
    expect(clamped.x).toBeLessThanOrEqual(container.width - 80);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
  });

  it("clamps a too-large width down to the container width", () => {
    const clamped = clampBoundsToBounds({ x: 0, y: 0, width: 5000, height: 640 }, container);
    expect(clamped.width).toBe(container.width);
  });
});

describe("defaultBoundsFor", () => {
  it("anchors the popover to the bottom-right with a 16px margin", () => {
    const bounds = defaultBoundsFor({ left: 0, top: 0, width: 1280, height: 860 });
    expect(bounds.width).toBe(420);
    expect(bounds.height).toBe(640);
    // 16px margin from the bottom-right corner.
    expect(bounds.x).toBe(1280 - 420 - 16);
    expect(bounds.y).toBe(860 - 640 - 16);
  });
});
