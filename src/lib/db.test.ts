import { describe, expect, it } from "vitest";
import { coverImageSrc } from "./db";

describe("coverImageSrc", () => {
  it("does not render remote cover URLs", () => {
    expect(coverImageSrc("https://tracker.example/pixel.png")).toBe("");
    expect(coverImageSrc("http://tracker.example/pixel.png")).toBe("");
  });

  it("keeps local inline cover sources", () => {
    expect(coverImageSrc("blob:shelf-cover")).toBe("blob:shelf-cover");
    expect(coverImageSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });
});
