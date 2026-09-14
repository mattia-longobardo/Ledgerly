import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES } from "./locales";

/** The UI language comes from the locale cookie, which saving preferences keeps in sync. */
export default getRequestConfig(async () => {
  const requested = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = hasLocale(LOCALES, requested) ? requested : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: "Europe/Rome",
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
