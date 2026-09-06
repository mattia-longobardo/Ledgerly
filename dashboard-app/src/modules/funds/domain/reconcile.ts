import type { ContributionLike } from "./totals";

export type IssueKind = "missing" | "duplicate" | "anomalous";

export interface DetectedIssue {
  kind: IssueKind;
  entityType: "fund_month" | "fund_contribution";
  entityId: string;
  severity: "warning" | "error";
  detail: Record<string, unknown>;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function cents(value: string): bigint {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new Error(`not a decimal: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

function formatMedian(medianTwice: bigint): string {
  if (medianTwice % 2n === 0n) return formatCents(medianTwice / 2n);
  const negative = medianTwice < 0n;
  const absoluteHalfCents = negative ? -medianTwice : medianTwice;
  const wholeCents = absoluteHalfCents / 2n;
  return `${negative ? "-" : ""}${formatCents(wholeCents)}5`;
}

function medianTwice(values: readonly bigint[]): bigint {
  const sorted = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]! * 2n;
  return sorted[middle - 1]! + sorted[middle]!;
}

function decimalFraction(value: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("tolerance must be a finite non-negative number");
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(value.toString());
  if (!match) throw new RangeError(`invalid tolerance: ${value}`);
  const [, integer, fraction = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  let numerator = BigInt(`${integer}${fraction}`);
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  return { numerator, denominator };
}

function hasPayrollProvenance(row: ContributionLike): boolean {
  if (row.typeCode === "fee" || row.typeCode === "reversal") return false;
  return row.source === "payroll" || (row.source === "migration" && row.payrollRecordId !== null);
}

function coversPayrollMonth(row: ContributionLike, month: string): boolean {
  if (row.payrollAccrualMonth !== undefined) return row.payrollAccrualMonth === month;
  return row.accrualPeriodStart <= month && month <= row.accrualPeriodEnd;
}

function anomalyMonth(row: ContributionLike): string {
  return row.payrollAccrualMonth ?? row.accrualPeriodStart;
}

export function detectIssues(input: {
  fundId: string;
  payrollMonths: readonly string[];
  rows: readonly ContributionLike[];
  medianWindow?: number;
  tolerance?: number;
}): DetectedIssue[] {
  const medianWindow = input.medianWindow ?? 6;
  if (!Number.isInteger(medianWindow) || medianWindow <= 0) {
    throw new RangeError("medianWindow must be a positive integer");
  }
  const tolerance = input.tolerance ?? 0.3;
  const toleranceRatio = decimalFraction(tolerance);
  const payrollRows = input.rows.filter(hasPayrollProvenance);

  const missing: DetectedIssue[] = [...new Set(input.payrollMonths)]
    .sort((a, b) => a.localeCompare(b))
    .filter((month) => !payrollRows.some((row) => coversPayrollMonth(row, month)))
    .map((month) => ({
      kind: "missing",
      entityType: "fund_month",
      entityId: `${input.fundId}:${month}`,
      severity: "warning",
      detail: { month },
    }));

  const seen = new Map<string, ContributionLike>();
  const duplicate: DetectedIssue[] = [];
  for (const row of input.rows) {
    if (row.payrollRecordId === null) continue;
    const key = `${row.typeCode}\u0000${row.payrollRecordId}`;
    const original = seen.get(key);
    if (original === undefined) {
      seen.set(key, row);
      continue;
    }
    duplicate.push({
      kind: "duplicate",
      entityType: "fund_contribution",
      entityId: row.id,
      severity: "error",
      detail: {
        duplicateOf: original.id,
        payrollRecordId: row.payrollRecordId,
        typeCode: row.typeCode,
      },
    });
  }
  duplicate.sort((a, b) => a.entityId.localeCompare(b.entityId));

  const histories = new Map<string, bigint[]>();
  const anomalous: DetectedIssue[] = [];
  const anomalyCandidates = payrollRows
    .filter((row) => cents(row.amount) > 0n)
    .sort((a, b) =>
      anomalyMonth(a).localeCompare(anomalyMonth(b))
      || a.postedMonth.localeCompare(b.postedMonth)
      || a.id.localeCompare(b.id));

  for (const row of anomalyCandidates) {
    const amount = cents(row.amount);
    const history = histories.get(row.typeCode) ?? [];
    if (history.length >= medianWindow) {
      const window = history.slice(-medianWindow);
      const median = medianTwice(window);
      const difference = amount * 2n >= median ? amount * 2n - median : median - amount * 2n;
      if (difference * toleranceRatio.denominator > median * toleranceRatio.numerator) {
        anomalous.push({
          kind: "anomalous",
          entityType: "fund_contribution",
          entityId: row.id,
          severity: "warning",
          detail: { amount: row.amount, median: formatMedian(median), tolerance },
        });
      }
    }
    history.push(amount);
    histories.set(row.typeCode, history);
  }
  anomalous.sort((a, b) => a.entityId.localeCompare(b.entityId));

  return [...missing, ...duplicate, ...anomalous];
}
