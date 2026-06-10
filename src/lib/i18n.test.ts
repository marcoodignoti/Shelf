import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { it as itDict } from "./locales/it";
import { resolveLocale, translate } from "./i18n";

describe("translate", () => {
  it("returns the english string for en", () => {
    expect(translate("en", "settings.nav.preferences")).toBe("Preferences");
  });

  it("returns the italian string for it", () => {
    expect(translate("it", "settings.nav.preferences")).toBe("Preferenze");
  });

  it("interpolates {params}", () => {
    expect(translate("en", "settings.data.exported", { count: "3" })).toBe("Exported 3 pages.");
  });

  it("falls back to english when an it value is empty at runtime", () => {
    const broken = { ...itDict, "settings.nav.preferences": "" };
    expect(translate("it", "settings.nav.preferences", undefined, broken)).toBe("Preferences");
  });

  it("italian dictionary covers every english key", () => {
    for (const key of Object.keys(en)) {
      expect(itDict[key as keyof typeof en], `missing it key: ${key}`).toBeTruthy();
    }
  });
});

describe("resolveLocale", () => {
  it("passes through explicit locales", () => {
    expect(resolveLocale("en", "it-IT")).toBe("en");
    expect(resolveLocale("it", "en-US")).toBe("it");
  });

  it("resolves system from the navigator language", () => {
    expect(resolveLocale("system", "it-IT")).toBe("it");
    expect(resolveLocale("system", "it")).toBe("it");
    expect(resolveLocale("system", "en-US")).toBe("en");
    expect(resolveLocale("system", "de-DE")).toBe("en");
    expect(resolveLocale("system", undefined)).toBe("en");
  });
});
