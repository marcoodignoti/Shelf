import { describe, expect, it } from "vitest";
import {
  PREFERENCE_STORAGE_KEYS,
  parseEditorFont,
  parseEditorFontSize,
  parseLocalePreference,
  parsePageWidth,
  parseTitleEnterBehavior,
} from "./preferences";

describe("preferences parsing", () => {
  it("accepts valid values", () => {
    expect(parseEditorFont("serif")).toBe("serif");
    expect(parseEditorFontSize("large")).toBe("large");
    expect(parsePageWidth("full")).toBe("full");
    expect(parseTitleEnterBehavior("newline")).toBe("newline");
    expect(parseLocalePreference("it")).toBe("it");
  });

  it("falls back to defaults on unknown or null input", () => {
    expect(parseEditorFont("comic-sans")).toBe("sans");
    expect(parseEditorFont(null)).toBe("sans");
    expect(parseEditorFontSize("xl")).toBe("default");
    expect(parsePageWidth("")).toBe("centered");
    expect(parseTitleEnterBehavior(undefined)).toBe("body");
    expect(parseLocalePreference("fr")).toBe("system");
  });

  it("exposes stable storage keys", () => {
    expect(PREFERENCE_STORAGE_KEYS.locale).toBe("opennotion-locale");
    expect(PREFERENCE_STORAGE_KEYS.editorFont).toBe("shelf-editor-font");
    expect(PREFERENCE_STORAGE_KEYS.editorFontSize).toBe("shelf-editor-font-size");
    expect(PREFERENCE_STORAGE_KEYS.pageWidth).toBe("opennotion-page-width");
    expect(PREFERENCE_STORAGE_KEYS.titleEnter).toBe("opennotion-title-enter");
  });
});
