// A budget's row as the table draws it, from the API's `budgetLine`: every figure is a field of the
// route (spec §8.5, R3: the client does no sums); here it is only formatted.
import type { budgets } from "@ledgerly/api-contract/budgets";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import {
  formatAmountInput,
  formatMoney,
  formatWholePercent,
  type NumberFormat,
} from "@ledgerly/format/format";
import type { BudgetRowView } from "./budgets-table";
import { NO_COLOR } from "./colors";

type BudgetLine = RouteOutput<typeof budgets.getBudgetsView>["budgets"][number];

/** The table's row of a budget, in the person's number format. */
export function rowViewOf(
  line: BudgetLine,
  format: NumberFormat,
  labels: { allCategories: string; allAccounts: string },
): BudgetRowView {
  const limit = parseCents(line.limit);
  return {
    key: line.slug,
    href: `/budgets/${line.slug}`,
    scope: { categoryId: line.categoryId, accountId: line.accountId },
    name: line.name ?? labels.allCategories,
    detail: line.account ?? labels.allAccounts,
    color: line.color ?? NO_COLOR,
    depth: line.depth,
    spent: formatMoney(parseCents(line.spent), format),
    limit: formatMoney(limit, format, { decimals: limit % 100n !== 0n }),
    limitInput: formatAmountInput(limit, format),
    remaining: formatMoney(parseCents(line.remaining), format),
    status: line.status,
    percent: line.percent,
    percentLabel: formatWholePercent(line.percent, format),
  };
}
