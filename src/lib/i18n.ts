import { en } from "./locales/en";
import { it } from "./locales/it";
import type { LocalePreference } from "./preferences";
import { useAppStore } from "../store/useAppStore";

export type Locale = "en" | "it";
export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string>;

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, it };

export function resolveLocale(preference: LocalePreference, navigatorLanguage: string | undefined): Locale {
  if (preference === "en" || preference === "it") return preference;
  return navigatorLanguage?.toLowerCase().startsWith("it") ? "it" : "en";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams,
  dictionaryOverride?: Record<TranslationKey, string>,
): string {
  const dictionary = dictionaryOverride ?? dictionaries[locale];
  const template = dictionary[key] || en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
}

export function useLocale(): Locale {
  const preference = useAppStore((state) => state.localePreference);
  return resolveLocale(preference, typeof navigator !== "undefined" ? navigator.language : undefined);
}

export function useT(): (key: TranslationKey, params?: TranslationParams) => string {
  const locale = useLocale();
  return (key, params) => translate(locale, key, params);
}
