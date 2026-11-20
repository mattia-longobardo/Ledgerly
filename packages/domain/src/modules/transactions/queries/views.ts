import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, type MonthKey, monthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { type TransactionType } from "../rules";
import type { RuleCondition } from "../categorize/user-rules";
import { categories, categoryRules, transactions } from "../schema";
import { listCategories, listLabels } from "../taxonomy";
import {
  boundedLimit,
  conditions,
  dayExpression,
  escapeLike,
  monthExpression,
  type ExpensesView,
  type Facets,
  type MonthGroup,
  type MonthTotal,
  type TransactionFilters,
  type TransactionRow,
  withoutHidden,
} from "./filters";
import {
  categoryTotals,
  countAllAndWaiting,
  countTransactions,
  listTransactions,
  monthlyTotals,
  transactionsSummary,
} from "./listing";
import { gather, splitColumns, splitIfForeign, splitPositions, totallerFor } from "./totals";

/** The money of one category in one macro (categories-and-rules.md §5.3): `null` is no category. */
export interface CategoryMacroTotal {
  categoryId: string | null;
  /** The movement's own type: a movement counts in the macro of its type, as in Expenses. */
  type: TransactionType;
  count: number;
  totalCents: Cents;
  /** The positive and the negative movements apart: what Transfers shows as "In" and "Out". */
  inCents: Cents;
  outCents: Cents;
}

/**
 * The totals of the page of the categories (categories-and-rules.md §5.3): one row for each
 * category and type, over the filtered range, hidden and gone-from-provider rows left out as in
 * every total. Summed by the movement's type, so the total of Expenses here is the header's.
 */
export async function categoryMacroTotals(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  filters: TransactionFilters = {},
): Promise<CategoryMacroTotal[]> {
  const rows = await splitIfForeign((split) =>
    getDb()
      .select({
        categoryId: transactions.categoryId,
        type: transactions.type,
        total: count(),
        totalCents: sum(transactions.amountCents),
        inCents: sum(
          sql`case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end`,
        ),
        outCents: sum(
          sql`case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end`,
        ),
        ...splitColumns(ctx, split),
      })
      .from(transactions)
      .where(conditions(ctx, withoutHidden(filters)))
      .groupBy(transactions.categoryId, transactions.type, ...splitPositions(6, split))
      .orderBy(asc(transactions.categoryId), asc(transactions.type)),
  );
  const groups = gather(rows, (row) => `${row.categoryId}|${row.type}`, await totallerFor(ctx, rows));
  return groups.map(({ row, count, sum }) => ({
    categoryId: row.categoryId,
    type: row.type,
    count,
    totalCents: sum((row) => row.totalCents),
    inCents: sum((row) => row.inCents),
    outCents: sum((row) => row.outCents),
  }));
}

/** What one group of categories spent in one day or month (F2.5): the Expenses chart's unit. */
interface SpendingPoint {
  /** The day, or the first of the month, in the user's own zone. */
  bucket: CivilDate;
  /** The group — a sub-category counts in its parent — or `null` for the uncategorised. */
  groupId: string | null;
  groupName: string | null;
  groupColor: string | null;
  /** What was spent, as a positive amount. */
  cents: Cents;
}

/**
 * The spending of the filtered range per day or per month and per group of categories (spec §7.2,
 * F2.5), for the stacked chart over the Expenses table. Only `expense` movements count — a
 * giroconto is not spending, and neither is income — and hidden or gone-from-provider rows stay
 * out as in every total. The type filter is set aside: the chart is about spending whatever the
 * list shows; every other filter narrows it like the list.
 */
export async function spendingOverTime(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  filters: TransactionFilters,
  grain: "day" | "month",
  // The page of one category draws its own macro (categories-and-rules.md §5.4): what came in for
  // Income, what went out for Transfers. Expenses keeps the spending.
  type: TransactionType = "expense",
): Promise<SpendingPoint[]> {
  const parents = alias(categories, "spending_parents");
  const bucket = grain === "day" ? dayExpression(ctx.timeZone) : monthExpression(ctx.timeZone);
  const rows = await splitIfForeign((split) =>
    getDb()
      .select({
        bucket,
        groupId: sql<string | null>`coalesce(${categories.parentId}, ${transactions.categoryId})`,
        groupName: sql<string | null>`coalesce(${parents.name}, ${categories.name})`,
        groupColor: sql<
          string | null
        >`case when ${categories.parentId} is null then ${categories.color} else ${parents.color} end`,
        cents:
          type === "transfer"
            ? sum(sql`case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end`)
            : sum(transactions.amountCents),
        ...splitColumns(ctx, split),
      })
      .from(transactions)
      .leftJoin(categories, and(eq(categories.id, transactions.categoryId), userScoped(ctx).owns(categories)))
      .leftJoin(parents, and(eq(parents.id, categories.parentId), userScoped(ctx).owns(parents)))
      .where(
        and(conditions(ctx, withoutHidden({ ...filters, types: undefined })), eq(transactions.type, type)),
      )
      // By position, for the same reason as `monthlyTotals`.
      .groupBy(sql`1`, sql`2`, sql`3`, sql`4`, ...splitPositions(5, split))
      .orderBy(sql`1`, sql`2`),
  );
  const points = gather(rows, (row) => `${row.bucket}|${row.groupId}`, await totallerFor(ctx, rows));
  return points.map(({ row, sum }) => ({
    bucket: row.bucket,
    groupId: row.groupId,
    groupName: row.groupName,
    groupColor: row.groupColor,
    cents: type === "income" ? sum((row) => row.cents) : -sum((row) => row.cents),
  }));
}

/**
 * The counts behind the account, category and type chips of the filter bar (spec §7.2). A chip
 * promises rows in the list rather than an amount, so these follow "Show hidden" the way the list
 * does.
 */
export async function facetCounts(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<Facets> {
  const [accountRows, categoryRows, typeRows] = await Promise.all([
    getDb()
      .select({ accountId: transactions.accountId, total: count() })
      .from(transactions)
      .where(conditions(ctx, { ...filters, accountIds: undefined }))
      .groupBy(transactions.accountId)
      .orderBy(asc(transactions.accountId)),
    getDb()
      .select({ categoryId: transactions.categoryId, total: count() })
      .from(transactions)
      .where(conditions(ctx, { ...filters, categoryIds: undefined }))
      .groupBy(transactions.categoryId)
      .orderBy(asc(transactions.categoryId)),
    getDb()
      .select({ type: transactions.type, total: count() })
      .from(transactions)
      .where(conditions(ctx, { ...filters, types: undefined }))
      .groupBy(transactions.type)
      .orderBy(asc(transactions.type)),
  ]);
  return {
    accounts: accountRows.map((row) => ({ accountId: row.accountId, count: Number(row.total) })),
    categories: categoryRows.map((row) => ({
      categoryId: row.categoryId,
      count: Number(row.total),
    })),
    types: typeRows.map((row) => ({ type: row.type, count: Number(row.total) })),
  };
}

/**
 * The payees the ⌘K palette searches (spec §7.2). An empty term answers with the most frequent
 * ones, which is what an empty palette should offer; hidden movements never take part.
 */
export async function searchPayees(
  ctx: Pick<Ctx, "userId">,
  query: string,
  limit = 10,
): Promise<{ payee: string; count: number }[]> {
  const term = query.trim();
  const total = count();
  const rows = await getDb()
    .select({ payee: transactions.payee, total })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        isNotNull(transactions.payee),
        ne(transactions.payee, ""),
        isNull(transactions.hiddenAt),
        isNull(transactions.removedUpstreamAt),
        term === "" ? undefined : ilike(transactions.payee, `%${escapeLike(term)}%`),
      ),
    )
    .groupBy(transactions.payee)
    .orderBy(desc(total), asc(transactions.payee))
    .limit(boundedLimit(limit));
  return rows.map((row) => ({ payee: row.payee as string, count: Number(row.total) }));
}

/**
 * The table's month headers: one per month the page carries rows for, in the order the rows meet
 * them, each carrying the range's own count and total.
 *
 * The split is deliberate. `rows` decides **which** rows a month shows, because that is all a
 * page knows; `totals` decides **how many** it holds and **how much** they add up to, because
 * that is the answer `monthlyTotals` computes in SQL over the whole range. Summing the page
 * instead made the header of the month at the `limit` boundary print a wrong amount of money —
 * always the oldest month, the one reached by scrolling down — in the same shape and with the
 * same authority as a right one. A header that counts more than it shows is a true statement the
 * page can render; a header that under-counts by €2.640 is not (review B1, spec §4.3).
 *
 * A month `totals` does not mention holds nothing the totals count: zero and `0n` are the honest
 * header over rows that are all hidden, which is what "Show hidden" puts on screen.
 */
export function monthGroups(rows: readonly TransactionRow[], totals: readonly MonthTotal[]): MonthGroup[] {
  const byMonth = new Map(totals.map((total) => [total.month, total]));
  const groups = new Map<MonthKey, MonthGroup>();
  for (const row of rows) {
    const month = monthKey(row.on);
    const group = groups.get(month);
    if (group) {
      group.rows.push(row);
      continue;
    }
    const range = byMonth.get(month);
    groups.set(month, {
      month,
      count: range?.count ?? 0,
      netCents: range?.netCents ?? 0n,
      rows: [row],
    });
  }
  return [...groups.values()];
}

/**
 * Everything the Expenses screen renders, read once (the shape `accountsView` has in F1).
 *
 * The month groups carry the rows the list brought back and the counts and totals of the whole
 * range (`monthGroups`); `summary` and `breakdown` describe the range too, and `truncated` says
 * when the page holds fewer rows than the range has. Month groups only mean anything under the
 * date sort, so a caller sorting by amount or payee should render `rows` flat.
 */
export async function expensesView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  filters: TransactionFilters = {},
): Promise<ExpensesView> {
  // One read of the accounts for the list and the page (audit TRX-11).
  const reading = listAccounts(ctx, { includeArchived: true });
  const [
    rows,
    listCount,
    summary,
    monthTotals,
    breakdown,
    facets,
    hasAny,
    accounts,
    categoryList,
    labelList,
  ] = await Promise.all([
    listTransactions(ctx, filters, reading),
    countTransactions(ctx, filters),
    transactionsSummary(ctx, filters),
    monthlyTotals(ctx, filters),
    categoryTotals(ctx, filters),
    facetCounts(ctx, filters),
    countAllAndWaiting(ctx, filters),
    reading,
    listCategories(ctx),
    listLabels(ctx),
  ]);

  return {
    rows,
    months: monthGroups(rows, monthTotals),
    breakdown,
    facets,
    summary,
    listCount,
    truncated: rows.length < listCount,
    hasAny: hasAny.total > 0,
    review: hasAny.review,
    accounts,
    categories: categoryList,
    labels: labelList,
  };
}

/**
 * How many movements each account has and the day of its first one, in the person's zone: what
 * the outcome of a bank's first reading says for every account (rewrite plan N1). An account
 * with no movement is absent from the map.
 */
export async function movementSpanByAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
): Promise<Map<string, { count: number; first: CivilDate }>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      accountId: transactions.accountId,
      count: sql<number>`count(*)::int`,
      first: dayExpression(ctx.timeZone, sql`min(${transactions.occurredAt})`),
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        isNull(transactions.removedUpstreamAt),
      ),
    )
    .groupBy(transactions.accountId)
    .orderBy(asc(transactions.accountId));
  return new Map(rows.map((row) => [row.accountId, { count: row.count, first: row.first }]));
}

/**
 * The person's rules as the export writes them (categories-and-rules.md §4.8): order, name, state,
 * conditions and action, with names in place of ids. A rule deleted for "Undo" is not exported.
 */
export async function rulesForExport(ctx: Pick<Ctx, "userId">): Promise<
  {
    position: number;
    name: string;
    active: boolean;
    conditions: RuleCondition[];
    category: string;
    labels: string[];
    note: string | null;
  }[]
> {
  const [rows, own] = await Promise.all([
    getDb()
      .select({
        name: categoryRules.name,
        active: categoryRules.active,
        conditions: categoryRules.conditions,
        labelIds: categoryRules.labelIds,
        note: categoryRules.note,
        category: categories.name,
        archivedAt: categories.archivedAt,
      })
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .where(and(userScoped(ctx).owns(categoryRules), isNull(categoryRules.deletedAt)))
      .orderBy(asc(categoryRules.position), asc(categoryRules.id)),
    listLabels(ctx),
  ]);
  const labelName = new Map(own.map((label) => [label.id, label.name]));
  return rows.map(({ labelIds, archivedAt, active, ...rule }, index) => ({
    ...rule,
    position: index + 1,
    active: active && archivedAt === null,
    labels: labelIds.flatMap((id) => labelName.get(id) ?? []),
  }));
}

type SpendingGroupBy = "category" | "macro" | "day" | "month";

/**
 * One group of `spending` (audit TRX-3, TRX-4): the same shape whatever the grouping, with `null`
 * for what a grouping does not say. `share` is the card's and nobody else's: computed here, once.
 */
export interface SpendingGroup {
  bucket: CivilDate | null;
  categoryId: string | null;
  name: string | null;
  color: string | null;
  parentId: string | null;
  parentName: string | null;
  parentColor: string | null;
  type: TransactionType | null;
  count: number | null;
  totalCents: Cents;
  inCents: Cents | null;
  outCents: Cents | null;
  share: number | null;
}

const NO_GROUP = {
  bucket: null,
  categoryId: null,
  name: null,
  color: null,
  parentId: null,
  parentName: null,
  parentColor: null,
  type: null,
  count: null,
  inCents: null,
  outCents: null,
  share: null,
} as const;

/**
 * The money of a filtered range by one grouping: `category`, the «By category» card (giroconti
 * out, with the share); `macro`, each category in the macro of its movements' type; `day` and
 * `month`, the chart of one `type` (spending when none) by category group.
 */
export async function spending(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  filters: TransactionFilters,
  groupBy: SpendingGroupBy,
  type: TransactionType = "expense",
): Promise<SpendingGroup[]> {
  if (groupBy === "category") {
    return (await categoryTotals(ctx, filters)).map((slice) => ({ ...NO_GROUP, ...slice }));
  }
  if (groupBy === "macro") {
    return (await categoryMacroTotals(ctx, filters)).map((row) => ({ ...NO_GROUP, ...row }));
  }
  return (await spendingOverTime(ctx, filters, groupBy, type)).map((point) => ({
    ...NO_GROUP,
    bucket: point.bucket,
    categoryId: point.groupId,
    name: point.groupName,
    color: point.groupColor,
    totalCents: point.cents,
  }));
}
