import { and, asc, eq, inArray, isNull, lt, gte, sql, sum } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate, civilDateIn } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { transactions } from "../schema";
import { cents, dayExpression, dayStart, labelIdsFor, type Transaction } from "./filters";

/** The movements of a set of ids, with their labels: what the service loads before it merges. */
export async function transactionsByIds(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[],
): Promise<Map<string, Transaction>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(transactions)
    .where(and(inArray(transactions.id, wanted), userScoped(ctx).owns(transactions)))
    .orderBy(asc(transactions.id));
  const labelIds = await labelIdsFor(
    ctx,
    rows.map((row) => row.id),
  );
  return new Map(rows.map((row) => [row.id, { ...row, labelIds: labelIds.get(row.id) ?? [] }]));
}

export async function getTransaction(ctx: Pick<Ctx, "userId">, id: string): Promise<Transaction | null> {
  const found = await transactionsByIds(ctx, [id]);
  return found.get(id) ?? null;
}

/**
 * Every movement of an account, ids only, with no window and no limit: what the accounts module
 * needs to forget an account's provider links before the rows go (spec §4.3 keeps those ids in
 * `provider_links`, which has no foreign key to cascade). A window would be a sentinel here, and
 * a sentinel date is a lie that outlives whoever wrote it.
 */
export async function transactionIdsOfAccount(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), userScoped(ctx).owns(transactions)))
    .orderBy(asc(transactions.id));
  return rows.map((row) => row.id);
}

/** A movement as the re-read window sees it (spec §7.2): the account's rows over a date range. */
export async function transactionsInWindow(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  window: { from: CivilDate; to: CivilDate },
): Promise<{ id: string; occurredAt: Date; removedUpstreamAt: Date | null }[]> {
  return getDb()
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      removedUpstreamAt: transactions.removedUpstreamAt,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.accountId, accountId),
        // A reading says nothing about a movement written by hand: it is never declared gone.
        eq(transactions.origin, "provider"),
        gte(transactions.occurredAt, dayStart(window.from, ctx.timeZone)),
        lt(transactions.occurredAt, dayStart(addDays(window.to, 1), ctx.timeZone)),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
}

/**
 * What each account moved per civil day, in the user's zone and in date order: what the accounts
 * module rebuilds a synced account's past month ends from (spec §7.1, F2.5). It goes through here
 * because `transactions` is this module's table (§4.2).
 *
 * Everything that moved the balance counts: hidden movements (hiding is about totals, not about
 * the money) and giroconti (they are exactly money leaving or entering this account). A movement
 * the provider stopped returning does not: it is no longer in the balance the provider reads. Nor
 * does one written by hand: the provider's balance never held it ({@link manualMovementsByAccount}).
 */
export async function dailyNetByAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
): Promise<Map<string, { on: CivilDate; cents: Cents }[]>> {
  if (accountIds.length === 0) return new Map();
  const day = dayExpression(ctx.timeZone);
  const rows = await getDb()
    .select({ accountId: transactions.accountId, on: day, cents: sum(transactions.amountCents) })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        isNull(transactions.removedUpstreamAt),
        eq(transactions.origin, "provider"),
      ),
    )
    // By position, for the same reason as `monthlyTotals`.
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`, sql`2`);
  const byAccount = new Map<string, { on: CivilDate; cents: Cents }[]>();
  for (const row of rows) {
    const days = byAccount.get(row.accountId) ?? [];
    days.push({ on: row.on, cents: cents(row.cents) });
    byAccount.set(row.accountId, days);
  }
  return byAccount;
}

/**
 * The movements a person wrote by hand, by account and in date order: what the accounts module
 * works the balance after them out from (rewrite plan, 12-account-modes.md §12.2). A hidden one is
 * out of the balance as it is out of the totals.
 */
export async function manualMovementsByAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
): Promise<Map<string, { id: string; on: CivilDate; cents: Cents; writtenAt: Date }[]>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      cents: transactions.amountCents,
      writtenAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.origin, "manual"),
        isNull(transactions.hiddenAt),
        inArray(transactions.accountId, [...accountIds]),
      ),
    )
    .orderBy(asc(transactions.accountId), asc(transactions.occurredAt), asc(transactions.id));
  const byAccount = new Map<string, { id: string; on: CivilDate; cents: Cents; writtenAt: Date }[]>();
  for (const row of rows) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push({
      id: row.id,
      on: civilDateIn(row.occurredAt, ctx.timeZone),
      cents: row.cents,
      writtenAt: row.writtenAt,
    });
    byAccount.set(row.accountId, list);
  }
  return byAccount;
}

/** A movement of an account as Investments counts it: money in (> 0) or out (< 0) of the account. */
interface AccountMovement {
  id: string;
  on: CivilDate;
  occurredAt: Date;
  cents: Cents;
  payee: string | null;
  transferGroupId: string | null;
}

/**
 * The movements of each account, in the user's zone and in date order: the deposits and the
 * withdrawals of a manual service of Investments (docs/design/investments.md §1.3, PERS-342). The
 * same rows as {@link dailyNetByAccount} — hidden ones too, a movement the provider stopped
 * returning not — one by one, not summed by day.
 */
export async function movementsByAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
): Promise<Map<string, AccountMovement[]>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      cents: transactions.amountCents,
      payee: transactions.payee,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        isNull(transactions.removedUpstreamAt),
      ),
    )
    .orderBy(asc(transactions.accountId), asc(transactions.occurredAt), asc(transactions.id));
  const byAccount = new Map<string, AccountMovement[]>();
  for (const row of rows) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push({
      id: row.id,
      on: civilDateIn(row.occurredAt, ctx.timeZone),
      occurredAt: row.occurredAt,
      cents: row.cents,
      payee: row.payee,
      transferGroupId: row.transferGroupId,
    });
    byAccount.set(row.accountId, list);
  }
  return byAccount;
}
