import { and, asc, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { resolveExternal } from "../../../platform/integrations/service";
import { categories, sourceCategories, transactions } from "../schema";
import {
  choiceOf,
  pickSourceCategory,
  planSourceCategory,
  type RemoteSourceCategory,
  type SourceCategoryChoice,
  sourceNamesShown,
} from "../source-rules";

type Who = Pick<Ctx, "userId">;
export type Row = typeof sourceCategories.$inferSelect;

type SourceCategoryErrorCode = "not_found" | "invalid";

export class SourceCategoryError extends Error {
  constructor(readonly code: SourceCategoryErrorCode) {
    super(code);
    this.name = "SourceCategoryError";
  }
}

/* What a reading writes */

async function applyPlan(
  ctx: Who,
  provider: string,
  stored: Row | undefined,
  remote: RemoteSourceCategory,
  addedId: string,
): Promise<{ id: string; categoryId: string } | null> {
  const plan = planSourceCategory(stored, remote, addedId);
  if (plan.insert) {
    const [row] = await getDb()
      .insert(sourceCategories)
      .values(
        userScoped(ctx).stamp({
          provider,
          externalId: remote.externalId,
          name: remote.name,
          groupName: remote.groupName,
          categoryId: addedId,
          addedCategoryId: addedId,
        }),
      )
      // Two readings met on the same new category: the other one wrote it.
      .onConflictDoNothing()
      .returning({ id: sourceCategories.id });
    if (row) return { id: row.id, categoryId: addedId };
    const [raced] = await getDb()
      .select({ id: sourceCategories.id, categoryId: sourceCategories.categoryId })
      .from(sourceCategories)
      .where(
        and(
          userScoped(ctx).owns(sourceCategories),
          eq(sourceCategories.provider, provider),
          eq(sourceCategories.externalId, remote.externalId),
        ),
      );
    return raced ? { id: raced.id, categoryId: raced.categoryId ?? addedId } : null;
  }
  const row = stored as Row;
  if (Object.keys(plan.patch).length > 0) {
    await getDb()
      .update(sourceCategories)
      .set(plan.patch)
      .where(and(eq(sourceCategories.id, row.id), userScoped(ctx).owns(sourceCategories)));
  }
  if (plan.restoreAdded) {
    // It counts under its own category again: that one comes back if the match had put it away.
    await getDb()
      .update(categories)
      .set({ archivedAt: null })
      .where(and(eq(categories.id, addedId), userScoped(ctx).owns(categories)));
  }
  return { id: row.id, categoryId: plan.categoryId };
}

/**
 * The row of one category of a source, written or brought up to date by a reading, and the
 * category its movements count under. `addedId` is the category this app holds for it.
 */
export async function ensureSourceCategory(
  ctx: Who,
  provider: string,
  remote: RemoteSourceCategory,
  addedId: string,
): Promise<{ id: string; categoryId: string } | null> {
  const [stored] = await getDb()
    .select()
    .from(sourceCategories)
    .where(
      and(
        userScoped(ctx).owns(sourceCategories),
        eq(sourceCategories.provider, provider),
        eq(sourceCategories.externalId, remote.externalId),
      ),
    );
  return applyPlan(ctx, provider, stored, remote, addedId);
}

/** The row of a source's category by the source's id alone, for a movement that carries no name. */
export async function knownSourceCategory(
  ctx: Who,
  provider: string,
  externalId: string,
): Promise<{ id: string; categoryId: string | null } | null> {
  const [row] = await getDb()
    .select({ id: sourceCategories.id, categoryId: sourceCategories.categoryId })
    .from(sourceCategories)
    .where(
      and(
        userScoped(ctx).owns(sourceCategories),
        eq(sourceCategories.provider, provider),
        eq(sourceCategories.externalId, externalId),
      ),
    );
  return row ?? null;
}

/**
 * The whole list of a source's categories, as a reading has just given it: a new one becomes a row
 * ("added", and "New" until the person looks at it), a renamed one takes its name. Only the
 * categories this app already holds a category for; one it does not is met with its first
 * movement. Returns how many rows were written.
 */
export async function recordSourceCategories(
  ctx: Who,
  provider: string,
  remote: readonly RemoteSourceCategory[],
): Promise<number> {
  if (remote.length === 0) return 0;
  const linked = await resolveExternal(
    ctx,
    provider,
    "category",
    remote.map((one) => one.externalId),
  );
  if (linked.size === 0) return 0;
  const held = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(and(userScoped(ctx).owns(categories), inArray(categories.id, [...new Set(linked.values())])));
  const present = new Set(held.map((row) => row.id));
  const stored = await getDb()
    .select()
    .from(sourceCategories)
    .where(and(userScoped(ctx).owns(sourceCategories), eq(sourceCategories.provider, provider)));
  const byExternalId = new Map(stored.map((row) => [row.externalId, row]));
  let written = 0;
  for (const one of remote) {
    const addedId = linked.get(one.externalId);
    if (addedId === undefined || !present.has(addedId)) continue;
    const row = byExternalId.get(one.externalId);
    const plan = planSourceCategory(row, one, addedId);
    if (!plan.insert && Object.keys(plan.patch).length === 0) continue;
    await applyPlan(ctx, provider, row, one, addedId);
    written += 1;
  }
  return written;
}

/* What Settings › Categories reads */

export interface SourceCategoryView {
  id: string;
  provider: string;
  name: string;
  groupName: string | null;
  choice: SourceCategoryChoice;
  /** Where its movements count; `null` only until the next reading brings its category back. */
  categoryId: string | null;
  /** Arrived from the source and not looked at yet. */
  isNew: boolean;
  /** How many movements of the source carry it. */
  count: number;
}

/** Every category of the person's sources, by source, then by group and name. */
export async function listSourceCategories(ctx: Who): Promise<SourceCategoryView[]> {
  const rows = await getDb()
    .select()
    .from(sourceCategories)
    .where(userScoped(ctx).owns(sourceCategories))
    .orderBy(
      asc(sourceCategories.provider),
      sql`${sourceCategories.groupName} nulls first`,
      asc(sourceCategories.name),
      asc(sourceCategories.id),
    );
  if (rows.length === 0) return [];
  const used = await usage(ctx);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    groupName: row.groupName,
    choice: choiceOf(row),
    categoryId: row.categoryId,
    isNew: row.seenAt === null,
    count: used.get(row.id) ?? 0,
  }));
}

async function usage(
  ctx: Who,
  executor: Tx | ReturnType<typeof getDb> = getDb(),
): Promise<Map<string, number>> {
  const rows = await executor
    .select({ id: transactions.sourceCategoryId, n: count() })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), isNotNull(transactions.sourceCategoryId)))
    .groupBy(transactions.sourceCategoryId);
  return new Map(rows.flatMap((row) => (row.id === null ? [] : [[row.id, Number(row.n)] as const])));
}

/**
 * For each category that a source's categories count under: the source and the names to show under
 * it (`sourceNamesShown`). A category with nothing to say is left out.
 */
export async function sourceNamesByCategory(
  ctx: Who,
): Promise<Map<string, { provider: string; names: string[] }>> {
  const rows = await getDb()
    .select({
      categoryId: sourceCategories.categoryId,
      provider: sourceCategories.provider,
      name: sourceCategories.name,
      categoryName: categories.name,
    })
    .from(sourceCategories)
    .innerJoin(categories, eq(categories.id, sourceCategories.categoryId))
    .where(userScoped(ctx).owns(sourceCategories))
    .orderBy(asc(sourceCategories.provider), asc(sourceCategories.name), asc(sourceCategories.id));
  const grouped = new Map<string, { provider: string; categoryName: string; names: string[] }>();
  for (const row of rows) {
    if (row.categoryId === null) continue;
    const entry = grouped.get(row.categoryId) ?? {
      provider: row.provider,
      categoryName: row.categoryName,
      names: [],
    };
    // A category names one source under it: the first, in the order of the read.
    if (entry.provider === row.provider) entry.names.push(row.name);
    grouped.set(row.categoryId, entry);
  }
  const shown = new Map<string, { provider: string; names: string[] }>();
  for (const [categoryId, entry] of grouped) {
    const names = sourceNamesShown(entry.categoryName, entry.names);
    if (names.length > 0) shown.set(categoryId, { provider: entry.provider, names });
  }
  return shown;
}

/**
 * The source's own id of the category a movement written here is sent with, and its row: the one
 * that counts under `categoryId` (`pickSourceCategory`). `null` when the movement has no category
 * or none of the source counts under it.
 */
export async function sourceCategoryFor(
  ctx: Who,
  provider: string,
  categoryId: string | null,
): Promise<{ id: string; externalId: string } | null> {
  if (categoryId === null) return null;
  const rows = await getDb()
    .select({
      id: sourceCategories.id,
      externalId: sourceCategories.externalId,
      name: sourceCategories.name,
      categoryName: categories.name,
    })
    .from(sourceCategories)
    .innerJoin(categories, eq(categories.id, sourceCategories.categoryId))
    .where(
      and(
        userScoped(ctx).owns(sourceCategories),
        eq(sourceCategories.provider, provider),
        eq(sourceCategories.categoryId, categoryId),
      ),
    )
    .orderBy(asc(sourceCategories.id));
  if (rows.length === 0) return null;
  const used = rows.length === 1 ? new Map<string, number>() : await usage(ctx);
  const picked = pickSourceCategory(
    rows.map((row) => ({ externalId: row.externalId, name: row.name, count: used.get(row.id) ?? 0 })),
    rows[0].categoryName,
  );
  const row = rows.find((one) => one.externalId === picked);
  return row ? { id: row.id, externalId: row.externalId } : null;
}
