// The calls of the Profile forms to `/api/v1` (rewrite plan R3): each answers `{ ok }` or a catalogued
// error key, as the Server Actions they replace did, so a form reads one shape whatever sent it.
import { profile } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import { browserPreferences } from "@ledgerly/ui/preferences";

type CallResult = { ok: true } | { ok: false; error: string };

/** A refusal the form names; anything else is thrown, and the form says the save failed. */
function refused(error: unknown, codes: Record<string, string>): CallResult {
  if (error instanceof ApiError && codes[error.reason ?? error.code]) {
    return { ok: false, error: codes[error.reason ?? error.code] };
  }
  throw error;
}

/** When the identity provider manages the name: the API refuses it (`conflict`, `sso`). */
export async function updateNameAction(name: string): Promise<CallResult> {
  try {
    await call(profile.updateProfile, { body: { name } });
  } catch (error) {
    return refused(error, { sso: "sso", invalid: "invalid" });
  }
  invalidate(profile.getProfile);
  return { ok: true };
}

/**
 * The Profile form's fields only: the working day and the patron saint are Time off's, and the
 * default range is not on any form. The language and the theme are also kept on the
 * device (`browserPreferences`) for the pages without a session (sign-in), as the Server Action did.
 */
export async function savePreferencesAction(input: {
  timeZone: string;
  locale: "en" | "it";
  numberFormat: "it-IT" | "en-US" | "fr-FR";
  decimalSeparator: "." | "," | null;
  currencyPosition: "before" | "after" | null;
  displayCurrency: string;
  weekStart: 0 | 1;
  theme: "system" | "light" | "dark";
  monthlySummary: boolean;
}): Promise<CallResult> {
  const { timeZone, locale, numberFormat, decimalSeparator, currencyPosition } = input;
  const { displayCurrency, weekStart, theme, monthlySummary } = input;
  try {
    const body = { timeZone, locale, numberFormat, decimalSeparator, currencyPosition };
    const saved = await call(profile.updatePreferences, {
      body: { ...body, displayCurrency, weekStart, theme, monthlySummary },
    });
    browserPreferences.write("locale", saved.locale);
    browserPreferences.write("theme", saved.theme);
  } catch (error) {
    return refused(error, { invalid: "invalid" });
  }
  invalidate(profile.getPreferences);
  return { ok: true };
}
