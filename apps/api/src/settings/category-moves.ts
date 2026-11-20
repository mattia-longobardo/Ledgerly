// Users and settings · the changes of the categories that join modules: the categories of a source,
// the move to another macro and the merge of two (rewrite plan N3, N3.1). The use cases are in
// `taxonomy.ts`; the Server Actions call the same ones.
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import { budgetDetail } from "@ledgerly/domain/budgets";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";
import { periodEnd, periodMonths, shiftRange } from "@ledgerly/domain/platform/ranges";
import {
  categoryMacroTotals,
  categorySummary,
  getCategory,
  keepSourceCategory,
  listCategories,
  listSourceCategories,
  SourceCategoryError,
  TaxonomyError,
  TransactionError,
} from "@ledgerly/domain/transactions";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import {
  macroMoveView,
  mergeTwoCategories,
  moveToMacro,
  setSourceCategory,
  type SourceName,
  sourceNotes,
  undoMergeOfTwo,
  undoMoveToMacro,
  undoSourceCategoryChange,
} from "./taxonomy";

const { categories, labels } = SETTINGS;

/** A refusal of the transactions module as the contract names it. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof TaxonomyError ||
      error instanceof TransactionError ||
      error instanceof SourceCategoryError
    ) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      throw new ApiRefusal("invalid", error.code);
    }
    throw error;
  }
}

function serveSourceCategories(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, labels.listSourceCategories, async ({ ctx }) => ({
    sourceCategories: await listSourceCategories(ctx),
  }));
  serve(app, guard, labels.setSourceCategory, ({ ctx, params, body }) =>
    guarded(async () => {
      const change = await setSourceCategory(ctx, { id: params.id, categoryId: body.categoryId });
      return { ...change, macro: change.macro ?? null };
    }),
  );
  serve(app, guard, labels.undoSourceCategory, ({ ctx, params }) =>
    guarded(async () => {
      if ((await undoSourceCategoryChange(ctx, params.undoId)) === null) throw new ApiRefusal("not_found");
    }),
  );
  serve(app, guard, labels.keepSourceCategory, ({ ctx, params }) => keepSourceCategory(ctx, params.id));
}

function serveMoves(app: Hono<ApiEnv>, guard: Guard, sourceName: SourceName): void {
  serve(app, guard, categories.getMacroMove, ({ ctx, params }) =>
    guarded(async () => {
      const { amountCents, ...view } = await macroMoveView(ctx, params.id, sourceName);
      return { ...view, amount: centsToDecimal(amountCents), currency: ctx.displayCurrency };
    }),
  );
  serve(app, guard, categories.moveToMacro, ({ ctx, params, body }) =>
    guarded(async () => ({ undo: { ...(await moveToMacro(ctx, params.id, body)) } })),
  );
  serve(app, guard, categories.undoMoveToMacro, ({ ctx, body }) =>
    guarded(() => undoMoveToMacro(ctx, body.undo)),
  );
  serve(app, guard, categories.mergeCategories, ({ ctx, body }) =>
    guarded(async () => {
      const { moved, undo } = await mergeTwoCategories(ctx, body);
      return { moved, undo: { ...undo } };
    }),
  );
  serve(app, guard, categories.undoMerge, ({ ctx, body }) =>
    guarded(async () => ({ moved: await undoMergeOfTwo(ctx, body.undo) })),
  );
}

/** The figures of a category's page (§5.4): the page computes them with the same `categorySummary`. */
function serveSummary(app: Hono<ApiEnv>, guard: Guard, sourceName: SourceName): void {
  serve(app, guard, categories.getCategorySummary, ({ ctx, params, query }) =>
    guarded(async () => {
      const category = await getCategory(ctx, params.id);
      const todayOn = today(ctx.timeZone);
      const range = { from: query.from, to: query.to };
      const scope = { accountIds: query.accounts, categoryIds: [category.id] };
      const end = monthKey(periodEnd(range, todayOn));
      const [all, totals, before, budget, notes] = await Promise.all([
        listCategories(ctx, { includeArchived: true }),
        categoryMacroTotals(ctx, { ...scope, ...range }),
        categoryMacroTotals(ctx, { ...scope, ...shiftRange(range, -1) }),
        category.type === "expense"
          ? budgetDetail(ctx, { categoryId: category.id, accountId: null }, end)
          : null,
        sourceNotes(ctx, sourceName),
      ]);
      const summary = categorySummary({
        category,
        categories: all,
        totals,
        before,
        months: periodMonths(range, todayOn).months,
        budget: budget && { ...budget, from: monthKey(range.from), end },
      });
      const money = (cents: Cents | null) => (cents === null ? null : centsToDecimal(cents));
      const colorOf = new Map(all.map((one) => [one.id, one.color]));
      const note = notes.get(category.id);
      return {
        amount: centsToDecimal(summary.amountCents),
        count: summary.count,
        previousAmount: money(summary.previousCents),
        change: summary.change,
        perMonth: money(summary.perMonthCents),
        budget: summary.budget && {
          limit: centsToDecimal(summary.budget.limitCents),
          overMonths: summary.budget.overMonths,
        },
        children: summary.children.map((line) => ({
          id: line.category.id,
          name: line.category.name,
          color: colorOf.get(line.category.id) ?? null,
          amount: centsToDecimal(line.totalCents),
          // The page's percentage, one decimal, as the wire's 0-1.
          share: line.share / 100,
        })),
        source: note ? { provider: note.provider, name: note.source, names: note.names } : null,
      };
    }),
  );
}

export function serveCategoryMoves(
  app: Hono<ApiEnv>,
  guard: Guard,
  sourceName: SourceName,
): readonly RouteContract[] {
  serveSourceCategories(app, guard);
  serveMoves(app, guard, sourceName);
  serveSummary(app, guard, sourceName);
  return [
    labels.listSourceCategories,
    labels.setSourceCategory,
    labels.undoSourceCategory,
    labels.keepSourceCategory,
    categories.getMacroMove,
    categories.moveToMacro,
    categories.undoMoveToMacro,
    categories.mergeCategories,
    categories.undoMerge,
    categories.getCategorySummary,
  ];
}
