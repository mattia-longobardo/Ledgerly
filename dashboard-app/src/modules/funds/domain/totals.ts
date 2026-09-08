import { monthRange } from "@/lib/time";

export interface ContributionLike {
  id: string;
  typeCode: string;
  amount: string;
  postedMonth: string;
  accrualPeriodStart: string;
  accrualPeriodEnd: string;
  /** Exact originating payroll month when a caller has joined the payroll record. */
  payrollAccrualMonth?: string;
  source: string;
  payrollRecordId: string | null;
  reversesId?: string | null;
}

export interface QuarterRow {
  quarter: string;
  accrualMonths: string[];
  postedMonth: string;
  gross: string;
  fees: string;
  net: string;
  posted: boolean;
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

export function depositedThrough(rows: readonly ContributionLike[], month: string): string {
  const total = rows.reduce(
    (sum, row) => row.postedMonth <= month ? sum + cents(row.amount) : sum,
    0n,
  );
  return formatCents(total);
}

export function absoluteReturn(value: string | null, deposited: string): string | null {
  if (value === null) return null;
  return formatCents(cents(value) - cents(deposited));
}

interface PeriodTotals {
  accrualPeriodStart: string;
  accrualPeriodEnd: string;
  postedMonth: string;
  gross: bigint;
  fees: bigint;
  net: bigint;
}

function calendarQuarter(month: string): string {
  const year = month.slice(0, 4);
  const quarter = Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

export function quarterlyRows(rows: readonly ContributionLike[], today: string): QuarterRow[] {
  const periods = new Map<string, PeriodTotals>();
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const row of rows) {
    const key = `${row.accrualPeriodStart}\u0000${row.accrualPeriodEnd}\u0000${row.postedMonth}`;
    const period = periods.get(key) ?? {
      accrualPeriodStart: row.accrualPeriodStart,
      accrualPeriodEnd: row.accrualPeriodEnd,
      postedMonth: row.postedMonth,
      gross: 0n,
      fees: 0n,
      net: 0n,
    };
    const amount = cents(row.amount);
    const reversed = row.reversesId ? rowsById.get(row.reversesId) : undefined;
    const belongsToFees = row.typeCode === "fee"
      || (row.typeCode === "reversal" && reversed?.typeCode === "fee");
    if (belongsToFees) period.fees += amount;
    else period.gross += amount;
    period.net += amount;
    periods.set(key, period);
  }

  return [...periods.values()]
    .sort((a, b) =>
      a.accrualPeriodStart.localeCompare(b.accrualPeriodStart)
      || a.accrualPeriodEnd.localeCompare(b.accrualPeriodEnd)
      || a.postedMonth.localeCompare(b.postedMonth))
    .map((period) => ({
      quarter: calendarQuarter(period.accrualPeriodStart),
      accrualMonths: monthRange(period.accrualPeriodStart, period.accrualPeriodEnd),
      postedMonth: period.postedMonth,
      gross: formatCents(period.gross),
      fees: formatCents(period.fees),
      net: formatCents(period.net),
      posted: period.postedMonth <= today,
    }));
}
