import { z } from "zod";
import { type MonthKey, isCivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";

/** How close to the limit a budget turns "Near limit" (spec §7.3): spent ≥ 85 % of it. */
export const NEAR_LIMIT_PERCENT = 85n;

export type BudgetStatus = "over" | "near" | "on_track";

/** One stored version of a category's limit (spec §7.3). */
export interface LimitVersion {
  fromMonth: MonthKey;
  amountCents: Cents | null;
  stopped: boolean;
}

/**
 * A category's limit in `month`: the version with the latest `fromMonth` on or before it, or
 * `null` when there is none or that version stopped the budget.
 */
export function limitFor(versions: readonly LimitVersion[], month: MonthKey): Cents | null {
  let current: LimitVersion | null = null;
  for (const version of versions) {
    if (version.fromMonth > month) continue;
    if (current === null || version.fromMonth > current.fromMonth) current = version;
  }
  return current === null || current.stopped ? null : current.amountCents;
}

/**
 * Spec §7.3: spent > limit → Over; spent ≥ 85 % → Near limit; otherwise On track. In integer
 * cents (`spent × 100 ≥ limit × 85`), so no rounding decides a boundary.
 */
export function budgetStatus(spent: Cents, limit: Cents): BudgetStatus {
  if (spent > limit) return "over";
  if (spent * 100n >= limit * NEAR_LIMIT_PERCENT) return "near";
  return "on_track";
}

/** Spent as a whole percentage of the limit, rounded half-up; past 100 when over. */
export function percentOf(spent: Cents, limit: Cents): number {
  if (limit <= 0n) return 0;
  return Number((spent * 200n + limit) / (limit * 2n));
}

/** A category as the budgets see it: the tree, and the colour a sub-category borrows. */
export interface BudgetCategory {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
}

/** What a budget is on: a category, an account, or both (never neither). */
export interface BudgetScope {
  categoryId: string | null;
  accountId: string | null;
}

/** The one key of a scope, for maps and for the table's rows. */
export function scopeKey(scope: BudgetScope): string {
  return `${scope.categoryId ?? "*"}|${scope.accountId ?? "*"}`;
}

/** One month's spending of one category on one account, positive. */
export interface Spending {
  categoryId: string | null;
  accountId: string;
  cents: Cents;
}

export interface BudgetRow extends BudgetScope {
  key: string;
  /** The category's name; `null` for a budget on the whole account. */
  name: string | null;
  /** The group's name when the category is a sub-category. */
  groupName: string | null;
  accountName: string | null;
  /** A sub-category is shown in its group's colour (spec §7.2, F2.5). */
  color: string | null;
  /** 1 when the budget of its group, on the same account, is shown right above it. */
  depth: 0 | 1;
  limitCents: Cents;
  spentCents: Cents;
  status: BudgetStatus;
  percent: number;
}

export interface BudgetRowsResult {
  rows: BudgetRow[];
  /**
   * The limit of the budgets no other budget contains, and what the budgets cover: each movement
   * once, however many budgets it falls in.
   */
  totals: { limitCents: Cents; spentCents: Cents };
  /** Spending no budget covers, uncategorised included. */
  unbudgetedCents: Cents;
}

/**
 * The Budgets table and its totals for one month (spec §7.3, F3). A budget is on a category, an
 * account or both: its spent is the month's spending of the category — a group with its
 * sub-categories, like the group filter of §7.2 — on the account, or on every account.
 *
 * A budget contained in another (a sub-category under its group's budget, a category on one account
 * under the same category everywhere, anything under a whole-account budget) adds nothing to the
 * total limit; the total spent counts each movement once.
 */
export function budgetRows(
  categories: readonly BudgetCategory[],
  accounts: readonly { id: string; name: string }[],
  limits: readonly (BudgetScope & { limitCents: Cents })[],
  spending: readonly Spending[],
): BudgetRowsResult {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const order = new Map(categories.map((category, index) => [category.id, index]));
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const family = (id: string) =>
    new Set([
      id,
      ...categories.filter((category) => category.parentId === id).map((category) => category.id),
    ]);
  const families = new Map(
    limits.flatMap((limit) => (limit.categoryId ? [[limit.categoryId, family(limit.categoryId)]] : [])),
  );

  const matches = (scope: BudgetScope, row: Spending) =>
    (scope.categoryId === null ||
      (row.categoryId !== null && families.get(scope.categoryId)!.has(row.categoryId))) &&
    (scope.accountId === null || scope.accountId === row.accountId);
  const contains = (outer: BudgetScope, inner: BudgetScope) =>
    scopeKey(outer) !== scopeKey(inner) &&
    (outer.categoryId === null ||
      (inner.categoryId !== null && families.get(outer.categoryId)!.has(inner.categoryId))) &&
    (outer.accountId === null || outer.accountId === inner.accountId);

  const rows: BudgetRow[] = limits.map((limit) => {
    const category = limit.categoryId === null ? undefined : byId.get(limit.categoryId);
    const parent = category?.parentId ? byId.get(category.parentId) : undefined;
    const spentCents = spending
      .filter((row) => matches(limit, row))
      .reduce<Cents>((sum, row) => sum + row.cents, 0n);
    const underGroup =
      parent !== undefined &&
      limits.some((other) => other.categoryId === parent.id && other.accountId === limit.accountId);
    return {
      key: scopeKey(limit),
      categoryId: limit.categoryId,
      accountId: limit.accountId,
      name: category?.name ?? null,
      groupName: parent?.name ?? null,
      accountName: limit.accountId === null ? null : (accountName.get(limit.accountId) ?? null),
      color: parent ? parent.color : (category?.color ?? null),
      depth: underGroup ? 1 : 0,
      limitCents: limit.limitCents,
      spentCents,
      status: budgetStatus(spentCents, limit.limitCents),
      percent: percentOf(spentCents, limit.limitCents),
    };
  });
  // Tree order of the category (the group's own row first, so a sub-category follows it), the
  // whole-account budgets first; then the account, "every account" first.
  const rank = (row: BudgetRow) => {
    if (row.categoryId === null) return -1;
    const category = byId.get(row.categoryId);
    const group = category?.parentId ?? row.categoryId;
    return (order.get(group) ?? 0) * 10_000 + (order.get(row.categoryId) ?? 0);
  };
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(a.accountId !== null) - Number(b.accountId !== null) ||
      (a.accountName ?? "").localeCompare(b.accountName ?? "") ||
      a.key.localeCompare(b.key),
  );

  const outermost = limits.filter((limit) => !limits.some((other) => contains(other, limit)));
  const covered = spending.filter((row) => limits.some((limit) => matches(limit, row)));
  const everything = spending.reduce<Cents>((sum, row) => sum + row.cents, 0n);
  const spentCents = covered.reduce<Cents>((sum, row) => sum + row.cents, 0n);
  return {
    rows,
    totals: { limitCents: outermost.reduce<Cents>((sum, limit) => sum + limit.limitCents, 0n), spentCents },
    unbudgetedCents: everything - spentCents,
  };
}

const monthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/)
  .refine(isCivilDate, "Not a month");

const onSomething = (scope: BudgetScope) => scope.categoryId !== null || scope.accountId !== null;

const scopeSchema = {
  categoryId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
};

export const setLimitSchema = z
  .object({
    ...scopeSchema,
    month: monthKeySchema,
    cents: z.bigint().positive(),
  })
  .refine(onSomething, "A budget is on a category, an account or both");

export const stopLimitSchema = z
  .object({ ...scopeSchema, month: monthKeySchema })
  .refine(onSomething, "A budget is on a category, an account or both");
