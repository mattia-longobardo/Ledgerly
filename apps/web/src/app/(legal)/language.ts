import { LOCALES } from "@/platform/i18n/locales";

export type LegalLocale = (typeof LOCALES)[number];

/**
 * The language of a legal page: `?lang=` when it names a supported language, otherwise the
 * language of the request. A visitor without an account has no preference and no way to save one,
 * so the address itself has to be able to say which text it shows.
 */
export function legalLocale(lang: string | string[] | undefined, requestLocale: string): LegalLocale {
  const fallback = LOCALES.find((candidate) => candidate === requestLocale) ?? LOCALES[0];
  return LOCALES.find((candidate) => candidate === lang) ?? fallback;
}
