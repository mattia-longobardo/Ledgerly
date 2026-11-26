// The figures of one category's page (categories-and-rules.md §5.4) as data: what it spent, received
// or moved in the period against the period before, by month, against its budget, and its
// sub-categories. Pure: the page and `/api/v1` read the totals, this measures them.
import type { MonthKey } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import type { CategoryType } from "../rules";
import { type MacroCategory, macroViews } from "./macro-views";
import type { CategoryMacroTotal } from "./views";

/** A month of a budget: its limit (null without one) and what it spent. */
interface BudgetMonth {
  month: MonthKey;
  limitCents: Cents | null;
  spentCents: Cents;
}

interface CategorySummaryInput {
  category: { id: string; type: CategoryType };
  /** Every category of the person, archived included (`listCategories`). */
  categories: readonly (Omit<MacroCategory, "archived"> & { archivedAt: Date | null })[];
  /** `categoryMacroTotals` of the period and of the period before, on the category and its children. */
  totals: readonly CategoryMacroTotal[];
  before: readonly CategoryMacroTotal[];
  /** The months the period has happened through (`periodMonths`). */
  months: number;
  /** The budget of the category in the period's last month (`budgetDetail`), from the period's first. */
  budget: {
    from: MonthKey;
    end: MonthKey;
    row: { limitCents: Cents; spentCents: Cents };
    history: readonly BudgetMonth[];
  } | null;
}

/**
 * The KPIs of the page. `amountCents` is what the KPI calls the amount, in the macro's sign: spent
 * (an expense's total negated), received, or moved out for a transfer. `change` is against the
 * period before, null when that one had no movement or came to zero; `perMonthCents` needs two
 * months; `overMonths` counts the months of the period over the limit, this one included.
 */
export function categorySummary(input: CategorySummaryInput) {
  const { category } = input;
  const ofMacro = (list: readonly CategoryMacroTotal[]) => list.filter((row) => row.type === category.type);
  const amountOf = (list: readonly CategoryMacroTotal[]) =>
    ofMacro(list).reduce(
      (sum, row) => sum + (category.type === "expense" ? -row.totalCents : row.totalCents),
      0n,
    );
  const amountCents = amountOf(input.totals);
  const earlier = amountOf(input.before);
  const hadBefore = ofMacro(input.before).some((row) => row.count > 0);
  const { budget } = input;
  return {
    amountCents,
    count: ofMacro(input.totals).reduce((sum, row) => sum + row.count, 0),
    previousCents: hadBefore ? earlier : null,
    change: hadBefore && earlier !== 0n ? Number(amountCents - earlier) / Number(earlier) : null,
    perMonthCents: input.months >= 2 ? amountCents / BigInt(input.months) : null,
    budget:
      budget === null
        ? null
        : {
            limitCents: budget.row.limitCents,
            overMonths: [
              { month: budget.end, limitCents: budget.row.limitCents, spentCents: budget.row.spentCents },
              ...budget.history,
            ].filter(
              (one) => one.month >= budget.from && one.limitCents !== null && one.spentCents > one.limitCents,
            ).length,
          },
    // The categories of a group, with their totals in the period: the list of the page.
    children:
      macroViews(
        input.categories.map((one) => ({
          id: one.id,
          name: one.name,
          parentId: one.parentId,
          type: one.type,
          archived: one.archivedAt !== null,
        })),
        input.totals,
      )
        .find((view) => view.macro === category.type)
        ?.groups.find((line) => line.category.id === category.id)?.children ?? [],
  };
}
