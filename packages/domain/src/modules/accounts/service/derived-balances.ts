import { and, eq, gt, gte, inArray, isNull, or } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, addDays } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { syncsTransactions } from "../../../platform/integrations/rules";
import { type Cents } from "../../../shared/money";
import { movements } from "../ports";
import { dailySeries, deriveMonthEnds, movementBalances, withMovementPoints } from "../rules";
import {
  type Account,
  accountsToRebuild,
  type BalanceEntry,
  listAccounts,
  movementBasis,
  observedDays,
} from "../queries";
import { accounts, balanceEntries, manualMovementAccounts } from "../schema";
import { requireAccount } from "./guards";

/**
 * The reconstructed balance (ACC-4), not the reading of `readingsAt`: several accounts' balances
 * on every day of a window, in one read (spec §7.1, F2.5): a synced
 * account's from its readings and its movements, a manual one's held between entries
 * (`dailySeries`). Both ends included; a window reaching past today is the caller's to trim. An id
 * that is not one of this user's accounts is simply absent from `series`.
 */
export async function reconstructedBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
  window: { from: CivilDate; to: CivilDate },
): Promise<{ days: CivilDate[]; series: Map<string, { values: (Cents | null)[]; estimated: boolean[] }> }> {
  const wanted = new Set(accountIds);
  const owned = (await listAccounts(ctx, { includeArchived: true })).filter((account) =>
    wanted.has(account.id),
  );
  const syncedIds = owned.filter((account) => account.origin === "synced").map((account) => account.id);
  const [basis, daily] = await Promise.all([
    movementBasis(
      ctx,
      owned.map((account) => account.id),
    ),
    movements().dailyNetByAccount(ctx, syncedIds),
  ]);
  const days: CivilDate[] = [];
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) days.push(day);
  const series = new Map(
    owned.map((account) => {
      const { readings = [], points = [] } = basis.get(account.id) ?? {};
      const read = dailySeries(
        readings,
        daily.get(account.id) ?? [],
        days,
        account.origin === "synced" ? "movements" : "hold",
      );
      // The movements written by hand are in neither the readings nor the provider's movements.
      return [account.id, { ...read, values: withMovementPoints(read.values, days, readings, points) }];
    }),
  );
  return { days, series };
}

/** One account day by day, for Account detail's day grain (see {@link reconstructedBalances}). */
export async function accountReconstructedBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  window: { from: CivilDate; to: CivilDate },
): Promise<{ days: CivilDate[]; values: (Cents | null)[]; estimated: boolean[] }> {
  const account = await requireAccount(ctx, accountId);
  const { days, series } = await reconstructedBalances(ctx, [account.id], window);
  const one = series.get(account.id) ?? { values: days.map(() => null), estimated: days.map(() => false) };
  return { days, ...one };
}

/**
 * The month ends of the user's synced accounts rebuilt from their movements (spec §7.1, F2.5),
 * from scratch: every `derived` row of those accounts goes, and `deriveMonthEnds` writes the ones
 * the current readings and movements support, in one transaction — so running it twice changes
 * nothing, and a reading or a correction added since simply moves what gets rebuilt. A manual
 * account has no movements, so there is nothing to rebuild it from, and neither has the account of a
 * provider that syncs no movements (`syncsTransactions`: an investment provider).
 *
 * Reads first, writes after, and no network anywhere (spec §4.3): the sync calls it once its own
 * reads are over.
 */
export async function rebuildDerivedBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds?: readonly string[],
  options: { manualChanged?: boolean } = {},
): Promise<{ written: number }> {
  const wanted = (await accountsToRebuild(ctx)).filter(
    ({ account }) => accountIds === undefined || accountIds.includes(account.id),
  );
  const monthEnds = await rebuildMonthEnds(
    ctx,
    wanted.map(({ account }) => account),
  );
  // After the month ends: a rebuilt end that follows a manual movement has to show it too. Only
  // the accounts that have a manual movement, or whose manual movements the caller just changed:
  // a balance written on any other account starts nothing here.
  const manual = options.manualChanged ? wanted : wanted.filter((one) => one.hasManualMovements);
  if (manual.length > 0) {
    await rebuildMovementBalances(
      ctx,
      manual.map((one) => ({ id: one.account.id, marked: one.hasManualMovements })),
    );
  }
  return monthEnds;
}

/**
 * The balance after the movements a person wrote by hand (rewrite plan, 12-account-modes.md
 * §12.2), from scratch like the month ends: every `movement` row of the accounts goes and
 * `movementBalances` writes the ones the readings and the manual movements support, in one
 * transaction. It runs wherever a reading or a manual movement changes, so every read of a
 * balance — Accounts, Overview, the net worth, the API — finds the number already there. The same
 * transaction keeps the mark of the account (`manual_movement_accounts`) true to it.
 */
async function rebuildMovementBalances(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  wanted: readonly { id: string; marked: boolean }[],
): Promise<void> {
  const ids = wanted.map((account) => account.id);
  const manual = await movements().manualMovementsByAccount(ctx, ids);
  const basis = await movementBasis(ctx, [...manual.keys()]);
  const capturedAt = new Date();
  const rows = [...manual].flatMap(([accountId, movements]) => {
    const { readings = [], copies = [] } = basis.get(accountId) ?? {};
    return movementBalances(readings, movements, copies).map((point) =>
      userScoped(ctx).stamp({
        accountId,
        on: point.on,
        balanceCents: point.cents,
        source: "movement" as const,
        capturedAt,
      }),
    );
  });
  await getDb().transaction(async (trx) => {
    await trx
      .delete(balanceEntries)
      .where(
        and(
          userScoped(ctx).owns(balanceEntries),
          eq(balanceEntries.source, "movement"),
          inArray(balanceEntries.accountId, ids),
        ),
      );
    if (rows.length > 0) await trx.insert(balanceEntries).values(rows);
    const marked = wanted.filter((account) => manual.has(account.id) && !account.marked);
    if (marked.length > 0) {
      await trx
        .insert(manualMovementAccounts)
        .values(marked.map((account) => userScoped(ctx).stamp({ accountId: account.id })))
        .onConflictDoNothing();
    }
    const unmarked = wanted.filter((account) => !manual.has(account.id) && account.marked);
    if (unmarked.length > 0) {
      await trx.delete(manualMovementAccounts).where(
        and(
          userScoped(ctx).owns(manualMovementAccounts),
          inArray(
            manualMovementAccounts.accountId,
            unmarked.map((account) => account.id),
          ),
        ),
      );
    }
  });
}

async function rebuildMonthEnds(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  wanted: readonly Account[],
): Promise<{ written: number }> {
  const synced = wanted.filter(
    (account) => account.origin === "synced" && syncsTransactions(account.provider),
  );
  if (synced.length === 0) return { written: 0 };
  const ids = synced.map((account) => account.id);
  const [observed, daily] = await Promise.all([
    observedDays(ctx, ids),
    movements().dailyNetByAccount(ctx, ids),
  ]);
  const capturedAt = new Date();
  const rows = ids.flatMap((accountId) =>
    deriveMonthEnds(observed.get(accountId) ?? [], daily.get(accountId) ?? []).map((point) =>
      userScoped(ctx).stamp({
        accountId,
        on: point.on,
        balanceCents: point.cents,
        source: "derived" as const,
        capturedAt,
      }),
    ),
  );
  await getDb().transaction(async (trx) => {
    await trx
      .delete(balanceEntries)
      .where(
        and(
          userScoped(ctx).owns(balanceEntries),
          inArray(balanceEntries.accountId, ids),
          eq(balanceEntries.source, "derived"),
        ),
      );
    if (rows.length > 0) await trx.insert(balanceEntries).values(rows);
  });
  return { written: rows.length };
}

/**
 * The `portfolio` points of an account Investments manages (docs/design/investments.md §1.7),
 * inside the caller's transaction: every point from `from` on goes and `points` take their place,
 * so a rewrite from the oldest day a change touches leaves every day before it as it was.
 */
export async function replacePortfolioPoints(
  ctx: Pick<Ctx, "userId">,
  change: { accountId: string; from: CivilDate; points: readonly { on: CivilDate; cents: Cents }[] },
  trx: Tx,
): Promise<{ written: number }> {
  const { accountId, from, points } = change;
  await requireAccount(ctx, accountId, trx);
  await trx
    .delete(balanceEntries)
    .where(
      and(
        userScoped(ctx).owns(balanceEntries),
        eq(balanceEntries.accountId, accountId),
        eq(balanceEntries.source, "portfolio"),
        gte(balanceEntries.on, from),
      ),
    );
  const capturedAt = new Date();
  const rows = points
    .filter((point) => point.on >= from)
    .map((point) =>
      userScoped(ctx).stamp({
        accountId,
        on: point.on,
        balanceCents: point.cents,
        source: "portfolio" as const,
        capturedAt,
      }),
    );
  if (rows.length > 0) await trx.insert(balanceEntries).values(rows);
  return { written: rows.length };
}

/**
 * Moves an account's opening back to `on` when its history turns out to start earlier (PERS-100:
 * the estimated history of a service), inside the caller's transaction. Never moves it forward.
 */
export async function openedNoLaterThan(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  day: CivilDate,
  trx: Tx,
): Promise<void> {
  await trx
    .update(accounts)
    .set({ openedOn: day })
    .where(
      and(
        eq(accounts.id, accountId),
        userScoped(ctx).owns(accounts),
        or(isNull(accounts.openedOn), gt(accounts.openedOn, day)),
      ),
    );
}

/**
 * The handover of an existing account to Investments at `T` (§1.3, A4), inside the caller's
 * transaction: the `manual`, `import` and `provider` entries from `T` on are removed and returned,
 * for the caller to archive in the same transaction; the ones before `T` stay.
 */
export async function takeOverEntries(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  from: CivilDate,
  trx: Tx,
): Promise<BalanceEntry[]> {
  return trx
    .delete(balanceEntries)
    .where(
      and(
        userScoped(ctx).owns(balanceEntries),
        eq(balanceEntries.accountId, accountId),
        inArray(balanceEntries.source, ["manual", "import", "provider"]),
        gte(balanceEntries.on, from),
      ),
    )
    .returning();
}
