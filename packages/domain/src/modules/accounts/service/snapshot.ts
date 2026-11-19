import { and, asc, eq, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, addMonths, lastDayOfMonth, type MonthKey, monthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { convertCents } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import type { Cents } from "../../../shared/money";
import { isStale, netWorth } from "../rules";
import { type Account, readingsAt } from "../queries";
import { accounts, balanceEntries, snapshotRuns } from "../schema";

export interface SnapshotOutcome {
  month: MonthKey;
  written: number;
  skipped: number;
  /** In `currency`, the display currency of the day it ran: each account converted, then summed. */
  total: Cents | null;
  currency: string;
  warnings: string[];
}

/**
 * The monthly snapshot of spec §7.1: for every account included in it, a `system` balance on the
 * last day of `month`, copied from the last balance known up to that day. Accounts with no data
 * are skipped, and running it twice changes nothing — both the balances and the `snapshot_runs`
 * row are upserts, so a retry after a partial failure is safe.
 *
 * Each `system` balance is a copy in the account's own currency. The run's total is in the display
 * currency (docs/design/investments.md §2.3): every balance converted at the month end's rate, then
 * summed, and saved with `total_currency`, so a later change of the preference never rewrites it.
 * A balance with no rate stays out of the total, never counted 1:1.
 */
export async function runSnapshot(
  ctx: Pick<Ctx, "userId" | "displayCurrency">,
  month: MonthKey,
  now: Date = new Date(),
): Promise<SnapshotOutcome> {
  const monthEnd = lastDayOfMonth(month);
  const included = await getDb()
    .select()
    .from(accounts)
    .where(and(userScoped(ctx).owns(accounts), eq(accounts.inSnapshot, true)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const open = included.filter((account) => account.state !== "archived");
  const balances =
    open.length === 0
      ? new Map<string, Cents>()
      : await readingsAt(
          ctx,
          open.map((account) => account.id),
          monthEnd,
          { observed: true },
        );
  const { written, warnings } = await writeMonthEnds(ctx, open, balances, { monthEnd, now });
  const { currency, total } = await snapshotTotal(ctx, open, balances, monthEnd);
  const outcome: SnapshotOutcome = {
    month: monthKey(month),
    written,
    skipped: open.length - written,
    total,
    currency,
    warnings,
  };
  const row = {
    state: warnings.length > 0 ? ("warning" as const) : ("success" as const),
    accountsWritten: outcome.written,
    accountsSkipped: outcome.skipped,
    totalCents: total,
    totalCurrency: currency,
    warnings,
    ranAt: now,
  };
  await getDb()
    .insert(snapshotRuns)
    .values(userScoped(ctx).stamp({ month: outcome.month, ...row }))
    .onConflictDoUpdate({ target: [snapshotRuns.userId, snapshotRuns.month], set: row });
  return outcome;
}

/** The `system` balance of each account that has one at the month end; the stale ones, by name. */
async function writeMonthEnds(
  ctx: Pick<Ctx, "userId">,
  open: readonly Account[],
  balances: ReadonlyMap<string, Cents>,
  when: { monthEnd: CivilDate; now: Date },
): Promise<{ written: number; warnings: string[] }> {
  const warnings: string[] = [];
  const values: (typeof balanceEntries.$inferInsert)[] = [];
  for (const account of open) {
    const balance = balances.get(account.id);
    if (balance === undefined) continue;
    if (account.origin === "synced" && isStale(account.lastSyncedAt, account.staleAfterHours, when.now)) {
      warnings.push(account.name);
    }
    values.push(
      userScoped(ctx).stamp({
        accountId: account.id,
        on: when.monthEnd,
        balanceCents: balance,
        source: "system" as const,
        capturedAt: when.now,
      }),
    );
  }
  if (values.length > 0) {
    await getDb()
      .insert(balanceEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [balanceEntries.accountId, balanceEntries.on, balanceEntries.source],
        set: { balanceCents: sql`excluded.balance_cents`, capturedAt: when.now },
      });
  }
  return { written: values.length, warnings };
}

/**
 * The one total of the accounts (ACC-3), with the filter of the snapshot (decision D2): the
 * accounts «in the snapshot» that have a balance, each converted at the month end's rate.
 */
async function snapshotTotal(
  ctx: Pick<Ctx, "displayCurrency">,
  open: readonly Account[],
  balances: ReadonlyMap<string, Cents>,
  monthEnd: CivilDate,
): Promise<{ currency: string; total: Cents | null }> {
  const currency = ctx.displayCurrency;
  const rates = await ratesOn(
    open.some((account) => account.currency !== currency)
      ? [currency, ...open.map((account) => account.currency)]
      : [],
    monthEnd,
    monthEnd,
  );
  const { total } = netWorth(
    open.flatMap((account) => {
      const balance = balances.get(account.id);
      return balance === undefined
        ? []
        : [{ account, cents: convertCents(balance, account.currency, currency, monthEnd, rates) }];
    }),
    "inSnapshot",
  );
  return { currency, total };
}

/** The month the snapshot of `day` covers: the month before it (spec §10.2, the 1st at 00:05). */
export function snapshotMonthFor(day: CivilDate): MonthKey {
  return addMonths(monthKey(day), -1);
}
