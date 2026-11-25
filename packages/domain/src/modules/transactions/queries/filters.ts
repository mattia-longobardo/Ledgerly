import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  lt,
  gte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { type AnyPgColumn } from "drizzle-orm/pg-core";
import { type Account } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { groupBy } from "../../../shared/collections";
import { addDays, type CivilDate, type MonthKey } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { abs, type Cents, share } from "../../../shared/money";
import { type CategoryState, type TransactionType } from "../rules";
import { categories, duplicateAccounts, labels, transactionLabels, transactions } from "../schema";
import { type Label, type TreeCategory } from "../taxonomy";
import { type WaitingForCategory } from "./listing";

/** A movement the cascade has read and that still has no category: what "To review" lists. */
export const WAITING_FOR_CATEGORY = sql`${transactions.categoryId} is null and ${transactions.categoryKey} is not null and ${transactions.type} <> 'transfer' and ${transactions.hiddenAt} is null and ${transactions.removedUpstreamAt} is null`;

/** The stored row on its own; `Transaction` adds the label ids the rules reason about. */
type TransactionRecord = typeof transactions.$inferSelect;

/**
 * A movement as the service hands it to `rules.ts`: the row plus its labels, which live in a join
 * table. Structurally a `StoredTransaction`, so it can be passed to the merge rules as it is.
 */
export interface Transaction extends TransactionRecord {
  labelIds: string[];
}

interface TransactionLabel {
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
  /** `occurredAt` carries a real time of day; otherwise only `on` means something. */
  timeKnown: boolean;
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
  /** A giroconto with its other side outside Ledgerly ("conto esterno"). */
  transferOutside: boolean;
  /**
   * The other account of a giroconto: its partner's, or the one chosen while the partner has not
   * arrived. `null` with neither: the leg waits for the person ("Scegli il conto").
   */
  transferAccountId: string | null;
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
  locallyEdited: string[];
  /** Who wrote it: a provider's reading, or the person by hand. */
  origin: TransactionRecord["origin"];
  /** A manual movement that waits for its source, or that the source did not take (N3.1). */
  sendState: TransactionRecord["sendState"];
  /**
   * How the category stands (rewrite plan N3; ux/n3-categories-manual.md §1.2): chosen by a person
   * or a source, given automatically, only suggested, or absent. With the reason of an automatic
   * one or of a suggestion — a code and what its sentence names, never a number of the model.
   */
  categoryState: CategoryState;
  categoryReason: { code: string; params: Record<string, string> } | null;
  /**
   * Whether the cascade reads the movement: its source gives no category, so the category is never
   * one a source could disagree with.
   */
  categoryIsOwn: boolean;
  /**
   * The category suggested, which does not count until a person confirms it. The id only: its
   * name and its colour are the caller's to read from the categories it already has — a second
   * join here would be paid by every list, with or without a suggestion in it.
   */
  suggestedCategoryId: string | null;
  hidden: boolean;
  edited: boolean;
}

type TransactionSort = "date" | "amount" | "payee" | "account" | "category";
type SortDirection = "asc" | "desc";

/**
 * What the Expenses controls narrow the list down to (spec §7.2). Every field is optional: an
 * empty filter is the whole history, hidden rows excluded.
 *
 * `from`/`to` are civil dates in the user's time zone, both ends included. `categoryIds` may
 * carry `null`, which is the "Uncategorised" chip — a real choice, not a missing value.
 * `labelIds` matches a movement carrying **any** of them.
 */
export interface TransactionFilters {
  /** Only these movements: one row read the way the list reads it. */
  ids?: readonly string[];
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
 * summed, as the source reports it (2026-09-19): the two legs of a giroconto between accounts that are
 * both here cancel out, and a leg whose other side is elsewhere — or that the source filed under
 * another type — moved money all the same. `count` is every row, because it describes the list.
 */
export interface TransactionsSummary {
  count: number;
  incomeCents: Cents;
  expenseCents: Cents;
  /** Every movement summed, giroconti included: the cash flow the source shows. */
  netCents: Cents;
  /** How many of the rows are giroconti, so the header can say what it left out. */
  transferCount: number;
  /** Of those, the legs with no counterpart here: usually the other account is not linked. */
  unpairedTransferCount: number;
  /** The movements left out of the money for want of a rate (D4); absent when none. */
  excludedCount?: number;
}

/**
 * Income less spending, giroconti out (decision D3): what the person earned less what they spent.
 * `netCents` stays the cash flow of every movement; the two differ when a giroconto has no
 * counterpart in the range.
 */
export function incomeLessExpense(summary: Pick<TransactionsSummary, "incomeCents" | "expenseCents">): Cents {
  return summary.incomeCents + summary.expenseCents;
}

export interface MonthTotal {
  month: MonthKey;
  count: number;
  /** The month's cash flow, every movement summed like the header's net. */
  netCents: Cents;
  /** The movements left out for want of a rate (D4); absent when none. */
  excludedCount?: number;
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
  /** The movements left out for want of a rate (D4); absent when none. */
  excludedCount?: number;
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
  /** The movements left out for want of a rate (D4); absent when none. */
  excludedCount?: number;
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
  /** The movements of the range that wait for a category: what the notice over the table says. */
  review: WaitingForCategory;
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
  return share(abs(part), abs(whole), 1) ?? 0;
}

/** Midnight of a civil date in the user's own zone, as the instant the column is compared to. */
export function dayStart(on: CivilDate, timeZone: string): SQL {
  return sql`(${on}::date)::timestamp at time zone ${timeZone}`;
}

/**
 * The civil day of an instant in the user's zone, `YYYY-MM-DD`: `to_char` on the shifted instant,
 * the SQL twin of `civilDateIn` (audit TRX-9). `instant` defaults to the movement's own.
 */
export function dayExpression(
  timeZone: string,
  instant: SQL | AnyPgColumn = transactions.occurredAt,
): SQL<string> {
  return sql<string>`to_char(${instant} at time zone ${timeZone}, 'YYYY-MM-DD')`;
}

/**
 * The grouping key of a payee in SQL: the twin of `payeeKeyOf` (audit TRX-9), which a test holds
 * it to. A payee that normalises to nothing is `''` here and `null` there; neither is a key.
 * JS is the reference, because the stored keys (`recurring_patterns.payee_key`) come from it: the
 * class is JS's `\s` written out (Postgres's leaves out U+00A0, U+202F, U+FEFF…), and U+0130 is
 * lowered as JS lowers it, to "i" + U+0307 (PERS-473).
 */
export function payeeKeyExpression(payee: SQL | AnyPgColumn): SQL<string> {
  return sql<string>`lower(regexp_replace(replace(${payee}, U&'\\0130', U&'i\\0307'), '[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+', '', 'g'))`;
}

/** The month key of a movement in the user's zone: `to_char` on the shifted instant. */
export function monthExpression(timeZone: string): SQL<string> {
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
export function conditions(ctx: Pick<Ctx, "userId" | "timeZone">, filters: TransactionFilters): SQL {
  const parts: (SQL | undefined)[] = [userScoped(ctx).owns(transactions)];

  if (filters.ids) parts.push(inArray(transactions.id, [...filters.ids]));
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
    parts.push(
      isNull(transactions.hiddenAt),
      isNull(transactions.removedUpstreamAt),
      notDoubled(ctx, filters),
    );
  }

  return and(...parts) as SQL;
}

/**
 * The movements of an archived double are counted once, on its twin (decision H58): out of every
 * total and of the list, like a hidden row. An account the filter names keeps its own: its page
 * shows its history. A sub-query of the same statement, not a query more (G9).
 */
function notDoubled(ctx: Pick<Ctx, "userId">, filters: TransactionFilters): SQL {
  const named = filters.accountIds ?? [];
  return notInArray(
    transactions.accountId,
    getDb()
      .select({ id: duplicateAccounts.accountId })
      .from(duplicateAccounts)
      .where(
        and(
          userScoped(ctx).owns(duplicateAccounts),
          named.length > 0 ? notInArray(duplicateAccounts.accountId, [...named]) : undefined,
        ),
      ),
  );
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
export function withoutHidden(filters: TransactionFilters): TransactionFilters {
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
export function ordering(filters: TransactionFilters, accounts: readonly Account[]): SQL[] {
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

export function cents(value: string | null): Cents {
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
  return groupBy(
    rows,
    (row) => row.transactionId,
    (row) => row.labelId,
  );
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
  return groupBy(
    rows,
    (row) => row.transactionId,
    (row): TransactionLabel => ({ id: row.id, name: row.name, color: row.color }),
  );
}
