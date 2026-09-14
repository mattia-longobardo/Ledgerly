// User-facing email copy, read from the next-intl message catalogues. The TTLs are never
// hard-coded here: callers pass the real value from their own source constant so the copy and
// the actual expiry can never drift apart.

import { createTranslator } from "next-intl";
import type { UiLocale } from "@/platform/format";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";

const CATALOGUES = { en, it } as const;

function translator(locale: UiLocale, namespace: "emails.invitation" | "emails.passwordReset") {
  return createTranslator({ locale, messages: CATALOGUES[locale], namespace });
}

export function invitationEmail(url: string, days: number, locale: UiLocale = "en") {
  const t = translator(locale, "emails.invitation");
  return { subject: t("subject"), text: t("body", { url, days }) };
}

export function passwordResetEmail(url: string, hours: number, locale: UiLocale = "en") {
  const t = translator(locale, "emails.passwordReset");
  return { subject: t("subject"), text: t("body", { url, hours }) };
}
