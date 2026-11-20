import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, sql, sum } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, civilDateIn, lastDayOfMonth, type MonthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { type Cadence, cadenceOfInterval, type TransactionType } from "../rules";
import { categories, recurringPatterns, transactions } from "../schema";
import { WAITING_FOR_CATEGORY, cents, conditions, payeeKeyExpression } from "./filters";

/**
 * What each category spent on each account in one month (spec §7.3, F3): the sum of the absolute
 * values of the month's `expense` movements, in the user's zone, hidden and gone-from-provider rows
 * left out and never a giroconto (only `expense` counts). `null` is the uncategorised; the amount
 * is positive. The budgets module reads it through here because `transactions` is this module's
 * table (§4.2).
 */
export async function monthSpending(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  month: MonthKey,
): Promise<
  { categoryId: string | null; accountId: string; cents: Cents; waiting: number; waitingCents: Cents }[]
> {
  const rows = await getDb()
    .select({
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      cents: sum(transactions.amountCents),
      // How many of them wait in "To review" (rewrite plan N3): zero for a row with a category.
      waiting: sql<number>`count(*) filter (where ${WAITING_FOR_CATEGORY})::int`,
      waitingCents: sql<
        string | null
      >`sum(${transactions.amountCents}) filter (where ${WAITING_FOR_CATEGORY})`,
    })
    .from(transactions)
    .where(and(conditions(ctx, { from: month, to: lastDayOfMonth(month) }), eq(transactions.type, "expense")))
    .groupBy(transactions.categoryId, transactions.accountId)
    .orderBy(sql`${transactions.categoryId} asc nulls last`, asc(transactions.accountId));
  return rows.map((row) => ({
    categoryId: row.categoryId,
    accountId: row.accountId,
    cents: -cents(row.cents),
    waiting: row.waiting,
    waitingCents: -cents(row.waitingCents),
  }));
}

/** A movement as the matching services see it (audit TRX-8): its own day, and its texts. */
interface FoundMovement {
  id: string;
  accountId: string;
  on: CivilDate;
  /** Positive when a `sign` was asked for; the stored amount otherwise. */
  cents: Cents;
  payee: string | null;
  /** The bank's own text, where a direct debit prints its creditor and its mandate (F4, owner). */
  note: string | null;
  categoryName: string | null;
}

/**
 * The visible movements of a window (spec §7.2: neither hidden nor gone from the provider), the one
 * query behind every "which movement is it" search: a subscription's charge, the interest the bank
 * paid, the money sent to a platform, a fund's debit. `sign` keeps the money going one way and turns
 * the amount positive; `types` keeps those types only (every type when absent, giroconti included);
 * `accountIds` those accounts only (every account when absent). Oldest first, unless `newestFirst`.
 */
export async function findMovements(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: {
    from: CivilDate;
    to: CivilDate;
    sign?: "in" | "out";
    types?: readonly TransactionType[];
    accountIds?: readonly string[];
    newestFirst?: boolean;
    limit?: number;
  },
): Promise<FoundMovement[]> {
  const order = input.newestFirst ? desc : asc;
  const query = getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
      note: transactions.note,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), userScoped(ctx).owns(categories)))
    .where(
      and(
        conditions(ctx, { from: input.from, to: input.to, accountIds: input.accountIds }),
        input.types === undefined ? undefined : inArray(transactions.type, [...input.types]),
        input.sign === "out"
          ? lt(transactions.amountCents, 0n)
          : input.sign === "in"
            ? gt(transactions.amountCents, 0n)
            : undefined,
      ),
    )
    .orderBy(order(transactions.occurredAt), order(transactions.id));
  const rows = await (input.limit === undefined ? query : query.limit(input.limit));
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    on: civilDateIn(row.occurredAt, ctx.timeZone),
    cents: input.sign === "out" ? -row.amountCents : row.amountCents,
    payee: row.payee,
    note: row.note,
    categoryName: row.categoryName,
  }));
}

/**
 * The movements a subscription's charge may be (spec §7.5): `expense` rows in the window, on the
 * paying account (every account when it is `null`), neither hidden nor gone from the provider and
 * never a giroconto (§7.2). The amount comes back positive; the day is the user's own.
 */
export async function chargeCandidates(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: {
    /** One account, several in one query (audit POC-3), or every account. */
    accountId: string | readonly string[] | null;
    from: CivilDate;
    to: CivilDate;
    /** `expense` by default; a PAC debit may reach the ledger as a giroconto too (F4). */
    types?: readonly TransactionType[];
  },
): Promise<FoundMovement[]> {
  return findMovements(ctx, {
    from: input.from,
    to: input.to,
    sign: "out",
    types: input.types ?? ["expense"],
    accountIds: input.accountId === null ? undefined : [input.accountId].flat(),
  });
}

/**
 * For each payee key, the most recent visible movement that is not a giroconto: the name, account
 * and category "Suggest from recurring payments" proposes (spec §7.5), since `recurring_patterns`
 * keeps only the key.
 */
export async function payeeSamples(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  payeeKeys: readonly string[],
): Promise<Map<string, { payee: string; accountId: string; categoryId: string | null; on: CivilDate }>> {
  if (payeeKeys.length === 0) return new Map();
  const key = payeeKeyExpression(transactions.payee);
  const rows = await getDb()
    .selectDistinctOn([key], {
      key,
      payee: transactions.payee,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(
      and(
        conditions(ctx, {}),
        isNotNull(transactions.payee),
        ne(transactions.type, "transfer"),
        inArray(key, [...payeeKeys]),
      ),
    )
    .orderBy(key, desc(transactions.occurredAt), desc(transactions.id));
  return new Map(
    rows.map((row) => [
      row.key,
      {
        payee: (row.payee as string).trim(),
        accountId: row.accountId,
        categoryId: row.categoryId,
        on: civilDateIn(row.occurredAt, ctx.timeZone),
      },
    ]),
  );
}

type RecurringPattern = typeof recurringPatterns.$inferSelect;

/**
 * The recurring patterns `refreshRecurrences` last stored (spec §7.2), soonest expected first, each
 * with the cadence its interval falls in: what another module reads instead of the table and the
 * bands (audit SUB-8).
 */
export async function recurrences(
  ctx: Pick<Ctx, "userId">,
): Promise<(RecurringPattern & { cadence: Cadence | null })[]> {
  const rows = await getDb()
    .select()
    .from(recurringPatterns)
    .where(userScoped(ctx).owns(recurringPatterns))
    .orderBy(asc(recurringPatterns.nextExpectedOn), asc(recurringPatterns.id));
  return rows.map((row) => ({ ...row, cadence: cadenceOfInterval(row.intervalDays) }));
}
