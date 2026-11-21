// How Interests writes the fields of `GET /interests` (rewrite plan R3): rates arrive as plain
// percentages ("2.75") and amounts as decimal strings; this file only formats them.
import type { interests } from "@ledgerly/api-contract/interests";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatAmountInput, formatMoney, type NumberFormat, numberSeparators } from "@ledgerly/format/format";
import { countryRule } from "@ledgerly/domain/shared/country";
import type { RuleDraft } from "./rule-dialog";

export type Rule = RouteOutput<typeof interests.listInterestRules>["rules"][number];

/**
 * A rate as the design writes it: "2,75 %" in Italian, "2.75%" in English, with the decimal
 * separator the person chose in Settings (a style, not just a format name, reaches here).
 */
export function formatRate(percent: string, format: NumberFormat): string {
  const name = typeof format === "string" ? format : format.format;
  const plain = rateInput(percent, format);
  return name === "en-US" ? `${plain}%` : `${plain} %`;
}

/** A rate as the person would type it back into the dialog. */
export function rateInput(percent: string, format: NumberFormat): string {
  return percent.replace(".", numberSeparators(format).decimal);
}

/** A typed percentage ("2,75" or "2.75", per the person's separators) in plain decimal form. */
export function readRate(text: string, format: NumberFormat): string {
  const { decimal, group } = numberSeparators(format);
  return text.replace(/[\s%]/g, "").replaceAll(group, "").replace(decimal, ".");
}

const cents = (amount: string | null) => (amount === null ? null : parseCents(amount));

/** The design's tier chips: "2,75 % up to 20.000 €", "1,50 % above", or "any balance". */
export function tierChips(
  tiers: Rule["tiers"],
  format: NumberFormat,
  labels: { upTo: (amount: string) => string; to: (amount: string) => string; above: string; any: string },
): { rate: string; range: string }[] {
  return tiers.map((tier, index) => ({
    rate: formatRate(tier.rate, format),
    range:
      tier.upTo === null
        ? tiers.length === 1
          ? labels.any
          : labels.above
        : (index === 0 ? labels.upTo : labels.to)(
            formatMoney(parseCents(tier.upTo), format, { decimals: false }),
          ),
  }));
}

/** The dialog's starting point for an existing rule. */
export function draftOf(rule: Rule, format: NumberFormat): RuleDraft {
  return {
    id: rule.id,
    accountId: rule.accountId,
    accountName: rule.account,
    validFrom: rule.validFrom,
    validTo: rule.validTo ?? "",
    runHour: rule.runHour === null ? "" : String(rule.runHour),
    tiers: rule.tiers.map((tier) => ({
      upTo: formatAmountInput(cents(tier.upTo), format),
      rate: rateInput(tier.rate, format),
    })),
    tax: rateInput(rule.tax, format),
    dayBasis: rule.dayBasis,
    settlement: rule.settlement,
    payeeMatch: rule.payeeMatch ?? "",
    publish: rule.mode === "post_to_provider",
    categoryId: rule.categoryId,
    active: rule.state === "active",
  };
}

/** A new rule: the first open account, today, the default hour, one tier, the country's tax, monthly, active. */
export function newDraft(accounts: readonly { id: string; name: string }[], today: string): RuleDraft {
  return {
    id: null,
    accountId: accounts[0]?.id ?? "",
    accountName: accounts[0]?.name ?? "",
    validFrom: today,
    validTo: "",
    runHour: "",
    tiers: [{ upTo: "", rate: "" }],
    tax: countryRule("IT", "interestTaxPercent"),
    dayBasis: "365",
    settlement: "monthly",
    payeeMatch: "",
    publish: false,
    categoryId: null,
    active: true,
  };
}
