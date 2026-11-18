// The words of a fee row (release N6, screens §7.1), shared by the list, the summary of the form
// that creates a fund and Settings. Pure: the translator comes from the caller.
import type { useTranslations } from "next-intl";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { isCivilDate } from "@ledgerly/domain/shared/dates";
import {
  formatDate,
  formatMoney,
  formatPercent,
  type NumberFormat,
  type UiLocale,
} from "@ledgerly/domain/platform/format";
import { feeModes, needsPeriod } from "@ledgerly/domain/funds/client";
import { type FeeForm, fractionOfPercent } from "@ledgerly/domain/funds/client";

type FeesT = ReturnType<typeof useTranslations<"funds.fees">>;

/** One choice of "Applies to": a source, or a component of a payslip source. */
export interface FeeScopeOption {
  value: string;
  label: string;
}

/** The form a fee really takes: a basis with one form only wins over what the field held. */
export function feeModeOf(fee: Pick<FeeForm, "basis" | "mode">): "amount" | "rate" {
  const modes = feeModes(fee.basis);
  return modes.includes(fee.mode) ? fee.mode : modes[0];
}

/** "0,45 %" from what the person wrote, with the decimals they wrote; the text itself when it is not a percentage. */
function rateText(value: string, format: NumberFormat): string {
  try {
    const fraction = fractionOfPercent(value, format);
    const written = (fraction.split(".")[1] ?? "").replace(/0+$/, "").length;
    return formatPercent(Number(fraction), format, { decimals: Math.min(4, Math.max(0, written - 2)) });
  } catch {
    return `${value.trim()} %`;
  }
}

function amountText(value: string, format: NumberFormat, currency: string): string {
  try {
    return formatMoney(parseAmount(value, format), format, { currency });
  } catch {
    return value.trim();
  }
}

/** "12,00 € a year", "1,50 € per contribution", "0,45 % a year", "10,00 € once". */
export function feeAmountText(t: FeesT, fee: FeeForm, format: NumberFormat, currency: string): string {
  const mode = feeModeOf(fee);
  const amount = amountText(fee.value, format, currency);
  const rate = rateText(fee.value, format);
  if (fee.basis === "one_off") return t("amountOnce", { amount });
  if (fee.basis === "per_request") return t("amountOnRequest", { amount });
  if (needsPeriod(fee.basis)) {
    return mode === "rate"
      ? t("ratePer", { rate, period: fee.period })
      : t("amountPer", { amount, period: fee.period });
  }
  return mode === "rate" ? t("rateEach", { rate }) : t("amountEach", { amount });
}

/** "from 1 Jan 2026", "to 31 Dec 2025", both, or nothing. */
export function feeValidityText(t: FeesT, fee: FeeForm, locale: UiLocale): string {
  const parts: string[] = [];
  if (isCivilDate(fee.validFrom)) parts.push(t("from", { date: formatDate(fee.validFrom, "long", locale) }));
  if (isCivilDate(fee.validTo)) parts.push(t("to", { date: formatDate(fee.validTo, "long", locale) }));
  return parts.join(" · ");
}

/** What a fee applies to, in words: "Everything" for a fee on assets and for a scope no longer there. */
export function feeScopeText(t: FeesT, fee: FeeForm, scopes: readonly FeeScopeOption[]): string {
  if (fee.basis === "on_assets" || fee.scope === "") return t("scope.all");
  return scopes.find((scope) => scope.value === fee.scope)?.label ?? t("scope.all");
}

/** A message of `funds.fees.errors`, by the field it belongs under. */
export type FeeProblems = Partial<
  Record<"label" | "value" | "validTo", "label" | "value" | "rate" | "validity">
>;

/** What is wrong in a fee's fields before it is saved: the same limits the service holds. */
export function feeProblems(fee: FeeForm, format: NumberFormat): FeeProblems {
  const problems: FeeProblems = {};
  if (fee.label.trim() === "") problems.label = "label";
  if (feeModeOf(fee) === "rate") {
    try {
      fractionOfPercent(fee.value, format);
    } catch {
      problems.value = "rate";
    }
  } else {
    try {
      if (parseAmount(fee.value, format) <= 0n) problems.value = "value";
    } catch {
      problems.value = "value";
    }
  }
  if (fee.validFrom !== "" && fee.validTo !== "" && fee.validTo < fee.validFrom)
    problems.validTo = "validity";
  return problems;
}

/** A fee as it is kept: the form its basis takes, no scope for a fee on assets. */
export const cleanFee = (fee: FeeForm): FeeForm => ({
  ...fee,
  label: fee.label.trim(),
  mode: feeModeOf(fee),
  scope: fee.basis === "on_assets" ? "" : fee.scope,
});
