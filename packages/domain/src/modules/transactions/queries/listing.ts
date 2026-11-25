import { and, asc, count, eq, ne, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Account, accountNames as namesOf, listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { monthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { categoryStateOf, isHidden } from "../rules";
import { categories, transactions } from "../schema";
import {
  WAITING_FOR_CATEGORY,
  boundedLimit,
  conditions,
  dayExpression,
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
import { abs } from "../../../shared/money";
import { excludedOf, gather, splitColumns, splitIfForeign, splitPositions, totallerFor } from "./totals";

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

/** One page of the rows, ordered by `ordered`'s names when the sort is the account's. */
function pageOf(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters,
  ordered: readonly Account[],
) {
  return getDb()
    .select({
      transaction: transactions,
      categoryName: categories.name,
      categoryColor: categories.color,
      // The person's day, by Postgres: the same zone rules as every total by day, without a
      // formatter per row in Node (audit TRX-11).
      on: dayExpression(ctx.timeZone),
    })
    .from(transactions)
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), userScoped(ctx).owns(categories)))
    .where(conditions(ctx, filters))
    .orderBy(...ordering(filters, ordered))
    .limit(boundedLimit(filters.limit))
    .offset(Math.max(0, Math.trunc(filters.offset ?? 0)));
}

/**
 * The filtered list. `limit` is bounded, so a caller cannot ask for the whole table by mistake;
 * `summary` tells the truth about the range whatever the page holds. `reading` is the person's
 * accounts, archived ones included, when the caller reads them anyway (audit TRX-11).
 */
export async function listTransactions(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
  reading: Promise<Account[]> = listAccounts(ctx, { includeArchived: true }),
): Promise<TransactionRow[]> {
  // The table shows the accounts' names; only the account sort needs them before the rows are read,
  // so every other order reads them beside the rows (audit TRX-11).
  const sortedByAccount = (filters.sort ?? "date") === "account";
  const [accounts, rows] = await Promise.all([
    reading,
    (sortedByAccount ? reading : Promise.resolve([])).then((ordered) => pageOf(ctx, filters, ordered)),
  ]);
  const accountNames = namesOf(accounts);
  const chips = await labelsFor(
    ctx,
    rows.map((row) => row.transaction.id),
  );

  return rows.map(({ transaction, categoryName, categoryColor, on }) => {
    const categoryState = categoryStateOf(transaction);
    return {
      id: transaction.id,
      accountId: transaction.accountId,
      accountName: accountNames.get(transaction.accountId) ?? null,
      occurredAt: transaction.occurredAt,
      on,
      timeKnown: transaction.timeKnown,
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
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  filters: TransactionFilters = {},
): Promise<TransactionsSummary> {
  const rows = await splitIfForeign((split) =>
    getDb()
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
        ...splitColumns(ctx, split),
      })
      .from(transactions)
      .where(conditions(ctx, withoutHidden(filters)))
      .groupBy(...splitPositions(6, split)),
  );
  const [range] = gather(rows, () => "range", await totallerFor(ctx, rows));
  const counted = (key: "transfers" | "unpaired") => rows.reduce((sum, row) => sum + Number(row[key]), 0);
  return {
    count: range?.count ?? 0,
    incomeCents: range?.sum((row) => row.incomeCents) ?? 0n,
    expenseCents: range?.sum((row) => row.expenseCents) ?? 0n,
    netCents: range?.sum((row) => row.netCents) ?? 0n,
    transferCount: counted("transfers"),
    unpairedTransferCount: counted("unpaired"),
    ...excludedOf(range?.excluded ?? 0),
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
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  filters: TransactionFilters = {},
): Promise<MonthTotal[]> {
  const month = monthExpression(ctx.timeZone);
  const rows = await splitIfForeign((split) =>
    getDb()
      .select({
        month,
        total: count(),
        // The month's cash flow, as the header's net: a paired giroconto cancels itself out.
        netCents: sum(transactions.amountCents),
        ...splitColumns(ctx, split),
      })
      .from(transactions)
      .where(conditions(ctx, withoutHidden(filters)))
      // By position: the same expression is written differently in a select list and in a
      // `GROUP BY`, and Postgres compares the two textually.
      .groupBy(sql`1`, ...splitPositions(3, split))
      .orderBy(sql`1 desc`),
  );
  const months = gather(rows, (row) => row.month, await totallerFor(ctx, rows));
  return months.map(({ row, count, excluded, sum }) => ({
    month: monthKey(row.month),
    count,
    netCents: sum((row) => row.netCents),
    ...excludedOf(excluded),
  }));
}

/**
 * The "By category" card (spec §7.2), biggest slice first. Transfers are left out: a giroconto is
 * not spending, and its two legs would cancel out inside whatever category they landed in. Hidden
 * and gone-from-provider rows are left out too, whatever "Show hidden" says: the card is a total.
 */
export async function categoryTotals(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  filters: TransactionFilters = {},
): Promise<CategoryTotal[]> {
  // The slice's group comes along (F2.5), archived or not: a movement filed under a sub-category of
  // an archived group still belongs to that group in the card.
  const parents = alias(categories, "parents");
  const rows = await splitIfForeign((split) =>
    getDb()
      .select({
        categoryId: transactions.categoryId,
        name: categories.name,
        color: categories.color,
        parentId: categories.parentId,
        parentName: parents.name,
        parentColor: parents.color,
        total: count(),
        totalCents: sum(transactions.amountCents),
        ...splitColumns(ctx, split),
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
        ...splitPositions(8, split),
      )
      .orderBy(asc(categories.name), asc(transactions.categoryId)),
  );

  const groups = gather(rows, (row) => String(row.categoryId), await totallerFor(ctx, rows));
  const slices = groups.map(({ row, count, excluded, sum }) => ({
    categoryId: row.categoryId,
    name: row.name,
    color: row.color,
    parentId: row.parentId,
    parentName: row.parentName,
    parentColor: row.parentColor,
    count,
    totalCents: sum((row) => row.totalCents),
    ...excludedOf(excluded),
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

/** How many movements of every date wait for a category (rewrite plan R5e, «Da fare»). */
export async function waitingForCategory(ctx: Pick<Ctx, "userId" | "timeZone">): Promise<number> {
  return (await countAllAndWaiting(ctx)).review.count;
}
