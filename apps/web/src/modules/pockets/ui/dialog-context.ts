"use client";

// What every dialog of Pockets shares: the pocket as `GET /pockets/{id}` answers it, what the page
// knows of the person, and the refusal said in their words.
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { pockets } from "@ledgerly/api-contract/pockets";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { monthKey, today } from "@ledgerly/format/dates";
import { type NumberFormat, numberStyle, type UiLocale } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import type { PocketResult } from "../calls";

export type PocketDetail = RouteOutput<typeof pockets.getPocket>["pocket"];

export interface DialogContext {
  numberFormat: NumberFormat;
  locale: UiLocale;
  today: string;
  thisMonth: string;
}

/** What the dialogs know of the person, once their preferences are read. */
export function useDialogContext(): DialogContext | undefined {
  const prefs = useApi(profile.getPreferences, {}).data;
  if (!prefs) return undefined;
  const todayOn = today(prefs.timeZone);
  return {
    numberFormat: numberStyle(prefs),
    locale: prefs.locale,
    today: todayOn,
    thisMonth: monthKey(todayOn),
  };
}

/** The refusals the dialogs name; anything else is «failed». */
const KNOWN = [
  "invalid",
  "not_found",
  "invalid_account",
  "duplicate_name",
  "archived",
  "future_date",
  "past_date",
  "backed",
  "not_expense",
  "already_linked",
] as const;

/** The line of a dialog's refusal: `report` keeps it and says whether the write went through. */
export function usePocketError() {
  const text = useTranslations("pockets");
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    report: (result: PocketResult) => {
      if (result.ok) return true;
      setError(text(`errors.${KNOWN.find((known) => known === result.error) ?? "failed"}`));
      return false;
    },
  };
}
