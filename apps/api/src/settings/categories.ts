// Users and settings · categories and labels (rewrite plan R2, spec §7.2). The taxonomy is the
// transactions module's; deleting a category at the source it came from is the integration's: only
// the app joins the two (rule M8), here, for the Server Action and for the route alike.
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { transactionsSource } from "@ledgerly/domain/platform/integrations/source";
import {
  archiveCategory,
  createCategory,
  createLabel,
  deleteCategory,
  deleteLabel,
  listCategoriesWithUsage,
  listLabelsWithUsage,
  moveCategory,
  restoreCategories,
  TaxonomyError,
  updateCategory,
  updateLabel,
} from "@ledgerly/domain/transactions";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

const { categories, labels } = SETTINGS;

type Who = Pick<Ctx, "userId">;

/**
 * Deletes a category for good, here **and at its source** (owner, 2026-09-21). The local delete
 * goes first: if it fails nothing is destroyed anywhere; if the source then refuses, the answer
 * says so. The other order would let the source lose a category for a deletion that never happened.
 */
export async function deleteCategoryEverywhere(ctx: Who, id: string) {
  const deletion = await deleteCategory(ctx, id, transactionsSource);
  const external = await transactionsSource.deleteCategories(ctx, deletion.externalIds);
  return { removed: deletion.removed.length, uncategorised: deletion.uncategorised, external };
}

/** A refusal of the taxonomy as the contract names it. */
function refused(error: unknown): never {
  if (error instanceof TaxonomyError) {
    if (error.code === "not_found") throw new ApiRefusal("not_found");
    throw new ApiRefusal(error.code === "duplicate" ? "conflict" : "invalid", error.code);
  }
  throw error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return refused(error);
  }
}

async function categoryRows(ctx: Who, archived: boolean) {
  return (await listCategoriesWithUsage(ctx, { includeArchived: archived })).map(
    ({ category, usage, depth }) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      type: category.type,
      color: category.color,
      depth,
      usage,
      archivedAt: category.archivedAt?.toISOString() ?? null,
    }),
  );
}

async function categoryRow(ctx: Who, id: string) {
  const row = (await categoryRows(ctx, true)).find((one) => one.id === id);
  if (!row) throw new ApiRefusal("not_found");
  return row;
}

async function labelRow(ctx: Who, id: string) {
  const row = (await listLabelsWithUsage(ctx)).find((one) => one.label.id === id);
  if (!row) throw new ApiRefusal("not_found");
  return { id: row.label.id, name: row.label.name, color: row.label.color, usage: row.usage };
}

function serveCategories(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, categories.listCategories, async ({ ctx, query }) => ({
    categories: await categoryRows(ctx, query.archived === "true"),
  }));
  serve(app, guard, categories.createCategory, ({ ctx, body }) =>
    guarded(async () => categoryRow(ctx, (await createCategory(ctx, body)).id)),
  );
  serve(app, guard, categories.updateCategory, ({ ctx, params, body }) =>
    guarded(async () => {
      await updateCategory(ctx, params.id, body);
      return categoryRow(ctx, params.id);
    }),
  );
  serve(app, guard, categories.archiveCategory, ({ ctx, params }) =>
    guarded(async () => ({ ids: await archiveCategory(ctx, params.id) })),
  );
  serve(app, guard, categories.restoreCategories, ({ ctx, body }) =>
    guarded(async () => {
      await restoreCategories(ctx, body.ids);
    }),
  );
  serve(app, guard, categories.moveCategory, ({ ctx, params, body }) =>
    guarded(async () => ({ fromId: (await moveCategory(ctx, params.id, body.parentId)).fromId })),
  );
  serve(app, guard, categories.deleteCategory, ({ ctx, params }) =>
    guarded(() => deleteCategoryEverywhere(ctx, params.id)),
  );
}

function serveLabels(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, labels.listLabels, async ({ ctx }) => ({
    labels: (await listLabelsWithUsage(ctx)).map(({ label, usage }) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      usage,
    })),
  }));
  serve(app, guard, labels.createLabel, ({ ctx, body }) =>
    guarded(async () => labelRow(ctx, (await createLabel(ctx, body)).id)),
  );
  serve(app, guard, labels.updateLabel, ({ ctx, params, body }) =>
    guarded(async () => {
      await updateLabel(ctx, params.id, body);
      return labelRow(ctx, params.id);
    }),
  );
  serve(app, guard, labels.deleteLabel, ({ ctx, params }) => guarded(() => deleteLabel(ctx, params.id)));
}

/** The routes of the taxonomy served so far: the categories of a source and the moves come next. */
export function serveTaxonomy(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveCategories(app, guard);
  serveLabels(app, guard);
  return [
    categories.listCategories,
    categories.createCategory,
    categories.updateCategory,
    categories.archiveCategory,
    categories.restoreCategories,
    categories.moveCategory,
    categories.deleteCategory,
    labels.listLabels,
    labels.createLabel,
    labels.updateLabel,
    labels.deleteLabel,
  ];
}
