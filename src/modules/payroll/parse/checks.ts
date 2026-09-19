import { centsToDecimal, type Cents } from "@/platform/money";
import { LEAVE_COLUMNS, LEAVE_KINDS, leaveField, type MoneyField } from "../fields";
import { medianCents, type PayslipType } from "../rules";
import { hundredthsOf, moneyOf, type Values } from "./derive";
import type { RawLine } from "./reply-teamsystem";

export const CHECK_IDS = [
  "irpef",
  "net",
  "body_deductions",
  "total_deductions",
  "substitute_tax",
  "leave_vacation",
  "leave_rol",
  "leave_permit",
  "plausibility_net",
  "plausibility_gross",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/**
 * One control of spec §7.8 and the owner's spec (L115, L175, L224–235). `error` checks that fail
 * keep the payslip "to verify"; `warning` ones only say so (plausibility, plan F5 §3.6.7). Amounts
 * are decimal strings, so the result reads the same in the database and on screen.
 */
export interface CheckResult {
  id: CheckId;
  status: "passed" | "failed" | "skipped";
  severity: "error" | "warning";
  expected?: string;
  actual?: string;
  /** Why a check was skipped, or what the failure is about: a message key. */
  reason?: string;
}

export const WARNING_CODES = [
  "unknown_code",
  "tfr_both_differ",
  "tfr_partial_month",
  "employer_fund_adjustment_only",
  "permit_unclassified",
  "extra_month_leave",
  "rectification",
  "missing_identity",
  "unknown_layout",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

/** Something a person must look at, even when every check passes (owner's spec L254). */
export interface Warning {
  code: WarningCode;
  field?: string;
  detail?: Record<string, string>;
}

/** A payslip applied before this one: the plausibility baseline (plan F5 §3.6.7). */
export interface HistoryPoint {
  period: string;
  netPay: Cents | null;
  gross: Cents | null;
}

export interface CheckInput {
  type: PayslipType;
  period: string | null;
  values: Values;
  lines: readonly Pick<RawLine, "role" | "earningsCents" | "deductionsCents" | "statisticalCents">[];
  /** Ordinary payslips of the same employee applied before this one, any order. */
  history: readonly HistoryPoint[];
}

/** How far net or gross may move from the median of the last six before a warning: 30 %. */
export const PLAUSIBILITY_RATIO = 0.3;
const PLAUSIBILITY_WINDOW = 6;

const decimal = (cents: Cents) => centsToDecimal(cents);

function passedIf(
  id: CheckId,
  severity: CheckResult["severity"],
  expected: Cents,
  actual: Cents,
  tolerance = 0n,
): CheckResult {
  const difference = expected > actual ? expected - actual : actual - expected;
  return {
    id,
    severity,
    status: difference <= tolerance ? "passed" : "failed",
    expected: decimal(expected),
    actual: decimal(actual),
  };
}

const skipped = (id: CheckId, severity: CheckResult["severity"], reason: string): CheckResult => ({
  id,
  severity,
  status: "skipped",
  reason,
});

/**
 * The controls of spec §7.8 (owner's spec L115, L175, L224–235, L242), on the fields as they
 * stand. None of them corrects anything: a failure only says the payslip is "to verify".
 */
export function runChecks(input: CheckInput): CheckResult[] {
  const money = (field: MoneyField) => moneyOf(input.values, field);
  const results: CheckResult[] = [];

  // IRPEF gross − deductions = IRPEF withheld, within a cent, in ordinary months (L115).
  const irpefGross = money("irpefGross");
  const withheld = money("irpefWithheld");
  if (input.type !== "ordinary") results.push(skipped("irpef", "error", "extra_month"));
  else if (money("yearEndAdjustment") !== null) results.push(skipped("irpef", "error", "year_end_adjustment"));
  else if (irpefGross === null || withheld === null) results.push(skipped("irpef", "error", "missing"));
  else results.push(passedIf("irpef", "error", irpefGross - (money("taxDeductions") ?? 0n), withheld, 1n));

  // The net rebuilt from the lines' columns and their meaning, to the cent (L224–233).
  const net = money("netPay");
  const earnings = money("bodyEarnings");
  if (net === null || earnings === null) results.push(skipped("net", "error", "missing"));
  else {
    const adjustment = money("yearEndAdjustment");
    const rebuilt =
      earnings -
      (money("bodyDeductions") ?? 0n) -
      (money("employeeSocial") ?? 0n) -
      (withheld ?? 0n) -
      (adjustment ?? 0n) -
      (money("substituteTax") ?? 0n) -
      (money("roundingPrevious") ?? 0n) +
      (money("roundingCurrent") ?? 0n);
    results.push(passedIf("net", "error", rebuilt, net));
  }

  // The body's deductions add up to TRATTENUTE CORPO, a blank box being none.
  const bodyDeductions = money("bodyDeductions");
  if (bodyDeductions === null) results.push(skipped("body_deductions", "error", "missing"));
  else results.push(passedIf("body_deductions", "error", money("bodyDeductionsPrinted") ?? 0n, bodyDeductions));

  // TOTALE TRATTENUTE = body deductions + social contributions + IRPEF + substitute tax + the
  // previous month's rounding: a second, independent way to the net.
  const totalPrinted = money("totalDeductionsPrinted");
  if (totalPrinted === null || bodyDeductions === null) {
    results.push(skipped("total_deductions", "error", "missing"));
  } else {
    const rebuilt =
      bodyDeductions +
      (money("employeeSocial") ?? 0n) +
      (withheld ?? 0n) +
      (money("yearEndAdjustment") ?? 0n) +
      (money("substituteTax") ?? 0n) +
      (money("roundingPrevious") ?? 0n);
    results.push(passedIf("total_deductions", "error", totalPrinted, rebuilt));
  }

  // The substitute tax printed twice (body line and T.S. box) is one tax (L242).
  const substituteLines = input.lines.filter((line) => line.role === "substitute_tax");
  const substitute = money("substituteTax");
  if (substituteLines.length === 0 || substitute === null) {
    results.push(skipped("substitute_tax", "error", "single_source"));
  } else {
    const fromLines = substituteLines.reduce<Cents>(
      (sum, line) => sum + (line.statisticalCents ?? line.deductionsCents ?? line.earningsCents ?? 0n),
      0n,
    );
    results.push(passedIf("substitute_tax", "error", fromLines, substitute));
  }

  // A.P. + MAT. − GOD. = RES. (L175): a blank counts as zero for the sum only.
  for (const kind of LEAVE_KINDS) {
    const id: CheckId = `leave_${kind}`;
    const [previous, accrued, used, remaining] = LEAVE_COLUMNS.map((column) =>
      hundredthsOf(input.values, leaveField(kind, column)),
    );
    if ([previous, accrued, used, remaining].every((value) => value === null)) {
      results.push(skipped(id, "error", "blank"));
      continue;
    }
    const expected = (previous ?? 0n) + (accrued ?? 0n) - (used ?? 0n);
    results.push(passedIf(id, "error", expected, remaining ?? 0n, 1n));
  }

  // Plausibility against the person's own payslips (spec §7.8): only ever a warning.
  const baseline = input.history
    .filter((point) => input.period === null || point.period < input.period)
    .toSorted((a, b) => b.period.localeCompare(a.period))
    .slice(0, PLAUSIBILITY_WINDOW);
  for (const [id, field, pick] of [
    ["plausibility_net", "netPay", (point: HistoryPoint) => point.netPay],
    ["plausibility_gross", "gross", (point: HistoryPoint) => point.gross],
  ] as const) {
    const value = money(field);
    const median = medianCents(baseline.map(pick));
    if (input.type !== "ordinary") results.push(skipped(id, "warning", "extra_month"));
    else if (value === null || median === null || median === 0n) results.push(skipped(id, "warning", "no_history"));
    else {
      const deviation = Math.abs(Number(value - median)) / Math.abs(Number(median));
      results.push({
        id,
        severity: "warning",
        status: deviation > PLAUSIBILITY_RATIO ? "failed" : "passed",
        expected: decimal(median),
        actual: decimal(value),
      });
    }
  }
  return results;
}

/** Whether any check that keeps a payslip "to verify" failed. */
export function hasBlockingFailure(results: readonly CheckResult[]): boolean {
  return results.some((result) => result.severity === "error" && result.status === "failed");
}
