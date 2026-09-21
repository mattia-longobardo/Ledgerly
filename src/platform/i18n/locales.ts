import type { Ctx } from "@/platform/context";

export const LOCALES = ["en", "it"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
/** The time zone of pages seen before sign-in (the default preference). */
export const DEFAULT_TIME_ZONE = "Europe/Rome";

/**
 * The language and time zone a request renders in: the signed-in user's saved preferences,
 * otherwise the locale cookie that the last save left behind (anonymous pages such as sign-in).
 */
export function requestLocale(
  ctx: Pick<Ctx, "locale" | "timeZone"> | null,
  cookieLocale: string | undefined,
): { locale: (typeof LOCALES)[number]; timeZone: string } {
  if (ctx) return { locale: ctx.locale, timeZone: ctx.timeZone };
  const locale = LOCALES.find((candidate) => candidate === cookieLocale) ?? DEFAULT_LOCALE;
  return { locale, timeZone: DEFAULT_TIME_ZONE };
}
