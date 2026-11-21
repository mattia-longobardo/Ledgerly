"use client";

// What the Interests screens know of the person, from `/api/v1`: the number style, the language and
// the day; `undefined` until the preferences are in.
import { useTranslations } from "next-intl";
import { profile } from "@ledgerly/api-contract/settings";
import { parseCents } from "@ledgerly/format/cents";
import { today } from "@ledgerly/format/dates";
import { formatMoney, type NumberFormat, numberStyle, type UiLocale } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import { type Rule, tierChips } from "./present";

export interface Format {
  numberFormat: NumberFormat;
  locale: UiLocale;
  timeZone: string;
  today: string;
  /** An amount of the wire, formatted; null stays the empty mark. */
  money: (amount: string | null) => string;
}

export function useFormat(): Format | undefined {
  const prefs = useApi(profile.getPreferences, {}).data;
  if (!prefs) return undefined;
  const numberFormat = numberStyle(prefs);
  return {
    numberFormat,
    locale: prefs.locale,
    timeZone: prefs.timeZone,
    today: today(prefs.timeZone),
    money: (amount) => formatMoney(amount === null ? null : parseCents(amount), numberFormat),
  };
}

/** A rule's tiers as the design's chips, with their labels. */
export function useTierChips(tiers: Rule["tiers"], format: NumberFormat) {
  const text = useTranslations("interests");
  return tierChips(tiers, format, {
    upTo: (amount) => text("tier.upTo", { amount }),
    to: (amount) => text("tier.to", { amount }),
    above: text("tier.above"),
    any: text("tier.any"),
  });
}
