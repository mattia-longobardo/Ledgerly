import { centsToDecimal, type Cents, parseCents } from "@/platform/money";
import { type FieldName, type MoneyField } from "../fields";
import { isExtraMonth, type PayslipType, type TfrSource } from "../rules";
import type { Warning } from "./checks";

/** The values of a payslip's fields as they stand: the correction when there is one, else as read. */
export type Values = Partial<Record<FieldName, string | null>>;

export function moneyOf(values: Values, field: MoneyField): Cents | null {
  const value = values[field];
  if (value === null || value === undefined || !/^-?\d+(\.\d{1,2})?$/.test(value)) return null;
  return parseCents(value);
}

/** Hours as hundredths, so the leave checks add up exactly: "51.66" → 5166. */
export function hundredthsOf(values: Values, field: FieldName): bigint | null {
  const value = values[field];
  if (value === null || value === undefined || !/^-?\d+(\.\d{1,2})?$/.test(value)) return null;
  return parseCents(value);
}

/** The sum of known amounts; `null` only when none is known (never a zero for "unknown"). */
function sumKnown(...amounts: (Cents | null)[]): Cents | null {
  const known = amounts.filter((amount): amount is Cents => amount !== null);
  return known.length === 0 ? null : known.reduce((sum, amount) => sum + amount, 0n);
}

export interface Derived {
  values: Partial<Record<FieldName, string | null>>;
  /** Which fields each derived value comes from, for the evidence (owner's spec L32). */
  from: Partial<Record<FieldName, FieldName[]>>;
  warnings: Warning[];
}

/**
 * The values computed from the others (owner's spec L91–161), always from the fields as they
 * stand, so a correction flows through. Nothing is invented: a derived value is `null` when what it
 * is made of is unknown.
 */
export function deriveFields(values: Values, type: PayslipType): Derived {
  const money = (field: MoneyField) => moneyOf(values, field);
  const out: Derived = { values: {}, from: {}, warnings: [] };
  const set = (field: FieldName, value: Cents | string | null, from: FieldName[]) => {
    out.values[field] = typeof value === "bigint" ? centsToDecimal(value) : value;
    out.from[field] = from;
  };

  // Gross = the printed total without the welfare reimbursement (L97, L109): never the salary.
  const totalGross = money("totalGrossPrinted");
  set("gross", totalGross === null ? null : totalGross - (money("welfareCash") ?? 0n), [
    "totalGrossPrinted",
    "welfareCash",
  ]);

  // Taxes withheld (L117): IRPEF (or the year-end adjustment owed), the regional and municipal
  // instalments, the substitute tax. A year-end credit is a refund, not a negative tax.
  const adjustment = money("yearEndAdjustment");
  const irpef = money("irpefWithheld");
  const taxes =
    irpef === null && adjustment === null
      ? null
      : sumKnown(
          irpef,
          adjustment !== null && adjustment > 0n ? adjustment : null,
          money("regionalInstallment"),
          money("municipalWithheld"),
          money("substituteTax"),
        );
  set("taxesTotal", taxes, [
    "irpefWithheld",
    "yearEndAdjustment",
    "regionalInstallment",
    "municipalWithheld",
    "substituteTax",
  ]);
  // A cash balance, negative in a month with a refund (L128).
  const refunds = (money("refund730") ?? 0n) + (adjustment !== null && adjustment < 0n ? -adjustment : 0n);
  set("taxesNetOfRefunds", taxes === null ? null : taxes - refunds, ["taxesTotal", "refund730", "yearEndAdjustment"]);

  // The fund (L137–147): regular quota plus adjustments, each kept on its own as well.
  set("employeeFundEffective", sumKnown(money("employeeFundRegular"), money("employeeFundAdjustments")), [
    "employeeFundRegular",
    "employeeFundAdjustments",
  ]);
  const employerPrinted = money("employerFundPrinted");
  const employerAdjustments = money("employerFundAdjustments");
  // An adjustment with no regular quota beside it (L147) is not a month's employer contribution:
  // it is never summed into one, and no amount is computed for that month.
  set("employerFundEffective", employerPrinted === null ? null : employerPrinted + (employerAdjustments ?? 0n), [
    "employerFundPrinted",
    "employerFundAdjustments",
  ]);
  // On a 13th or a 14th that is simply how the payslip is written — the extra month carries the
  // adjustment of the ordinary months and no quota of its own — so there is nothing to review and
  // nothing to say: the amount stands on its own line and is kept apart. On an ordinary month the
  // same shape is unexpected, and only there is it worth a word.
  if (employerPrinted === null && employerAdjustments !== null && !isExtraMonth(type)) {
    out.warnings.push({ code: "employer_fund_adjustment_only", field: "employerFundAdjustments" });
  }

  // TFR (L151–161): both forms read, the one present chosen, never summed, never in the net.
  const monthField = money("tfrMonthField");
  const contribution = money("tfrContributionLine");
  const source: TfrSource | null =
    monthField !== null && contribution !== null
      ? "both"
      : contribution !== null
        ? "contribution_line"
        : monthField !== null
          ? "month_field"
          : null;
  set("tfrSelected", contribution ?? monthField, ["tfrContributionLine", "tfrMonthField"]);
  set("tfrSource", source, ["tfrContributionLine", "tfrMonthField"]);
  if (monthField !== null && contribution !== null && monthField !== contribution) {
    out.warnings.push({
      code: "tfr_both_differ",
      field: "tfrSelected",
      detail: { monthField: centsToDecimal(monthField), contributionLine: centsToDecimal(contribution) },
    });
  }
  // A partial month (L157): TFR on a partial month's gross is transcribed, and pointed out.
  const contractual = money("contractualGross");
  const gross = totalGross === null ? null : totalGross - (money("welfareCash") ?? 0n);
  if (
    type === "ordinary" &&
    (monthField ?? contribution) !== null &&
    contractual !== null &&
    gross !== null &&
    gross < contractual
  ) {
    out.warnings.push({ code: "tfr_partial_month", field: "tfrSelected" });
  }
  return out;
}
