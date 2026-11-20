// Budgets · the one serializer of a budget (audit BUD-2, API-2): `GET /budgets`, its MCP tool
// `list_budgets`, the pages and Overview's card answer through these, so a field is written one way.
// Money leaves as a decimal string.
import type { z } from "zod";
import type { BUDGETS } from "@ledgerly/api-contract";
import { type BudgetRow, budgetName, budgetSlug } from "@ledgerly/domain/budgets";
import { monthKey, today, type MonthKey } from "@ledgerly/domain/shared/dates";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { centsToDecimal } from "@ledgerly/domain/shared/money";

type Wire<T extends z.ZodType> = z.input<T>;
type Row = Wire<typeof BUDGETS.budgets.listBudgets.response>["budgets"][number];
type Line = Wire<typeof BUDGETS.budgets.getBudgetsView.response>["budgets"][number];

export const money = centsToDecimal;

/** A month of the contract (`YYYY-MM` or `YYYY-MM-01`, BUD-8) as its first day; none is this month. */
export function monthOf(ctx: Pick<Ctx, "timeZone">, month: string | undefined): MonthKey {
  return month ? `${month.slice(0, 7)}-01` : monthKey(today(ctx.timeZone));
}

/** The row of `list_budgets`, as F8 answered it. */
export function budgetRow(row: BudgetRow): Row {
  return {
    categoryId: row.categoryId,
    category: row.name,
    group: row.groupName,
    accountId: row.accountId,
    account: row.accountName,
    limit: money(row.limitCents),
    spent: money(row.spentCents),
    status: row.status,
    percent: row.percent,
  };
}

/** The row the pages draw: the row of `list_budgets` and what the screen needs on top of it. */
export function budgetLine(row: BudgetRow): Line {
  return {
    ...budgetRow(row),
    slug: budgetSlug(row),
    name: budgetName(row),
    color: row.color,
    depth: row.depth,
    remaining: money(row.limitCents - row.spentCents),
  };
}
