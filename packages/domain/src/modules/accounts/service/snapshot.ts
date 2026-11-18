import { and, asc, eq, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, addMonths, lastDayOfMonth, type MonthKey, monthKey } from "../../../platform/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { convertCents } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import { type Cents, sumCents } from "../../../platform/money";
import { isStale } from "../rules";
import { balancesOn } from "../queries";
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
  const on = lastDayOfMonth(month);
  const included = await getDb()
    .select()
    .from(accounts)
    .where(and(userScoped(ctx).owns(accounts), eq(accounts.inSnapshot, true)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
  const open = included.filter((account) => account.state !== "archived");

  const balances =
    open.length === 0
      ? new Map()
      : await balancesOn(
          ctx,
          open.map((a) => a.id),
          on,
          { observed: true },
        );
  const warnings: string[] = [];
  const values: (typeof balanceEntries.$inferInsert)[] = [];
  for (const account of open) {
    const balance = balances.get(account.id);
    if (balance === undefined) continue;
    if (account.origin === "synced" && isStale(account.lastSyncedAt, account.staleAfterHours, now)) {
      warnings.push(account.name);
    }
    values.push(
      userScoped(ctx).stamp({
        accountId: account.id,
        on,
        balanceCents: balance,
        source: "system" as const,
        capturedAt: now,
      }),
    );
  }

  if (values.length > 0) {
    await getDb()
      .insert(balanceEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [balanceEntries.accountId, balanceEntries.on, balanceEntries.source],
        set: { balanceCents: sql`excluded.balance_cents`, capturedAt: now },
      });
  }

  const currency = ctx.displayCurrency;
  const currencyOf = new Map(open.map((account) => [account.id, account.currency]));
  const rates = await ratesOn(
    open.some((account) => account.currency !== currency) ? [currency, ...currencyOf.values()] : [],
    on,
    on,
  );
  const { total } = sumCents(
    values.map((value) =>
      convertCents(
        value.balanceCents as Cents,
        currencyOf.get(value.accountId) ?? currency,
        currency,
        on,
        rates,
      ),
    ),
  );
  const outcome: SnapshotOutcome = {
    month: monthKey(month),
    written: values.length,
    skipped: open.length - values.length,
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

/** The month the snapshot of `on` covers: the month before it (spec §10.2, the 1st at 00:05). */
export function snapshotMonthFor(on: CivilDate): MonthKey {
  return addMonths(monthKey(on), -1);
}
