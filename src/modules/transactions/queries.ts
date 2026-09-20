// modules/transactions/queries.ts — the read models Expenses renders (spec §7.2): the filtered
// list, the month groups, the "By category" card and the payee search the ⌘K palette uses. Every
// query is scoped with `userScoped(ctx)` and every list has a deterministic `ORDER BY`.
import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  gte,
  ne,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { listAccounts, type Account } from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import {
  addDays,
  type CivilDate,
  civilDateIn,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { isHidden, type TransactionType } from "./rules";
import { categories, labels, recurringPatterns, transactionLabels, transactions } from "./schema";
import { type Label, listCategories, listLabels, type TreeCategory } from "./taxonomy";

/** The stored row on its own; `Transaction` adds the label ids the rules reason about. */
export type TransactionRecord = typeof transactions.$inferSelect;

/**
 * A movement as the service hands it to `rules.ts`: the row plus its labels, which live in a join
 * table. Structurally a `StoredTransaction`, so it can be passed to the merge rules as it is.
 */
export interface Transaction extends TransactionRecord {
  labelIds: string[];
}

export interface TransactionLabel {
  id: string;
  name: string;
  color: string | null;
}

/**
 * One line of the Expenses table. The names of the account, the category and the labels travel
 * with the row because the table shows them, and `hidden`/`edited` are the badges of §7.2 already
 * decided by `rules.ts` rather than recomputed in a component.
 */
export interface TransactionRow {
  id: string;
  accountId: string;
  accountName: string | null;
  occurredAt: Date;
  /** The day the person saw it, in their own time zone (spec §4.3): never a UTC day. */
  on: CivilDate;
  amountCents: Cents;
  currency: string;
  type: TransactionType;
  state: TransactionRecord["state"];
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  payee: string | null;
  note: string | null;
  labels: TransactionLabel[];
  transferGroupId: string | null;
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
  locallyEdited: string[];
  hidden: boolean;
  edited: boolean;
}

export type TransactionSort = "date" | "amount" | "payee" | "account" | "category";
export type SortDirection = "asc" | "desc";

/**
 * What the Expenses controls narrow the list down to (spec §7.2). Every field is optional: an
 * empty filter is the whole history, hidden rows excluded.
 *
 * `from`/`to` are civil dates in the user's time zone, both ends included. `categoryIds` may
 * carry `null`, which is the "Uncategorised" chip — a real choice, not a missing value.
 * `labelIds` matches a movement carrying **any** of them.
 */
export interface TransactionFilters {
  from?: CivilDate;
  to?: CivilDate;
  accountIds?: readonly string[];
  categoryIds?: readonly (string | null)[];
  labelIds?: readonly string[];
  types?: readonly TransactionType[];
  payee?: string;
  includeHidden?: boolean;
  sort?: TransactionSort;
  direction?: SortDirection;
  limit?: number;
  offset?: number;
}

/**
 * The money of a range (spec §7.2, F2.5). Income and spending keep the giroconti out: moving money
 * between two of one's own accounts is neither. The net is the range's cash flow, every movement
 * summed, as Wallet reports it (2026-09-19): the two legs of a giroconto between accounts that are
 * both here cancel out, and a leg whose other side is elsewhere — or that Wallet filed under
 * another type — moved money all the same. `count` is every row, because it describes the list.
 */
export interface TransactionsSummary {
  count: number;
  incomeCents: Cents;
  expenseCents: Cents;
  /** Every movement summed, giroconti included: the cash flow Wallet shows. */
  netCents: Cents;
  /** How many of the rows are giroconti, so the header can say what it left out. */
  transferCount: number;
  /** Of those, the legs with no counterpart here: usually the other account is not linked. */
  unpairedTransferCount: number;
}

export interface MonthTotal {
  month: MonthKey;
  count: number;
  /** The month's cash flow, every movement summed like the header's net. */
  netCents: Cents;
}

/** One slice of the "By category" card: `null` everywhere is the uncategorised slice. */
export interface CategoryTotal {
  categoryId: string | null;
  name: string | null;
  color: string | null;
  /** The slice's group (F2.5), so the card can gather sub-categories under it; `null` for a group. */
  parentId: string | null;
  parentName: string | null;
  parentColor: string | null;
  count: number;
  totalCents: Cents;
  /** Percentage of the card, one decimal, over the absolute values of the slices. */
  share: number;
}

/**
 * How many movements each chip of the filter bar would bring back. Each dimension is counted with
 * its own filter dropped, the way a facet works: picking one account still shows how many the
 * others hold, so a chip never claims zero for something that is only hidden by itself.
 */
export interface Facets {
  accounts: { accountId: string; count: number }[];
  categories: { categoryId: string | null; count: number }[];
  types: { type: TransactionType; count: number }[];
}

/**
 * A month header in the table, with the rows the list actually carries for it.
 *
 * `count` and `totalCents` describe the **whole filtered range** for that month — they come from
 * `monthlyTotals`, computed in SQL with no `limit` — while `rows` is only what this page brought
 * back. So `rows.length` may be less than `count`, and that difference is the truth the page has
 * to tell rather than hide: the header's amount is the month's, not the page's.
 */
export interface MonthGroup {
  month: MonthKey;
  /** The movements the range holds for this month, hidden rows left out (spec §7.2). */
  count: number;
  /** Their net, over the range and not over `rows`, transfers left out. */
  netCents: Cents;
  /** The rows of this month the page carries: `rows.length <= count` when `limit` cut in. */
  rows: TransactionRow[];
}

export interface ExpensesView {
  rows: TransactionRow[];
  months: MonthGroup[];
  /** The card, over the whole filtered range rather than the page (transfers left out). */
  breakdown: CategoryTotal[];
  /** The counts behind the filter chips, each dimension counted with its own filter dropped. */
  facets: Facets;
  /**
   * The counts and totals of the whole filtered range, whatever `limit` cut off, with hidden and
   * gone-from-provider rows left out whatever "Show hidden" says (spec §7.2).
   */
  summary: TransactionsSummary;
  /**
   * How many rows the whole filtered range holds **for the list**: the same number as
   * `summary.count` unless "Show hidden" is on, when the list carries rows the totals leave out.
   * `rows` is a page of this, so this — not `summary.count` — is what the truncation notice
   * counts against.
   */
  listCount: number;
  /** `true` when `limit` stopped the list short of `listCount`. */
  truncated: boolean;
  /** Whether the user has any movement at all: tells "empty range" from "nothing synced yet". */
  hasAny: boolean;
  accounts: Account[];
  /**
   * The chips of the filter bar, in tree order (F2.5): archived categories stay out of a picker
   * (spec §7.2).
   */
  categories: TreeCategory[];
  labels: Label[];
}

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 2000;

/** A page size a caller cannot use to ask for the whole table by accident. */
export function boundedLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

/** A search term as a `LIKE` pattern: the wildcards a person typed are literal characters. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * A slice's share of a card, as a percentage with one decimal. Computed on integer cents and
 * over absolute values, so a card holding both signs still adds up to something meaningful and a
 * rounding cannot drift (spec §4.3).
 */
export function shareOf(part: Cents, whole: Cents): number {
  const total = whole < 0n ? -whole : whole;
  if (total === 0n) return 0;
  const value = part < 0n ? -part : part;
  return Number((value * 1000n) / total) / 10;
}

function abs(value: Cents): Cents {
  return value < 0n ? -value : value;
}

/** Midnight of a civil date in the user's own zone, as the instant the column is compared to. */
function dayStart(on: CivilDate, timeZone: string): SQL {
  return sql`(${on}::date)::timestamp at time zone ${timeZone}`;
}

/** The month key of a movement in the user's zone: `to_char` on the shifted instant. */
function monthExpression(timeZone: string): SQL<string> {
  return sql<string>`to_char(date_trunc('month', ${transactions.occurredAt} at time zone ${timeZone}), 'YYYY-MM-01')`;
}

const DEFAULT_DIRECTION: Record<TransactionSort, SortDirection> = {
  date: "desc",
  amount: "desc",
  payee: "asc",
  account: "asc",
  category: "asc",
};

/**
 * The `WHERE` of every read here, the user's scope first. A filter left out adds no condition;
 * `includeHidden` is the only one whose absence adds one, because hidden and gone-from-provider
 * rows are out of every list until "Show hidden" asks for them (spec §7.2).
 *
 * `includeHidden` decides what the **list** shows and nothing else: every total passes its
 * filters through `withoutHidden` first, so the flag can never reach a sum.
 */
function conditions(ctx: Pick<Ctx, "userId" | "timeZone">, filters: TransactionFilters): SQL {
  const parts: (SQL | undefined)[] = [userScoped(ctx).owns(transactions)];

  if (filters.from) parts.push(gte(transactions.occurredAt, dayStart(filters.from, ctx.timeZone)));
  if (filters.to) parts.push(lt(transactions.occurredAt, dayStart(addDays(filters.to, 1), ctx.timeZone)));
  if (filters.accountIds && filters.accountIds.length > 0) {
    parts.push(inArray(transactions.accountId, [...filters.accountIds]));
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const named = filters.categoryIds.filter((id): id is string => id !== null);
    const wantsUncategorised = filters.categoryIds.some((id) => id === null);
    const choices: (SQL | undefined)[] = [];
    if (named.length > 0) {
      choices.push(inArray(transactions.categoryId, named));
      // A group stands for its sub-categories too (spec §7.2, F2.5): the address keeps naming the
      // group alone, and what it covers is decided here, where the tree is.
      choices.push(
        inArray(
          transactions.categoryId,
          getDb()
            .select({ id: categories.id })
            .from(categories)
            .where(and(inArray(categories.parentId, named), userScoped(ctx).owns(categories))),
        ),
      );
    }
    if (wantsUncategorised) choices.push(isNull(transactions.categoryId));
    parts.push(or(...choices));
  }
  if (filters.labelIds && filters.labelIds.length > 0) {
    parts.push(
      exists(
        getDb()
          .select({ one: sql`1` })
          .from(transactionLabels)
          .where(
            and(
              eq(transactionLabels.transactionId, transactions.id),
              inArray(transactionLabels.labelId, [...filters.labelIds]),
              userScoped(ctx).owns(transactionLabels),
            ),
          ),
      ),
    );
  }
  if (filters.types && filters.types.length > 0) {
    parts.push(inArray(transactions.type, [...filters.types]));
  }
  const payee = filters.payee?.trim();
  if (payee) parts.push(ilike(transactions.payee, `%${escapeLike(payee)}%`));
  if (!filters.includeHidden) {
    parts.push(isNull(transactions.hiddenAt), isNull(transactions.removedUpstreamAt));
  }

  return and(...parts) as SQL;
}

/**
 * The same filters with "Show hidden" taken back off. §7.2 keeps hidden and gone-from-provider
 * rows out of totals, budgets, the subscription check and recurrence detection, and grants the
 * filter **visibility** only: a total that moved when the filter was switched on would be a
 * different answer to "how much is this" depending on a list control, which is exactly the one
 * source of truth §4.3 forbids splitting. Every sum in this file goes through here; the list,
 * the facet counts behind its chips and `listCount` do not, because they describe the rows on
 * screen rather than an amount.
 */
function withoutHidden(filters: TransactionFilters): TransactionFilters {
  return filters.includeHidden ? { ...filters, includeHidden: false } : filters;
}

/**
 * An order with the unknowns at the end whichever way it runs. Postgres' own default puts them
 * last ascending and first descending; a movement with no category or no payee belongs at the end
 * either way, because `null` is a missing value and not one that takes part in an order (§4.3).
 */
function nullsLast(expression: SQL | AnyPgColumn, direction: SortDirection): SQL {
  return direction === "asc" ? sql`${expression} asc nulls last` : sql`${expression} desc nulls last`;
}

/**
 * The account's **name** as an expression over `transactions` alone: a `CASE` built from the
 * accounts already read for this page.
 *
 * `accounts` is another module's table and this module may not join it (§4.2, enforced by
 * `src/architecture.test.ts`), so sorting on a joined `accounts.name` is not available. Mapping
 * the ids to their names here keeps the sort in SQL — which is what makes it agree with `limit`
 * and `offset` instead of sorting one page in memory — and lets Postgres compare the names with
 * the same collation it uses for a category or a payee. `null` for an id with no account left,
 * which `nullsLast` then puts at the end.
 */
function accountNameExpression(accounts: readonly Account[]): SQL | null {
  if (accounts.length === 0) return null;
  const branches = accounts.map((account) => sql`when ${account.id}::uuid then ${account.name}::text`);
  return sql`(case ${transactions.accountId} ${sql.join(branches, sql` `)} else null end)`;
}

/** The sort the header asked for, always closed by the id so two equal keys keep one order. */
function ordering(filters: TransactionFilters, accounts: readonly Account[]): SQL[] {
  const sort = filters.sort ?? "date";
  const direction = filters.direction ?? DEFAULT_DIRECTION[sort];
  const by = direction === "asc" ? asc : desc;
  const settle = [desc(transactions.occurredAt), asc(transactions.id)];
  if (sort === "amount") return [by(transactions.amountCents), ...settle];
  if (sort === "payee") return [nullsLast(transactions.payee, direction), ...settle];
  if (sort === "category") return [nullsLast(categories.name, direction), ...settle];
  if (sort === "account") {
    const name = accountNameExpression(accounts);
    // No accounts means no rows to order by one, so the plain date order is the whole answer.
    return name === null
      ? [desc(transactions.occurredAt), asc(transactions.id)]
      : [nullsLast(name, direction), ...settle];
  }
  return [by(transactions.occurredAt), asc(transactions.id)];
}

function cents(value: string | null): Cents {
  return value === null ? 0n : BigInt(value);
}

/** The label ids of each movement, for the rules; ordered so the array never churns. */
export async function labelIdsFor(
  ctx: Pick<Ctx, "userId">,
  transactionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const wanted = [...new Set(transactionIds)];
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select({ transactionId: transactionLabels.transactionId, labelId: transactionLabels.labelId })
    .from(transactionLabels)
    .where(and(inArray(transactionLabels.transactionId, wanted), userScoped(ctx).owns(transactionLabels)))
    .orderBy(asc(transactionLabels.transactionId), asc(transactionLabels.labelId));
  const byTransaction = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byTransaction.get(row.transactionId) ?? [];
    ids.push(row.labelId);
    byTransaction.set(row.transactionId, ids);
  }
  return byTransaction;
}

/** The labels of each movement with their names and colours, for the table's chips. */
export async function labelsFor(
  ctx: Pick<Ctx, "userId">,
  transactionIds: readonly string[],
): Promise<Map<string, TransactionLabel[]>> {
  const wanted = [...new Set(transactionIds)];
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select({
      transactionId: transactionLabels.transactionId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(transactionLabels)
    .innerJoin(labels, eq(labels.id, transactionLabels.labelId))
    .where(and(inArray(transactionLabels.transactionId, wanted), userScoped(ctx).owns(transactionLabels)))
    .orderBy(asc(transactionLabels.transactionId), asc(labels.name), asc(labels.id));
  const byTransaction = new Map<string, TransactionLabel[]>();
  for (const row of rows) {
    const list = byTransaction.get(row.transactionId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    byTransaction.set(row.transactionId, list);
  }
  return byTransaction;
}

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
 * the provider stopped returning does not: it is no longer in the balance the provider reads.
 */
export async function dailyNetByAccount(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountIds: readonly string[],
): Promise<Map<string, { on: CivilDate; cents: Cents }[]>> {
  if (accountIds.length === 0) return new Map();
  const day = sql<string>`to_char(${transactions.occurredAt} at time zone ${ctx.timeZone}, 'YYYY-MM-DD')`;
  const rows = await getDb()
    .select({ accountId: transactions.accountId, on: day, cents: sum(transactions.amountCents) })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        inArray(transactions.accountId, [...accountIds]),
        isNull(transactions.removedUpstreamAt),
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
 * What each category spent on each account in one month (spec §7.3, F3): the sum of the absolute
 * values of the month's `expense` movements, in the user's zone, hidden and gone-from-provider rows
 * left out and never a giroconto (only `expense` counts). `null` is the uncategorised; the amount
 * is positive. The budgets module reads it through here because `transactions` is this module's
 * table (§4.2).
 */
export async function monthSpending(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  month: MonthKey,
): Promise<{ categoryId: string | null; accountId: string; cents: Cents }[]> {
  const rows = await getDb()
    .select({
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      cents: sum(transactions.amountCents),
    })
    .from(transactions)
    .where(and(conditions(ctx, { from: month, to: lastDayOfMonth(month) }), eq(transactions.type, "expense")))
    .groupBy(transactions.categoryId, transactions.accountId)
    .orderBy(sql`${transactions.categoryId} asc nulls last`, asc(transactions.accountId));
  return rows.map((row) => ({
    categoryId: row.categoryId,
    accountId: row.accountId,
    cents: -cents(row.cents),
  }));
}

/** A movement as the subscription check sees it (spec §7.5): a positive amount, on a civil day. */
export interface ChargeCandidate {
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
 * The income of an account in a window, with payee and category name (F4): where the interest the
 * bank really paid is looked for (plan F4 §3.6.1). Visible rows only, never a giroconto; the amount
 * is positive and the day the user's own.
 */
export async function incomeCandidates(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: { accountId: string; from: CivilDate; to: CivilDate },
): Promise<{ id: string; on: CivilDate; cents: Cents; payee: string | null; categoryName: string | null }[]> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
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
    categoryName: row.categoryName,
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

export type RecurringPattern = typeof recurringPatterns.$inferSelect;

/** The recurring patterns `refreshRecurrences` last stored (spec §7.2), soonest expected first. */
export async function listRecurringPatterns(ctx: Pick<Ctx, "userId">): Promise<RecurringPattern[]> {
  return getDb()
    .select()
    .from(recurringPatterns)
    .where(userScoped(ctx).owns(recurringPatterns))
    .orderBy(asc(recurringPatterns.nextExpectedOn), asc(recurringPatterns.id));
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

  return rows.map(({ transaction, categoryName, categoryColor }) => ({
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
    hidden: isHidden(transaction),
    edited: transaction.locallyEdited.length > 0,
  }));
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

/** What one group of categories spent in one day or month (F2.5): the Expenses chart's unit. */
export interface SpendingPoint {
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
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters,
  grain: "day" | "month",
): Promise<SpendingPoint[]> {
  const parents = alias(categories, "spending_parents");
  const bucket =
    grain === "day"
      ? sql<string>`to_char(${transactions.occurredAt} at time zone ${ctx.timeZone}, 'YYYY-MM-DD')`
      : monthExpression(ctx.timeZone);
  const rows = await getDb()
    .select({
      bucket,
      groupId: sql<string | null>`coalesce(${categories.parentId}, ${transactions.categoryId})`,
      groupName: sql<string | null>`coalesce(${parents.name}, ${categories.name})`,
      groupColor: sql<
        string | null
      >`case when ${categories.parentId} is null then ${categories.color} else ${parents.color} end`,
      cents: sum(transactions.amountCents),
    })
    .from(transactions)
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), userScoped(ctx).owns(categories)))
    .leftJoin(parents, and(eq(parents.id, categories.parentId), userScoped(ctx).owns(parents)))
    .where(
      and(conditions(ctx, withoutHidden({ ...filters, types: undefined })), eq(transactions.type, "expense")),
    )
    // By position, for the same reason as `monthlyTotals`.
    .groupBy(sql`1`, sql`2`, sql`3`, sql`4`)
    .orderBy(sql`1`, sql`2`);
  return rows.map((row) => ({
    bucket: row.bucket,
    groupId: row.groupId,
    groupName: row.groupName,
    groupColor: row.groupColor,
    cents: -cents(row.cents),
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
  ctx: Pick<Ctx, "userId" | "timeZone">,
  filters: TransactionFilters = {},
): Promise<ExpensesView> {
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
    listTransactions(ctx, filters),
    countTransactions(ctx, filters),
    transactionsSummary(ctx, filters),
    monthlyTotals(ctx, filters),
    categoryTotals(ctx, filters),
    facetCounts(ctx, filters),
    countAllTransactions(ctx),
    listAccounts(ctx, { includeArchived: true }),
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
    hasAny: hasAny > 0,
    accounts,
    categories: categoryList,
    labels: labelList,
  };
}
