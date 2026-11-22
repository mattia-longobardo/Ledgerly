// Users and settings · the board of Expenses › Categories (categories-and-rules.md §5.2): what the
// page joined on the server, as one read. The macros are `macroViews`', the colour `colorOfCategory`,
// the budget the budgets module's and the source note `sourceNotes`; only the app joins them (M8).
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import { type BudgetRow, budgetsView, categoriesWithLimit } from "@ledgerly/domain/budgets";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { periodEnd } from "@ledgerly/domain/platform/ranges";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";
import {
  categoryMacroTotals,
  colorOfCategory,
  listCategories,
  listCategoriesWithUsage,
  listMergeProposals,
  macroViews,
  type MergeProposal,
} from "@ledgerly/domain/transactions";
import { type ApiEnv, type Guard, serve } from "../serve";
import { type SourceName, sourceNotes } from "./taxonomy";

const { getCategoriesBoard, getMergeProposals } = SETTINGS.categoryBoard;

type Category = Awaited<ReturnType<typeof listCategoriesWithUsage>>[number]["category"];
type Views = ReturnType<typeof macroViews>;
type Line = Views[number]["groups"][number]["children"][number];
type Note = Awaited<ReturnType<typeof sourceNotes>> extends Map<string, infer N> ? N : never;

interface Joined {
  byId: ReadonlyMap<string, Category>;
  usage: ReadonlyMap<string, number>;
  budgetOf: ReadonlyMap<string, BudgetRow>;
  notes: ReadonlyMap<string, Note>;
}

/** An amount of `macroViews`: `total` signed, `in` and `out` positive (`outCents` is negative). */
function amount(sum: { count: number; totalCents: Cents; inCents: Cents; outCents: Cents }) {
  return {
    count: sum.count,
    total: centsToDecimal(sum.totalCents),
    in: centsToDecimal(sum.inCents),
    out: centsToDecimal(-sum.outCents),
  };
}

/** A line of the board: the line of `macroViews` and what the page drew on it. */
function boardLine(line: Line, joined: Joined) {
  const category = joined.byId.get(line.category.id);
  if (!category) throw new Error(`category ${line.category.id} not read`);
  const budget = joined.budgetOf.get(category.id);
  const note = joined.notes.get(category.id);
  return {
    id: category.id,
    name: category.name,
    parentId: category.parentId,
    type: category.type,
    color: colorOfCategory(category, joined.byId),
    chosenColor: category.color,
    archived: line.category.archived,
    canMerge: category.providerName === null,
    usage: joined.usage.get(category.id) ?? 0,
    ...amount(line),
    share: line.share,
    budget: budget ? { limit: centsToDecimal(budget.limitCents), status: budget.status } : null,
    source:
      note && note.names.length > 0
        ? { provider: note.provider, name: note.source, names: note.names }
        : null,
  };
}

/** A proposal with what the dialog has to say before the merge: whether two budgets are summed. */
interface MergeProposalView extends MergeProposal {
  sumsBudgets: boolean;
}

/** The pairs of categories to merge (ux/n3-categories-manual.md §6.3), with whether a merge sums two budgets. */
export async function mergeProposalsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
): Promise<MergeProposalView[]> {
  const proposals = await listMergeProposals(ctx);
  if (proposals.length === 0) return [];
  const limited = await categoriesWithLimit(
    ctx,
    [...new Set(proposals.flatMap((one) => [one.first.id, one.second.id]))],
    monthKey(today(ctx.timeZone)),
  );
  return proposals.map((one) => ({
    ...one,
    sumsBudgets: limited.has(one.first.id) && limited.has(one.second.id),
  }));
}

/** Settings › Categories: each side as the dialog shows it; a category with sub-categories stays a group. */
async function mergeProposalSides(ctx: Ctx) {
  const [proposals, all] = await Promise.all([
    mergeProposalsView(ctx),
    listCategories(ctx, { includeArchived: true }),
  ]);
  const byId = new Map(all.map((one) => [one.id, one]));
  const hasChildren = (id: string) => all.some((one) => one.parentId === id);
  const side = (category: MergeProposal["first"], other: MergeProposal["first"]) => ({
    id: category.id,
    name: category.name,
    color: colorOfCategory(byId.get(category.id) ?? { ...category, color: null }, byId),
    usage: category.usage,
    hasChildren: hasChildren(category.id),
    canKeepOther: !(hasChildren(other.id) && byId.get(category.id)?.parentId !== null),
  });
  return proposals.map((one) => ({
    first: side(one.first, one.second),
    second: side(one.second, one.first),
    sumsBudgets: one.sumsBudgets,
  }));
}

export function serveCategoryBoard(
  app: Hono<ApiEnv>,
  guard: Guard,
  sourceName: SourceName,
): readonly RouteContract[] {
  serve(app, guard, getCategoriesBoard, async ({ ctx, query }) => {
    const range = { from: query.from, to: query.to };
    // The budget of the period's last month, on every account, as the page read it.
    const end = monthKey(periodEnd(range, today(ctx.timeZone)));
    const [all, totals, budgets, notes] = await Promise.all([
      listCategoriesWithUsage(ctx, { includeArchived: true }),
      categoryMacroTotals(ctx, { ...range, accountIds: query.accounts }),
      budgetsView(ctx, end),
      sourceNotes(ctx, sourceName),
    ]);
    const joined: Joined = {
      byId: new Map(all.map(({ category }) => [category.id, category])),
      usage: new Map(all.map((row) => [row.category.id, row.usage])),
      budgetOf: new Map(
        budgets.rows.flatMap((row) =>
          row.accountId === null && row.categoryId !== null ? [[row.categoryId, row] as const] : [],
        ),
      ),
      notes,
    };
    const views = macroViews(
      all.map(({ category }) => ({
        id: category.id,
        name: category.name,
        parentId: category.parentId,
        type: category.type,
        archived: category.archivedAt !== null,
      })),
      totals,
    );
    return {
      macros: views.map((view) => ({
        macro: view.macro,
        ...amount(view),
        groups: view.groups.map((group) => ({
          ...boardLine(group, joined),
          only: group.only && { total: centsToDecimal(group.only.totalCents), count: group.only.count },
          children: group.children.map((child) => boardLine(child, joined)),
        })),
        rest: view.rest && amount(view.rest),
      })),
    };
  });
  serve(app, guard, getMergeProposals, async ({ ctx }) => ({ proposals: await mergeProposalSides(ctx) }));
  return [getCategoriesBoard, getMergeProposals];
}
