import { describe, expect, it } from "vitest";
import { normalizeCoverUrl, normalizePageIcon } from "./pageMetadata";

describe("normalizePageIcon", () => {
  it("trims and keeps one icon grapheme", () => {
    expect(normalizePageIcon("  🚀 launching  ")).toBe("🚀");
    expect(normalizePageIcon("  🤖🤖  ")).toBe("🤖");
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
