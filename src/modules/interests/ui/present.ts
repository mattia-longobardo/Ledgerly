import { formatAmountInput, formatMoney, type NumberFormat } from "@/platform/format";
import type { RuleRow } from "../queries";
import { fractionToPercent, type Tier } from "../rules";
import type { RuleDraft } from "./rule-dialog";

/** A stored rate as the design writes it: "2,75 %" in Italian, "2.75%" in English. */
export function formatRate(fraction: string, format: NumberFormat): string {
  const plain = fractionToPercent(fraction);
  return format === "en-US" ? `${plain}%` : `${plain.replace(".", ",")} %`;
}

/** A stored rate as the person would type it back into the dialog. */
export function rateInput(fraction: string, format: NumberFormat): string {
  const plain = fractionToPercent(fraction);
  return format === "en-US" ? plain : plain.replace(".", ",");
}

/** The design's tier chips: "2,75 % up to 20.000 €", "1,50 % above", or "any balance". */
export function tierChips(
  tiers: readonly Tier[],
  format: NumberFormat,
  labels: { upTo: (amount: string) => string; to: (amount: string) => string; above: string; any: string },
): { rate: string; range: string }[] {
  return tiers.map((tier, index) => ({
    rate: formatRate(tier.annualRate, format),
    range:
      tier.upToCents === null
        ? tiers.length === 1
          ? labels.any
          : labels.above
        : (index === 0 ? labels.upTo : labels.to)(formatMoney(tier.upToCents, format, { decimals: false })),
  }));
}

/** The dialog's starting point for an existing rule. */
export function draftOf(
  row: Pick<RuleRow, "rule" | "tiers" | "accountName">,
  format: NumberFormat,
): RuleDraft {
  const { rule } = row;
  return {
    id: rule.id,
    accountId: rule.accountId,
    accountName: row.accountName,
    validFrom: rule.validFrom,
    validTo: rule.validTo ?? "",
    runHour: rule.runHour === null ? "" : String(rule.runHour),
    tiers: row.tiers.map((tier) => ({
      upTo: formatAmountInput(tier.upToCents, format),
      rate: rateInput(tier.annualRate, format),
    })),
    tax: rateInput(rule.taxRate, format),
    dayBasis: rule.dayBasis,
    settlement: rule.settlement,
    payeeMatch: rule.payeeMatch ?? "",
    publish: rule.mode === "post_to_provider",
    categoryId: rule.postingCategoryId,
    active: rule.state === "active",
  };
}

/** A new rule: the first open account, today, the default hour, one tier, 26 % tax, monthly, active. */
export function newDraft(accounts: readonly { id: string; name: string }[], today: string): RuleDraft {
  return {
    id: null,
    accountId: accounts[0]?.id ?? "",
    accountName: accounts[0]?.name ?? "",
    validFrom: today,
    validTo: "",
    runHour: "",
    tiers: [{ upTo: "", rate: "" }],
    tax: "26",
    dayBasis: "365",
    settlement: "monthly",
    payeeMatch: "",
    publish: false,
    categoryId: null,
    active: true,
  };
}
