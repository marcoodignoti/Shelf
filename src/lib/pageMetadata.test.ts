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
  it("keeps local inline cover sources", () => {
    expect(normalizeCoverUrl("  blob:shelf-cover  ")).toBe("blob:shelf-cover");
    expect(normalizeCoverUrl("  data:image/png;base64,abc  ")).toBe("data:image/png;base64,abc");
  });

  it("rejects remote cover URLs", () => {
    expect(normalizeCoverUrl("  https://example.com/cover.png  ")).toBeNull();
    expect(normalizeCoverUrl("http://example.com/cover.png")).toBeNull();
  });

  it("stores empty cover as null", () => {
    expect(normalizeCoverUrl("   ")).toBeNull();
  });
});
