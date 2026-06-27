import { en } from "./locales/en";
import { it } from "./locales/it";

export type Locale = "en" | "it";
export type LocalePreference = "system" | "en" | "it";
export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string>;
export type TranslationDictionary = Record<TranslationKey, string>;

const dictionaries: Record<Locale, TranslationDictionary> = { en, it };

export function resolveLocale(
  preference: LocalePreference,
  navigatorLanguage: string | undefined,
): Locale {
  if (preference === "en" || preference === "it") return preference;
  return navigatorLanguage?.toLowerCase().startsWith("it") ? "it" : "en";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams,
  dictionaryOverride?: TranslationDictionary,
): string {
  const dictionary = dictionaryOverride ?? dictionaries[locale];
  const template = dictionary[key] || en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
}

export { en, it };
