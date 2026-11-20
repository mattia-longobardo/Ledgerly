import {
  formatAmountInput,
  formatMoney,
  formatWholePercent,
  type NumberFormat,
} from "@ledgerly/domain/platform/format";
import { type BudgetRow, budgetName as nameOf, budgetSlug } from "@ledgerly/domain/budgets";
import type { BudgetRowView } from "./budgets-table";

/** A category with no colour of its own (and no group to borrow one from) is drawn in grey. */
export const NO_COLOR = "#8a8f98";

/** How a budget is named (the domain's `budgetName`), «All categories» for one on a whole account. */
export function budgetName(
  row: Pick<BudgetRow, "name" | "groupName" | "depth">,
  allCategories: string,
): string {
  return nameOf(row) ?? allCategories;
}

/** The table's rows, formatted on the server (spec §8.5). */
export function presentRows(
  rows: readonly BudgetRow[],
  format: NumberFormat,
  labels: { allCategories: string; allAccounts: string },
): BudgetRowView[] {
  return rows.map((row) => ({
    key: row.key,
    href: `/budgets/${budgetSlug(row)}`,
    scope: { categoryId: row.categoryId, accountId: row.accountId },
    name: budgetName(row, labels.allCategories),
    detail: row.accountName ?? labels.allAccounts,
    color: row.color ?? NO_COLOR,
    depth: row.depth,
    spent: formatMoney(row.spentCents, format),
    limit: formatMoney(row.limitCents, format, { decimals: row.limitCents % 100n !== 0n }),
    limitInput: formatAmountInput(row.limitCents, format),
    remaining: formatMoney(row.limitCents - row.spentCents, format),
    status: row.status,
    percent: row.percent,
    percentLabel: formatWholePercent(row.percent, format),
  }));
}
