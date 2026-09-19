import { formatAmountInput, formatDate, type NumberFormat, type UiLocale } from "@/platform/format";
import { fractionToPercent } from "@/modules/interests/rules";
import type { MonthStatus } from "../queries";
import type { Fund, FundDeposit } from "../service";
import type { DepositDraft, FundDraft } from "./fund-forms";

/** A fund as the settings form starts from it. */
export function fundDraft(fund: Fund, format: NumberFormat): FundDraft {
  const ter = fund.ter === null ? "" : fractionToPercent(fund.ter);
  return {
    name: fund.name,
    provider: fund.provider ?? "",
    isin: fund.isin ?? "",
    compartment: fund.compartment ?? "",
    debitAccountId: fund.debitAccountId ?? "",
    debitDay: fund.debitDay === null ? "" : String(fund.debitDay),
    ter: format === "en-US" ? ter : ter.replace(".", ","),
    startOn: fund.startOn,
    monthly: formatAmountInput(fund.monthlyCents, format),
    fee: formatAmountInput(fund.depositFeeCents, format),
  };
}

/** A new fund: starts today, charged on the 1st. */
export function newFundDraft(today: string): FundDraft {
  return {
    name: "",
    provider: "",
    isin: "",
    compartment: "",
    debitAccountId: "",
    debitDay: "1",
    ter: "",
    startOn: today,
    monthly: "",
    fee: "",
  };
}

/** The next deposit as the inline card proposes it: today, the plan's amount and fee. */
export function newDepositDraft(fund: Fund, today: string, format: NumberFormat): DepositDraft {
  return {
    id: null,
    on: today,
    debited: formatAmountInput(fund.monthlyCents, format),
    fee: formatAmountInput(fund.depositFeeCents, format),
    note: "",
  };
}

export function depositDraft(deposit: FundDeposit, format: NumberFormat): DepositDraft {
  return {
    id: deposit.id,
    on: deposit.on,
    debited: formatAmountInput(deposit.chargedCents, format),
    fee: formatAmountInput(deposit.feeCents, format),
    note: deposit.note ?? "",
  };
}

/** The design's "This month" pill: text and tone. */
export function monthPill(
  status: MonthStatus,
  locale: UiLocale,
  labels: { found: (date: string) => string; awaited: string; missing: string; none: string },
): { text: string; tone: "pos" | "neg" | "muted" } {
  switch (status.kind) {
    case "found":
      return { text: labels.found(formatDate(status.on, "dayMonth", locale)), tone: "pos" };
    case "awaited":
      return { text: labels.awaited, tone: "muted" };
    case "missing":
      return { text: labels.missing, tone: "neg" };
    case "none":
      return { text: labels.none, tone: "muted" };
  }
}
