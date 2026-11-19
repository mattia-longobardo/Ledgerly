// The read model of Overview and Accounts (spec §7.1), the part of `accountsView` that reads
// nothing: each account's row, and the totals the rows add up to. `index.ts` reads, this composes.
import { addMonths, type CivilDate, type MonthKey } from "../../../shared/dates";
import type { DisplayCurrency } from "../../../platform/fx/rules";
import type { Cents } from "../../../shared/money";
import {
  type AccountAlert,
  type BalancePoint,
  type Bucket,
  alertsFor,
  bucketOf,
  estimatedMonths,
  isStale,
  monthEndSeries,
  totalSeries,
} from "../rules";
import type { accounts, snapshotRuns } from "../schema";

type Account = typeof accounts.$inferSelect;
type SnapshotRun = typeof snapshotRuns.$inferSelect;
type Convert = (cents: Cents | null, from: string, day: CivilDate) => Cents | null;

/** The window of a view: its months, the day each stands for, today's reading day, the month before. */
interface ViewWindow {
  months: MonthKey[];
  daysOf: CivilDate[];
  asOf: CivilDate;
  previousMonthEnd: CivilDate;
  /** The last month of the window. */
  end: MonthKey;
  now: Date;
}

interface AccountRow {
  account: Account;
  /** The latest known balance, `null` while the account has none. */
  balance: Cents | null;
  /** The same account at the end of the previous month, for the monthly change. */
  previous: Cents | null;
  /** One month-end value per month of the window; `interpolate` applies here and nowhere else. */
  series: (Cents | null)[];
  /** Per month, whether the value stands on a month end rebuilt from the movements (F2.5). */
  estimated: boolean[];
  /**
   * The same months held, never interpolated: what the net worth sums. The stacked Overview chart
   * draws these, so its bands add up to its total exactly.
   */
  held: (Cents | null)[];
  /**
   * The same figures in the display currency (docs/design/investments.md §1.8, D1), each converted
   * at the rate of its own day: what every total sums and the stacked chart draws. Equal to the
   * native ones when the account is in the display currency; `null` where a rate is missing.
   */
  display: { balance: Cents | null; previous: Cents | null; held: (Cents | null)[] };
  /** The account has a balance today and no rate to the display currency: it is out of the totals. */
  missingRate: boolean;
  stale: boolean;
}

type BucketTotals = Record<Bucket, { total: Cents | null; partial: boolean; count: number }>;

export interface AccountsView {
  /** What every total below is in: the user's display currency. Each row's own fields are not. */
  currency: DisplayCurrency;
  months: MonthKey[];
  rows: AccountRow[];
  /** The net-worth series: the accounts included in it, held (never interpolated) and summed. */
  netWorth: { total: Cents | null; partial: boolean }[];
  /** Per month, whether any account in the net worth stands on a rebuilt month end (F2.5). */
  netWorthEstimated: boolean[];
  total: Cents | null;
  totalPartial: boolean;
  previousTotal: Cents | null;
  buckets: BucketTotals;
  alerts: AccountAlert[];
  /** The currencies of accounts counted today that have no rate to `currency`, sorted. */
  missingRates: string[];
  lastSnapshot: SnapshotRun | null;
}

function emptyBuckets(): BucketTotals {
  return {
    cash: { total: null, partial: false, count: 0 },
    savings: { total: null, partial: false, count: 0 },
    investments: { total: null, partial: false, count: 0 },
    other: { total: null, partial: false, count: 0 },
  };
}

/** One account's row: its balances, its series by month, and the same in the display currency. */
export function viewRow(
  account: Account,
  read: { latest: Map<string, Cents>; previous: Map<string, Cents>; points: BalancePoint[] },
  window: ViewWindow,
  convert: Convert,
): AccountRow {
  const balance = read.latest.get(account.id) ?? null;
  const before = read.previous.get(account.id) ?? null;
  const held = monthEndSeries(read.points, window.months, "hold");
  const display = {
    balance: convert(balance, account.currency, window.asOf),
    previous: convert(before, account.currency, window.previousMonthEnd),
    held: held.map((cents, index) => convert(cents, account.currency, window.daysOf[index])),
  };
  return {
    account,
    balance,
    previous: before,
    series: monthEndSeries(read.points, window.months, account.betweenEntries),
    estimated: estimatedMonths(read.points, window.months),
    held,
    display,
    missingRate: balance !== null && display.balance === null,
    stale:
      account.state !== "archived" &&
      account.origin === "synced" &&
      isStale(account.lastSyncedAt, account.staleAfterHours, window.now),
  };
}

function bucketTotals(counted: readonly AccountRow[]): BucketTotals {
  const buckets = emptyBuckets();
  for (const row of counted) {
    const bucket = buckets[bucketOf(row.account)];
    bucket.count += 1;
    if (row.display.balance === null) bucket.partial = true;
    else bucket.total = (bucket.total ?? 0n) + row.display.balance;
  }
  return buckets;
}

/**
 * The totals of the rows: the accounts «in the net worth» that are not archived, summed in the
 * display currency month by month; the buckets of today; the alerts of the open accounts.
 */
export function viewTotals(
  rows: readonly AccountRow[],
  window: ViewWindow,
  points: Map<string, BalancePoint[]>,
  convert: Convert,
): Omit<AccountsView, "currency" | "months" | "rows" | "lastSnapshot"> {
  const counted = rows.filter((row) => row.account.inNetWorth && row.account.state !== "archived");
  const netWorth = totalSeries(
    counted.map((row) => row.display.held),
    window.months.length,
  );
  const current = netWorth.at(-1) ?? { total: null, partial: false };
  // The net worth at the end of the month before `end`, whatever the window (decision D1, ACC-2):
  // the same held value Overview's chart has there, so a one-month window is no longer `null`.
  const heldBefore = (row: AccountRow) =>
    monthEndSeries(points.get(row.account.id) ?? [], [addMonths(window.end, -1)], "hold")[0] ?? null;
  const [previousNetWorth] = totalSeries(
    counted.map((row) => [convert(heldBefore(row), row.account.currency, window.previousMonthEnd)]),
    1,
  );
  return {
    netWorth,
    netWorthEstimated: window.months.map((_month, index) => counted.some((row) => row.estimated[index])),
    total: current.total,
    totalPartial: current.partial,
    previousTotal: previousNetWorth?.total ?? null,
    buckets: bucketTotals(counted),
    // Nothing to warn about on an account you closed: no low balance, no reading gone stale.
    alerts: rows
      .filter((row) => row.account.state !== "archived")
      .flatMap((row) => alertsFor(row.account, row.balance, window.now)),
    missingRates: [
      ...new Set(counted.filter((row) => row.missingRate).map((row) => row.account.currency)),
    ].sort(),
  };
}
