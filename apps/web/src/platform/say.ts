"use client";
// How the screens of Funds and Investments speak to the person (rewrite plan R3): their number format, language, time
// zone and today, from the preferences of `/api/v1`. The screens format with them and compute nothing.
import { profile } from "@ledgerly/api-contract/settings";
import { type CivilDate, today } from "@ledgerly/format/dates";
import { type NumberFormat, numberStyle, type UiLocale } from "@ledgerly/format/format";
import { type ApiState, useApi } from "@ledgerly/ui/data";

export interface Say {
  format: NumberFormat;
  locale: UiLocale;
  timeZone: string;
  todayOn: CivilDate;
  /** The currency totals across accounts are shown in: a new fund's, unless the form says otherwise. */
  currency: string;
}

/** The person's way of reading numbers and dates; `data` is undefined while it is read. */
export function useSay(): ApiState<Say> {
  const prefs = useApi(profile.getPreferences, {});
  const data = prefs.data && {
    format: numberStyle(prefs.data),
    locale: prefs.data.locale,
    timeZone: prefs.data.timeZone,
    todayOn: today(prefs.data.timeZone),
    currency: prefs.data.displayCurrency,
  };
  return { ...prefs, data };
}
