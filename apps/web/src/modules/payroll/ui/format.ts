"use client";

// What the Payroll screens know of the person, from `/api/v1`: the number style, the language and
// the time zone; `undefined` until the preferences are in.
import { profile } from "@ledgerly/api-contract/settings";
import { numberStyle } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import type { Format } from "./present";

export function usePayrollFormat(): Format | undefined {
  const prefs = useApi(profile.getPreferences, {}).data;
  if (!prefs) return undefined;
  return { numberFormat: numberStyle(prefs), locale: prefs.locale, timeZone: prefs.timeZone };
}
