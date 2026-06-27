import { useCallback } from "react";
import { useUIStore } from "../store/useUIStore";
import {
  resolveLocale as resolveLocaleCore,
  translate as translateCore,
  type Locale,
  type LocalePreference as SharedLocalePreference,
  type TranslationKey,
  type TranslationParams,
} from "@shelf/shared";

// Re-export everything consumers currently import from this module so existing
// imports keep resolving unchanged. The pure core (locale resolution,
// dictionaries, lookup + interpolation) now lives in @shelf/shared; only the
// React hooks (`useLocale`, `useT`) stay here, since shared code must remain
// framework-free.
export {
  resolveLocaleCore as resolveLocale,
  translateCore as translate,
  type Locale,
  type TranslationKey,
  type TranslationParams,
};

export type { LocalePreference } from "./preferences";

// Re-export the dictionaries so any consumer that imported them transitively
// can still reach them.
export { en, it } from "@shelf/shared";

export function useLocale(): Locale {
  const preference = useUIStore((state) => state.localePreference);
  return resolveLocaleCore(
    preference as SharedLocalePreference,
    typeof navigator !== "undefined" ? navigator.language : undefined,
  );
}

export function useT(): (key: TranslationKey, params?: TranslationParams) => string {
  const locale = useLocale();
  return useCallback(
    (key: TranslationKey, params?: TranslationParams) => translateCore(locale, key, params),
    [locale],
  );
}
