// Users and settings · the changes of the categories that join modules: the categories of a source,
// the move to another macro and the merge of two (rewrite plan N3, N3.1). The use cases are in
// `taxonomy.ts`; the Server Actions call the same ones.
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import { centsToDecimal } from "@ledgerly/domain/shared/money";
import {
  keepSourceCategory,
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

export function serveCategoryMoves(
  app: Hono<ApiEnv>,
  guard: Guard,
  sourceName: SourceName,
): readonly RouteContract[] {
  serveSourceCategories(app, guard);
  serveMoves(app, guard, sourceName);
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
  ];
}
