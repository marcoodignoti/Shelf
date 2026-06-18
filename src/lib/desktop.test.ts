import { describe, expect, it, vi } from "vitest";
import { showCharacterPalette } from "./desktop";

describe("desktop bridge helpers", () => {
  it("opens the native character palette through a typed helper", async () => {
    const invoke = vi.fn(async () => null);
    (globalThis as { window: unknown }).window = {
      openNotion: {
        invoke,
      },
    };

    await showCharacterPalette();

    expect(invoke).toHaveBeenCalledWith("show_character_palette", undefined);
  });
});
