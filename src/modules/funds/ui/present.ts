import { formatAmountInput, formatDate, type NumberFormat, type UiLocale } from "@/platform/format";
import { fractionToPercent } from "@/modules/interests/rules";
import type { MonthStatus, ValuationRow } from "../queries";
import type { Fund, FundDeposit } from "../service";
import type { DepositDraft, FundDraft, ValuationDraft } from "./fund-forms";

/** The two kinds of fund the design's "Fund kind" offers (`funds.type`). */
export type FundKind = "pac" | "pension";

/** Every field a fund form can hold; the kind decides which of them are actually shown. */
export type FundField =
  | "name"
  | "provider"
  | "compartment"
  | "kind"
  | "start"
  | "isin"
  | "monthly"
  | "fee"
  | "debit"
  | "day"
  | "ter"
  | "valuation"
  | "initial";

const BOTH_KINDS: readonly FundField[] = ["name", "provider", "compartment", "kind", "start"];
const PAC_ONLY: readonly FundField[] = [
  "isin",
  "monthly",
  "fee",
  "debit",
  "day",
  "ter",
  "valuation",
  "initial",
];

/**
 * Which fields the design's one "New fund" form shows for a kind: a PAC has a plan of its own —
 * what it buys, how much is debited each month, the fee and the account it is taken from — while a
 * pension fund is fed by the payslips and by the fund's own documents, so it only says who runs it
 * and since when. A field the kind does not own is not rendered at all, so it is never submitted
 * rather than submitted and ignored.
 */
export function fundFormFields(kind: FundKind): ReadonlySet<FundField> {
  return new Set(kind === "pac" ? [...BOTH_KINDS, ...PAC_ONLY] : BOTH_KINDS);
}

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

/** A recorded valuation as the "Edit" dialog starts from it. */
export function valuationDraft(row: ValuationRow, format: NumberFormat): ValuationDraft {
  return {
    id: row.id,
    on: row.on,
    value: formatAmountInput(row.valueCents, format),
    note: row.note ?? "",
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
