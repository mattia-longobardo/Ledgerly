import { and, asc, count, eq, ne, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { listAccounts } from "../../accounts/queries";
import type { Ctx } from "../../../platform/context";
import { civilDateIn, monthKey } from "../../../platform/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../platform/money";
import { categoryStateOf, isHidden } from "../rules";
import { categories, transactions } from "../schema";
import {
  WAITING_FOR_CATEGORY,
  abs,
  boundedLimit,
  cents,
  conditions,
  labelsFor,
  monthExpression,
  ordering,
  shareOf,
  type CategoryTotal,
  type MonthTotal,
  type TransactionFilters,
  type TransactionRow,
  type TransactionsSummary,
  withoutHidden,
} from "./filters";

/** The movements of a range that wait for a category: how many, how many with a suggestion, their sum. */
export interface WaitingForCategory {
  count: number;
  suggested: number;
  cents: Cents;
}

/**
 * How many movements the user has at all, and the ones of the range that wait for a category
 * (rewrite plan N3) — one statement: the second is a sub-query of the first, answered by the
 * partial index on the waiting movements, so the notice of Expenses costs the screen no read of
 * its own. The range and the accounts narrow it; the other filters are about the list.
 */
export async function countAllAndWaiting(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<{ total: number; review: WaitingForCategory }> {
  const waiting = getDb()
    .select({
      packed: sql`json_build_array(count(*), count(*) filter (where ${transactions.suggestedCategoryId} is not null), coalesce(sum(${transactions.amountCents}), 0)::text)`,
    })
    .from(transactions)
    .where(
      and(
        conditions(ctx, { from: filters.from, to: filters.to, accountIds: filters.accountIds }),
        WAITING_FOR_CATEGORY,
      ),
    );
  const [row] = await getDb()
    .select({ total: count(), waiting: sql<[number, number, string]>`(${waiting})` })
    .from(transactions)
    .where(userScoped(ctx).owns(transactions));
  const [waitingCount, suggested, sum] = row?.waiting ?? [0, 0, "0"];
  return {
    total: Number(row?.total ?? 0),
    review: { count: Number(waitingCount), suggested: Number(suggested), cents: BigInt(sum) },
  };
}

/** How many movements the user has at all: the "Nothing synced yet" answer (spec §7.2). */
export async function countAllTransactions(ctx: Pick<Ctx, "userId">): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(transactions)
    .where(userScoped(ctx).owns(transactions));
  return Number(row?.total ?? 0);
}

/**
 * How many rows the filtered range holds for the **list**, `limit` aside: unlike a total this one
 * follows "Show hidden", because it is what the page compares its rows against to know whether
 * `limit` cut anything off.
 */
export async function countTransactions(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<number> {
  const [row] = await getDb().select({ total: count() }).from(transactions).where(conditions(ctx, filters));
  return Number(row?.total ?? 0);
}

/**
 * The filtered list. `limit` is bounded, so a caller cannot ask for the whole table by mistake;
 * `summary` tells the truth about the range whatever the page holds.
 */
export async function listTransactions(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<TransactionRow[]> {
  // The accounts come first: the table shows their names, and the account sort orders by them.
  const accounts = await listAccounts(ctx, { includeArchived: true });
  const rows = await getDb()
    .select({
      transaction: transactions,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(transactions)
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), userScoped(ctx).owns(categories)))
    .where(conditions(ctx, filters))
    .orderBy(...ordering(filters, accounts))
    .limit(boundedLimit(filters.limit))
    .offset(Math.max(0, Math.trunc(filters.offset ?? 0)));

  const chips = await labelsFor(
    ctx,
    rows.map((row) => row.transaction.id),
  );
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

  return rows.map(({ transaction, categoryName, categoryColor }) => {
    const categoryState = categoryStateOf(transaction);
    return {
      id: transaction.id,
      accountId: transaction.accountId,
      accountName: accountNames.get(transaction.accountId) ?? null,
      occurredAt: transaction.occurredAt,
      on: civilDateIn(transaction.occurredAt, ctx.timeZone),
      amountCents: transaction.amountCents,
      currency: transaction.currency,
      type: transaction.type,
      state: transaction.state,
      categoryId: transaction.categoryId,
      categoryName,
      categoryColor,
      payee: transaction.payee,
      note: transaction.note,
      labels: chips.get(transaction.id) ?? [],
      transferGroupId: transaction.transferGroupId,
      hiddenAt: transaction.hiddenAt,
      removedUpstreamAt: transaction.removedUpstreamAt,
      locallyEdited: transaction.locallyEdited,
      origin: transaction.origin,
      sendState: transaction.sendState,
      categoryState,
      categoryIsOwn: transaction.categoryKey !== null,
      categoryReason:
        (categoryState === "automatic" || categoryState === "suggestion") &&
        transaction.categoryReason !== null
          ? { code: transaction.categoryReason, params: transaction.categoryReasonParams ?? {} }
          : null,
      suggestedCategoryId: categoryState === "suggestion" ? transaction.suggestedCategoryId : null,
      hidden: isHidden(transaction),
      edited: transaction.locallyEdited.length > 0,
    };
  });
}

/**
 * The header of the page over the whole filtered range, hidden and gone-from-provider rows left out
 * whatever "Show hidden" says (spec §7.2). Income and expenses are summed by type, so a transfer
 * never reaches either of them nor the net (F2.5); it is only counted, to be named in the header.
 */
export async function transactionsSummary(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<TransactionsSummary> {
  const [row] = await getDb()
    .select({
      total: count(),
      incomeCents: sum(
        sql`case when ${transactions.type} = 'income' then ${transactions.amountCents} else 0 end`,
      ),
      expenseCents: sum(
        sql`case when ${transactions.type} = 'expense' then ${transactions.amountCents} else 0 end`,
      ),
      netCents: sum(transactions.amountCents),
      transfers: sql<string>`count(*) filter (where ${transactions.type} = 'transfer')`,
      unpaired: sql<string>`count(*) filter (where ${transactions.type} = 'transfer' and ${transactions.transferGroupId} is null)`,
    })
    .from(transactions)
    .where(conditions(ctx, withoutHidden(filters)));
  const incomeCents = cents(row?.incomeCents ?? null);
  const expenseCents = cents(row?.expenseCents ?? null);
  return {
    count: Number(row?.total ?? 0),
    incomeCents,
    expenseCents,
    netCents: cents(row?.netCents ?? null),
    transferCount: Number(row?.transfers ?? 0),
    unpairedTransferCount: Number(row?.unpaired ?? 0),
  };
}

/**
 * One row per month of the filtered range, newest first. The month is the user's own
 * (`date_trunc` on the instant shifted into their zone), never a UTC month (spec §4.3).
 *
 * This is the only answer to "how much is this month": `expensesView` builds the table's month
 * headers from it rather than summing the page, because a page is cut by `limit` and a header
 * summing it would print a wrong amount in the same shape as a right one.
 */
export async function monthlyTotals(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<MonthTotal[]> {
  const month = monthExpression(ctx.timeZone);
  const rows = await getDb()
    .select({
      month,
      total: count(),
      // The month's cash flow, as the header's net: a paired giroconto cancels itself out.
      netCents: sum(transactions.amountCents),
    })
    .from(transactions)
    .where(conditions(ctx, withoutHidden(filters)))
    // By position: the same expression is written differently in a select list and in a
    // `GROUP BY`, and Postgres compares the two textually.
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`);
  return rows.map((row) => ({
    month: monthKey(row.month),
    count: Number(row.total),
    netCents: cents(row.netCents),
  }));
}

/**
 * The "By category" card (spec §7.2), biggest slice first. Transfers are left out: a giroconto is
 * not spending, and its two legs would cancel out inside whatever category they landed in. Hidden
 * and gone-from-provider rows are left out too, whatever "Show hidden" says: the card is a total.
 */
export async function categoryTotals(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<CategoryTotal[]> {
  // The slice's group comes along (F2.5), archived or not: a movement filed under a sub-category of
  // an archived group still belongs to that group in the card.
  const parents = alias(categories, "parents");
  const rows = await getDb()
    .select({
      categoryId: transactions.categoryId,
      name: categories.name,
      color: categories.color,
      parentId: categories.parentId,
      parentName: parents.name,
      parentColor: parents.color,
      total: count(),
      totalCents: sum(transactions.amountCents),
    })
    .from(transactions)
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), userScoped(ctx).owns(categories)))
    .leftJoin(parents, and(eq(parents.id, categories.parentId), userScoped(ctx).owns(parents)))
    .where(and(conditions(ctx, withoutHidden(filters)), ne(transactions.type, "transfer")))
    .groupBy(
      transactions.categoryId,
      categories.name,
      categories.color,
      categories.parentId,
      parents.name,
      parents.color,
    )
    .orderBy(asc(categories.name), asc(transactions.categoryId));

  const slices = rows.map((row) => ({
    categoryId: row.categoryId,
    name: row.name,
    color: row.color,
    parentId: row.parentId,
    parentName: row.parentName,
    parentColor: row.parentColor,
    count: Number(row.total),
    totalCents: cents(row.totalCents),
  }));
  const whole = slices.reduce<Cents>((sum, slice) => sum + abs(slice.totalCents), 0n);
  return slices
    .map((slice) => ({ ...slice, share: shareOf(slice.totalCents, whole) }))
    .sort(
      (a, b) =>
        Number(abs(b.totalCents) - abs(a.totalCents)) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        (a.categoryId ?? "").localeCompare(b.categoryId ?? ""),
    );
}
