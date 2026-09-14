import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { getOptionalCtx } from "@/platform/auth/session";
import { LOCALE_COOKIE, requestLocale } from "./locales";

export default getRequestConfig(async () => {
  const { locale, timeZone } = requestLocale(
    await getOptionalCtx(),
    (await cookies()).get(LOCALE_COOKIE)?.value,
  );
  return { locale, timeZone, messages: (await import(`../../../messages/${locale}.json`)).default };
});
