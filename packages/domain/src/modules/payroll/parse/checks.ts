import { centsToDecimal, type Cents } from "../../../shared/money";
import { LEAVE_COLUMNS, LEAVE_KINDS, leaveField, type MoneyField } from "../fields";
import { medianCents, type PayslipType, type ProfileCheck } from "../rules";
import { UNCONFIRMED_LEAVE } from "../rules/legacy";
import { hundredthsOf, moneyOf, type Values } from "./derive";
import type { RawLine } from "./read";

/** The results a check writes: one per check, one per balance (`leave_<kind>`), two for plausibility. */
export const CHECK_IDS = [
  "irpef",
  "net",
  "body_deductions",
  "total_deductions",
  "substitute_tax",
  ...LEAVE_KINDS.map((kind) => `leave_${kind}` as const),
  "plausibility_net",
  "plausibility_gross",
] as const;
type CheckId = (typeof CHECK_IDS)[number];

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

export const WARNING_CODES = ["unknown_code", "tfr_both_differ", "tfr_partial_month", "employer_fund_adjustment_only", UNCONFIRMED_LEAVE, "extra_month_leave", "rectification", "missing_identity", "unknown_layout"] as const;
type WarningCode = (typeof WARNING_CODES)[number];

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

interface CheckInput {
  type: PayslipType;
  period: string | null;
  values: Values;
  lines: readonly Pick<RawLine, "role" | "earningsCents" | "deductionsCents" | "statisticalCents">[];
  /** Ordinary payslips of the same employee applied before this one, any order. */
  history: readonly HistoryPoint[];
}

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

type Check<C extends ProfileCheck["id"]> = (
  input: CheckInput,
  check: Extract<ProfileCheck, { id: C }>,
) => CheckResult[];

const money = (input: CheckInput, field: MoneyField) => moneyOf(input.values, field);

// IRPEF gross − deductions = IRPEF withheld, within the tolerance, in ordinary months (L115).
const irpef: Check<"irpef"> = (input, check) => {
  const irpefGross = money(input, "irpefGross");
  const withheld = money(input, "irpefWithheld");
  if (input.type !== "ordinary") return [skipped("irpef", "error", "extra_month")];
  if (money(input, "yearEndAdjustment") !== null) return [skipped("irpef", "error", "year_end_adjustment")];
  if (irpefGross === null || withheld === null) return [skipped("irpef", "error", "missing")];
  const expected = irpefGross - (money(input, "taxDeductions") ?? 0n);
  return [passedIf("irpef", "error", expected, withheld, BigInt(check.tolerance))];
};

// The net rebuilt from the lines' columns and their meaning, to the cent (L224–233).
const net: Check<"net"> = (input) => {
  const amount = money(input, "netPay");
  const earnings = money(input, "bodyEarnings");
  if (amount === null || earnings === null) return [skipped("net", "error", "missing")];
  const rebuilt =
    earnings -
    (money(input, "bodyDeductions") ?? 0n) -
    (money(input, "employeeSocial") ?? 0n) -
    (money(input, "irpefWithheld") ?? 0n) -
    (money(input, "yearEndAdjustment") ?? 0n) -
    (money(input, "substituteTax") ?? 0n) -
    (money(input, "roundingPrevious") ?? 0n) +
    (money(input, "roundingCurrent") ?? 0n);
  return [passedIf("net", "error", rebuilt, amount)];
};

// The body's deductions add up to the printed body total, a blank box being none.
const bodyDeductions: Check<"body_deductions"> = (input) => {
  const deductions = money(input, "bodyDeductions");
  if (deductions === null) return [skipped("body_deductions", "error", "missing")];
  return [passedIf("body_deductions", "error", money(input, "bodyDeductionsPrinted") ?? 0n, deductions)];
};

// The printed total of deductions = body deductions + social contributions + IRPEF + substitute
// tax + the previous month's rounding: a second, independent way to the net.
const totalDeductions: Check<"total_deductions"> = (input) => {
  const totalPrinted = money(input, "totalDeductionsPrinted");
  const deductions = money(input, "bodyDeductions");
  if (totalPrinted === null || deductions === null) return [skipped("total_deductions", "error", "missing")];
  const rebuilt =
    deductions +
    (money(input, "employeeSocial") ?? 0n) +
    (money(input, "irpefWithheld") ?? 0n) +
    (money(input, "yearEndAdjustment") ?? 0n) +
    (money(input, "substituteTax") ?? 0n) +
    (money(input, "roundingPrevious") ?? 0n);
  return [passedIf("total_deductions", "error", totalPrinted, rebuilt)];
};

// The substitute tax printed twice (body line and summary box) is one tax (L242).
const substituteTax: Check<"substitute_tax"> = (input) => {
  const substituteLines = input.lines.filter((line) => line.role === "substitute_tax");
  const substitute = money(input, "substituteTax");
  if (substituteLines.length === 0 || substitute === null) return [skipped("substitute_tax", "error", "single_source")];
  const fromLines = substituteLines.reduce<Cents>(
    (sum, line) => sum + (line.statisticalCents ?? line.deductionsCents ?? line.earningsCents ?? 0n),
    0n,
  );
  return [passedIf("substitute_tax", "error", fromLines, substitute)];
};

// Previous year + accrued − used = remaining, per balance (L175): a blank counts as zero for the sum only.
const leaveBalance: Check<"leave_balance"> = (input, check) =>
  check.kinds.map((kind) => {
    const id: CheckId = `leave_${kind}`;
    const [previous, accrued, used, remaining] = LEAVE_COLUMNS.map((column) =>
      hundredthsOf(input.values, leaveField(kind, column)),
    );
    if ([previous, accrued, used, remaining].every((value) => value === null)) return skipped(id, "error", "blank");
    const expected = (previous ?? 0n) + (accrued ?? 0n) - (used ?? 0n);
    return passedIf(id, "error", expected, remaining ?? 0n, BigInt(check.tolerance));
  });

// Net and gross against the median of the person's last payslips (spec §7.8): only ever a warning.
const plausibility: Check<"plausibility"> = (input, check) => {
  const baseline = input.history
    .filter((point) => input.period === null || point.period < input.period)
    .toSorted((a, b) => b.period.localeCompare(a.period))
    .slice(0, check.window);
  return (
    [
      ["plausibility_net", "netPay", (point: HistoryPoint) => point.netPay],
      ["plausibility_gross", "gross", (point: HistoryPoint) => point.gross],
    ] as const
  ).map(([id, field, pick]): CheckResult => {
    const value = money(input, field);
    const median = medianCents(baseline.map(pick));
    if (input.type !== "ordinary") return skipped(id, "warning", "extra_month");
    if (value === null || median === null || median === 0n) return skipped(id, "warning", "no_history");
    const deviation = Math.abs(Number(value - median)) / Math.abs(Number(median));
    return {
      id,
      severity: "warning",
      status: deviation > check.ratio ? "failed" : "passed",
      expected: decimal(median),
      actual: decimal(value),
    };
  });
};

/**
 * The controls of spec §7.8 (owner's spec L115, L175, L224–235, L242) a profile lists, in its order,
 * on the fields as they stand. None of them corrects anything: a failure only says the payslip is
 * "to verify".
 */
export function runChecks(input: CheckInput, checks: readonly ProfileCheck[]): CheckResult[] {
  return checks.flatMap((check) => {
    switch (check.id) {
      case "irpef":
        return irpef(input, check);
      case "net":
        return net(input, check);
      case "body_deductions":
        return bodyDeductions(input, check);
      case "total_deductions":
        return totalDeductions(input, check);
      case "substitute_tax":
        return substituteTax(input, check);
      case "leave_balance":
        return leaveBalance(input, check);
      case "plausibility":
        return plausibility(input, check);
    }
  });
}

/** Whether any check that keeps a payslip "to verify" failed. */
export function hasBlockingFailure(results: readonly CheckResult[]): boolean {
  return results.some((result) => result.severity === "error" && result.status === "failed");
}
