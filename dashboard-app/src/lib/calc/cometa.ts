import { addMonths } from "@/lib/time";
import { fromCents, toCents, type MoneyInput } from "./money";

/**
 * Cometa credits contributions QUARTERLY, not monthly.
 *
 * A payslip accrues the contribution every month, but the money only reaches
 * the fund — and only then buys units — once a quarter, in the middle of the
 * month after the quarter closes. Verified against the owner's own transaction
 * export (`DettaglioOperazioni`), which reconciles to the cent:
 *
 *   2025 Q4  accrued 543,44  paid 20/01/2026  net 540,44   (543,44 - 3,00)
 *   2026 Q1  accrued 821,41  paid 13/04/2026  net 818,41
 *   2026 Q2  accrued 828,21  paid 16/07/2026  net 825,21
 *
 * and 20,802 + 30,926 + 30,427 = 82,155 units × 27,121 = 2.228,13, the balance
 * Teable carries. Treating the accrual month as the deposit month would put
 * money in the fund up to four months before it was actually invested, which
 * inflates the denominator of every return figure.
 */

/** €1 per month, charged as €3 with each quarterly credit. */
export const QUARTERLY_FEE = 3;
/** One-off joining cost, taken at the first credit (5,16 + 5,16 in the export). */
export const JOINING_FEE = 10.32;

export interface CometaCredit {
  /** Month the money actually reached the fund and bought units. */
  creditedMonth: string;
  /**
   * Month the Allocation sheet first shows the money. A month's recorded value
   * is the position at the *end of the month before* — verified against the
   * export's "Data Valore Quota": the 13/04 credit buys units at the 30/04 NAV
   * (26,463) and 51,728 units x 26,463 = 1.368,88, the May figure, not April's.
   */
  visibleMonth: string;
  /** e.g. "2026-Q1" — the quarter the contributions were accrued in. */
  quarter: string;
  /** Accrual months that make up this credit. */
  accrualMonths: string[];
  /** Sum of the monthly payslip contributions. */
  grossContributed: number;
  /** Costs deducted before units are bought. */
  fees: number;
  /** What actually bought units: gross − fees. */
  netInvested: number;
}

export interface MonthlyAccrual {
  month: string;
  amount: MoneyInput;
}

function quarterIndex(month: string): number {
  return Math.floor((Number(month.slice(5, 7)) - 1) / 3);
}

function quarterKey(month: string): string {
  return `${month.slice(0, 4)}-Q${quarterIndex(month) + 1}`;
}

/** First month of the quarter that `month` falls in. */
function quarterStart(month: string): string {
  const q = quarterIndex(month);
  return `${month.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}-01`;
}

/**
 * The month a quarter's contributions are credited: the one after the quarter
 * closes. Q4 2025 → January 2026, Q1 2026 → April 2026.
 */
export function creditMonthFor(accrualMonth: string): string {
  return addMonths(quarterStart(accrualMonth), 3);
}

/** The month that credit first becomes visible in the recorded values. */
export function visibleMonthFor(accrualMonth: string): string {
  return addMonths(creditMonthFor(accrualMonth), 1);
}

/**
 * Groups monthly accruals into the quarterly credits that actually happen.
 * Fees are applied per credit; the joining fee lands on the first one only.
 */
export function cometaSchedule(
  accruals: MonthlyAccrual[],
  opts: { quarterlyFee?: number; joiningFee?: number } = {},
): CometaCredit[] {
  const quarterlyFee = opts.quarterlyFee ?? QUARTERLY_FEE;
  const joiningFee = opts.joiningFee ?? JOINING_FEE;

  const byQuarter = new Map<string, { months: string[]; cents: number }>();
  for (const a of accruals) {
    const cents = toCents(a.amount ?? null);
    if (cents === null) continue;
    const key = quarterKey(a.month);
    const acc = byQuarter.get(key) ?? { months: [], cents: 0 };
    acc.months.push(a.month);
    acc.cents += cents;
    byQuarter.set(key, acc);
  }

  const ordered = [...byQuarter.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return ordered.map(([quarter, acc], index) => {
    const months = [...acc.months].sort();
    const gross = fromCents(acc.cents);
    const fees = Number((quarterlyFee + (index === 0 ? joiningFee : 0)).toFixed(2));
    return {
      creditedMonth: creditMonthFor(months[0]!),
      visibleMonth: visibleMonthFor(months[0]!),
      quarter,
      accrualMonths: months,
      grossContributed: gross,
      fees,
      netInvested: Number((gross - fees).toFixed(2)),
    };
  });
}

/**
 * Net amounts keyed by the month they become visible — the input a return
 * calculation needs, because it must line up with the value series it is
 * differencing, not with the payment date on the statement.
 */
export function creditedByMonth(credits: CometaCredit[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of credits) {
    out.set(c.visibleMonth, Number(((out.get(c.visibleMonth) ?? 0) + c.netInvested).toFixed(2)));
  }
  return out;
}

/**
 * Cometa's monthly payslip accruals rewritten as the deposits that have
 * actually been credited — one row per quarterly credit, dated the month the
 * money becomes visible and carrying only what really bought units
 * (`netInvested`). Feed these to `totalDeposited`/`returnTable` in place of the
 * raw accruals so a quarter accrued but not yet credited stays out of the
 * denominator: a fund page reading a month before that credit is visible sees
 * neither the money in the value nor the money in the deposited figure, so the
 * two line up and the return stops going negative. Fideuram, paid in monthly,
 * needs none of this and keeps using its raw deposits.
 */
export function cometaCreditedDeposits(
  accruals: MonthlyAccrual[],
  opts: { quarterlyFee?: number; joiningFee?: number } = {},
): { month: string; amount: number }[] {
  return [...creditedByMonth(cometaSchedule(accruals, opts))]
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}
