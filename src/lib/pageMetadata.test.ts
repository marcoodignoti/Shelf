import { describe, expect, it } from "vitest";
import { normalizeCoverUrl, normalizePageIcon } from "./pageMetadata";

describe("normalizePageIcon", () => {
  it("trims and limits icon text", () => {
    expect(normalizePageIcon("  🚀 launching  ")).toBe("🚀 launch");
  });

  it("stores empty icon as null", () => {
    expect(normalizePageIcon("   ")).toBeNull();
  });
});

describe("normalizeCoverUrl", () => {
  it("trims cover URL", () => {
    expect(normalizeCoverUrl("  https://example.com/cover.png  ")).toBe("https://example.com/cover.png");
  });

  it("stores empty cover as null", () => {
    expect(normalizeCoverUrl("   ")).toBeNull();
  });
});
