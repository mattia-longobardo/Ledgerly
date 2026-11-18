import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql, sum } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, civilDateIn, lastDayOfMonth, type MonthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { type TransactionType } from "../rules";
import { categories, recurringPatterns, transactions } from "../schema";
import { WAITING_FOR_CATEGORY, cents, conditions } from "./filters";

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

/** A movement as the subscription check sees it (spec §7.5): a positive amount, on a civil day. */
interface ChargeCandidate {
  id: string;
  accountId: string;
  on: CivilDate;
  cents: Cents;
  payee: string | null;
  /** The bank's own text, where a direct debit prints its creditor and its mandate (F4, owner). */
  note: string | null;
}

/**
 * The movements a subscription's charge may be (spec §7.5): `expense` rows in the window, on the
 * paying account (every account when it is `null`), neither hidden nor gone from the provider and
 * never a giroconto (§7.2). The amount comes back positive; the day is the user's own.
 */
export async function chargeCandidates(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: {
    accountId: string | null;
    from: CivilDate;
    to: CivilDate;
    /** `expense` by default; a PAC debit may reach Wallet as a giroconto too (F4). */
    types?: readonly TransactionType[];
  },
): Promise<ChargeCandidate[]> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
      note: transactions.note,
    })
    .from(transactions)
    .where(
      and(
        conditions(ctx, {
          from: input.from,
          to: input.to,
          accountIds: input.accountId === null ? undefined : [input.accountId],
        }),
        inArray(transactions.type, [...(input.types ?? ["expense"])]),
        lt(transactions.amountCents, 0n),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    on: civilDateIn(row.occurredAt, ctx.timeZone),
    cents: -row.amountCents,
    payee: row.payee,
    note: row.note,
  }));
}

/**
 * The income of an account in a window, with payee, note and category name (F4): where the interest the
 * bank really paid is looked for (plan F4 §3.6.1). Visible rows only, never a giroconto; the amount
 * is positive and the day the user's own.
 */
export async function incomeCandidates(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: { accountId: string; from: CivilDate; to: CivilDate },
): Promise<
  {
    id: string;
    on: CivilDate;
    cents: Cents;
    payee: string | null;
    note: string | null;
    categoryName: string | null;
  }[]
> {
  const rows = await getDb()
    .select({
      id: transactions.id,
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
        conditions(ctx, { from: input.from, to: input.to, accountIds: [input.accountId] }),
        eq(transactions.type, "income"),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  return rows.map((row) => ({
    id: row.id,
    on: civilDateIn(row.occurredAt, ctx.timeZone),
    cents: row.amountCents,
    payee: row.payee,
    note: row.note,
    categoryName: row.categoryName,
  }));
}

/**
 * What a movement on an investment platform may be linked to (the investments page): every visible
 * bank movement of the window going the given way — `out` for money sent to a platform, `in` for
 * money that came back — giroconti included, since a transfer to a broker is often booked as one.
 * The amount comes back positive and the day is the user's own; newest first.
 */
export async function linkCandidates(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: { direction: "in" | "out"; from: CivilDate; to: CivilDate; limit?: number },
): Promise<{ id: string; accountId: string; on: CivilDate; cents: Cents; payee: string | null }[]> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
    })
    .from(transactions)
    .where(
      and(
        conditions(ctx, { from: input.from, to: input.to }),
        input.direction === "out" ? lt(transactions.amountCents, 0n) : sql`${transactions.amountCents} > 0`,
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(input.limit ?? 300);
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    on: civilDateIn(row.occurredAt, ctx.timeZone),
    cents: row.amountCents < 0n ? -row.amountCents : row.amountCents,
    payee: row.payee,
  }));
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
  const key = sql<string>`lower(regexp_replace(${transactions.payee}, '\\s+', '', 'g'))`;
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

/** The recurring patterns `refreshRecurrences` last stored (spec §7.2), soonest expected first. */
export async function listRecurringPatterns(ctx: Pick<Ctx, "userId">): Promise<RecurringPattern[]> {
  return getDb()
    .select()
    .from(recurringPatterns)
    .where(userScoped(ctx).owns(recurringPatterns))
    .orderBy(asc(recurringPatterns.nextExpectedOn), asc(recurringPatterns.id));
}
