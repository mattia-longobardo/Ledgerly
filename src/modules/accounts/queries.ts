import "server-only";
import { and, asc, desc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import {
  type CivilDate,
  addMonths,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
  monthsBetween,
  today,
} from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
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
} from "./rules";
import { accountGroups, accounts, balanceEntries, snapshotRuns } from "./schema";

export type Account = typeof accounts.$inferSelect;
export type BalanceEntry = typeof balanceEntries.$inferSelect;
export type SnapshotRun = typeof snapshotRuns.$inferSelect;
export type AccountGroup = typeof accountGroups.$inferSelect;

/**
 * Same day, more than one source: the correction a person typed comes first (spec §7.1), and a
 * month end rebuilt from the movements comes last of all (F2.5) — every source is named, so a new
 * one cannot fall into a tie by accident.
 */
export const SOURCE_RANK = sql`case ${balanceEntries.source} when 'manual' then 0 when 'import' then 1 when 'provider' then 2 when 'system' then 3 else 4 end`;

/** The sources that are not a reading of the account: the snapshot's copies and the rebuilt ends. */
const NOT_OBSERVED = ["system", "derived"] as const;

const MONTH_OF = sql`date_trunc('month', ${balanceEntries.on})`;

/** How many months the Overview and Accounts charts look back over. */
export const WINDOW_MONTHS = 24;

/**
 * The balance of each account on a day: its latest entry on or before it.
 *
 * `observed` leaves out the snapshot's own `system` rows. The monthly snapshot reads the balances
 * that way, so a second run copies the real balance again rather than the row its first run wrote
 * (which would freeze the month at whatever the first run happened to see).
 */
export async function balancesOn(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
  on: CivilDate,
  options: { observed?: boolean } = {},
): Promise<Map<string, Cents>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .selectDistinctOn([balanceEntries.accountId], {
      accountId: balanceEntries.accountId,
      balanceCents: balanceEntries.balanceCents,
    })
    .from(balanceEntries)
    .where(
      and(
        userScoped(ctx).owns(balanceEntries),
        inArray(balanceEntries.accountId, [...accountIds]),
        lte(balanceEntries.on, on),
        options.observed ? notInArray(balanceEntries.source, [...NOT_OBSERVED]) : undefined,
      ),
    )
    .orderBy(
      asc(balanceEntries.accountId),
      desc(balanceEntries.on),
      asc(SOURCE_RANK),
      desc(balanceEntries.capturedAt),
    );
  return new Map(rows.map((row) => [row.accountId, row.balanceCents]));
}

/**
 * One point per account per month: that month's last balance, up to and including `through`.
 * Months before the window are kept on purpose — the most recent one is a series' starting value
 * (spec §7.1), so a chart does not begin at `null` for an account that simply has not moved.
 */
export async function monthlyPoints(
  ctx: Pick<Ctx, "userId">,
  through: CivilDate,
): Promise<Map<string, BalancePoint[]>> {
  const rows = await getDb()
    .selectDistinctOn([balanceEntries.accountId, MONTH_OF], {
      accountId: balanceEntries.accountId,
      on: balanceEntries.on,
      balanceCents: balanceEntries.balanceCents,
      source: balanceEntries.source,
    })
    .from(balanceEntries)
    .where(and(userScoped(ctx).owns(balanceEntries), lte(balanceEntries.on, through)))
    .orderBy(
      asc(balanceEntries.accountId),
      MONTH_OF,
      desc(balanceEntries.on),
      asc(SOURCE_RANK),
      desc(balanceEntries.capturedAt),
    );
  const byAccount = new Map<string, BalancePoint[]>();
  for (const row of rows) {
    const points = byAccount.get(row.accountId) ?? [];
    points.push({ on: row.on, cents: row.balanceCents, derived: row.source === "derived" });
    byAccount.set(row.accountId, points);
  }
  return byAccount;
}

/**
 * The readings of each account, one per day — the best source of that day — and nothing the app
 * wrote itself (no snapshot copy, no rebuilt end): what `deriveMonthEnds` rebuilds the history
 * from (spec §7.1, F2.5). In date order.
 */
export async function observedDays(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<Map<string, BalancePoint[]>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .selectDistinctOn([balanceEntries.accountId, balanceEntries.on], {
      accountId: balanceEntries.accountId,
      on: balanceEntries.on,
      balanceCents: balanceEntries.balanceCents,
    })
    .from(balanceEntries)
    .where(
      and(
        userScoped(ctx).owns(balanceEntries),
        inArray(balanceEntries.accountId, [...accountIds]),
        notInArray(balanceEntries.source, [...NOT_OBSERVED]),
      ),
    )
    .orderBy(
      asc(balanceEntries.accountId),
      asc(balanceEntries.on),
      asc(SOURCE_RANK),
      desc(balanceEntries.capturedAt),
    );
  const byAccount = new Map<string, BalancePoint[]>();
  for (const row of rows) {
    const points = byAccount.get(row.accountId) ?? [];
    points.push({ on: row.on, cents: row.balanceCents });
    byAccount.set(row.accountId, points);
  }
  return byAccount;
}

export async function listAccounts(
  ctx: Pick<Ctx, "userId">,
  options: { includeArchived?: boolean } = {},
): Promise<Account[]> {
  const rows = await getDb()
    .select()
    .from(accounts)
    .where(userScoped(ctx).owns(accounts))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  return options.includeArchived ? rows : rows.filter((row) => row.state !== "archived");
}

export async function getAccount(ctx: Pick<Ctx, "userId">, id: string): Promise<Account | null> {
  const [row] = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), userScoped(ctx).owns(accounts)));
  return row ?? null;
}

export async function listBalanceEntries(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  limit = 200,
): Promise<BalanceEntry[]> {
  return getDb()
    .select()
    .from(balanceEntries)
    .where(and(eq(balanceEntries.accountId, accountId), userScoped(ctx).owns(balanceEntries)))
    .orderBy(desc(balanceEntries.on), asc(SOURCE_RANK), desc(balanceEntries.id))
    .limit(limit);
}

export async function listSnapshotRuns(ctx: Pick<Ctx, "userId">, limit = 24): Promise<SnapshotRun[]> {
  return getDb()
    .select()
    .from(snapshotRuns)
    .where(userScoped(ctx).owns(snapshotRuns))
    .orderBy(desc(snapshotRuns.month), desc(snapshotRuns.id))
    .limit(limit);
}

export interface AccountRow {
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
  stale: boolean;
}

export type BucketTotals = Record<Bucket, { total: Cents | null; partial: boolean; count: number }>;

export interface AccountsView {
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

/**
 * Everything Overview and Accounts render, read once. Balances are the month-end series of spec
 * §7.1: held forward, `null` before an account's first balance, and a total that is `null` only
 * when every account is unknown. An account's `interpolate` setting shapes its own chart series
 * and never the totals.
 */
export async function accountsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  options: { months?: number; now?: Date; through?: MonthKey; includeArchived?: boolean } = {},
): Promise<AccountsView> {
  const now = options.now ?? new Date();
  const span = options.months ?? WINDOW_MONTHS;
  const todayOn = today(ctx.timeZone, now);
  const thisMonth = monthKey(todayOn);
  // The window ends on the month asked for, or on the current one. A past month is read at its
  // last day; the current month is read at today, because its end has not happened yet.
  const end = options.through ? monthKey(options.through) : thisMonth;
  const on = end >= thisMonth ? todayOn : lastDayOfMonth(end);
  const months = monthsBetween(addMonths(end, -(span - 1)), end);

  // An archived account is off the list unless it is asked for. It never joins the totals either
  // way (see `counted` below): the net worth of today is what you have today, and a closed account
  // is not part of it — its balances stay counted in the months it was open, which is what the
  // series already does.
  const [open, points, snapshots] = await Promise.all([
    listAccounts(ctx, { includeArchived: options.includeArchived ?? false }),
    monthlyPoints(ctx, on),
    listSnapshotRuns(ctx, 1),
  ]);
  const latest = await balancesOn(
    ctx,
    open.map((account) => account.id),
    on,
  );
  const previousMonthEnd = lastDayOfMonth(addMonths(end, -1));
  const previous = await balancesOn(
    ctx,
    open.map((account) => account.id),
    previousMonthEnd,
  );

  const rows: AccountRow[] = open.map((account) => ({
    account,
    balance: latest.get(account.id) ?? null,
    previous: previous.get(account.id) ?? null,
    series: monthEndSeries(points.get(account.id) ?? [], months, account.betweenEntries),
    estimated: estimatedMonths(points.get(account.id) ?? [], months),
    held: monthEndSeries(points.get(account.id) ?? [], months, "hold"),
    stale:
      account.state !== "archived" &&
      account.origin === "synced" &&
      isStale(account.lastSyncedAt, account.staleAfterHours, now),
  }));

  const counted = rows.filter((row) => row.account.inNetWorth && row.account.state !== "archived");
  const netWorth = totalSeries(
    counted.map((row) => row.held),
    months.length,
  );
  const current = netWorth.at(-1) ?? { total: null, partial: false };
  const netWorthEstimated = months.map((_, i) => counted.some((row) => row.estimated[i]));

  const buckets = emptyBuckets();
  for (const row of counted) {
    const bucket = buckets[bucketOf(row.account)];
    bucket.count += 1;
    if (row.balance === null) bucket.partial = true;
    else bucket.total = (bucket.total ?? 0n) + row.balance;
  }

  // Nothing to warn about on an account you closed: no low balance, no reading gone stale.
  const alerts = rows
    .filter((row) => row.account.state !== "archived")
    .flatMap((row) => alertsFor(row.account, row.balance, now));

  return {
    months,
    rows,
    netWorth,
    netWorthEstimated,
    total: current.total,
    totalPartial: current.partial,
    previousTotal: netWorth.at(-2)?.total ?? null,
    buckets,
    alerts,
    lastSnapshot: snapshots[0] ?? null,
  };
}
