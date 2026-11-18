// modules/transactions/source-categories.ts — the categories of a source that gives its own, and
// the category each counts under here (rewrite plan N3.1, 12-account-modes.md §12.3). The rules are
// `source-rules.ts`; this file reads and writes the rows.
//
// The movements of such a source are never recategorised: each keeps the source's category
// (`transactions.source_category_id`), and counts under the category the row of that one names.
// A change of the match moves them together, in one transaction, and "Undo" moves them back. A
// movement whose category a person chose by hand is left where they put it.
import "server-only";
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { getDb, type Tx } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { resolveExternal } from "@/platform/integrations/service";
import {
  categories,
  sourceCategories,
  sourceCategoryUndos,
  type SourceCategoryUndo,
  transactions,
} from "./schema";
import { retypeMovements } from "./macro";
import type { CategoryType } from "./rules";
import {
  choiceOf,
  pickSourceCategory,
  planSourceCategory,
  type RemoteSourceCategory,
  type SourceCategoryChoice,
  sourceNamesShown,
} from "./source-rules";

type Who = Pick<Ctx, "userId">;
type Row = typeof sourceCategories.$inferSelect;

export type SourceCategoryErrorCode = "not_found" | "invalid";

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

/* What the person changes */

const choiceSchema = z.object({ id: z.uuid(), categoryId: z.uuid().nullable() });

export interface SourceCategoryChange {
  /** The source's name of the category, and the name of the one it counts under now. */
  name: string;
  categoryName: string;
  choice: SourceCategoryChoice;
  /** How many movements of the source moved with it. */
  moved: number;
  /** What "Undo" is asked with; `null` when nothing changed. */
  undoId: string | null;
  /** The macro the movements counted in and count in now, when the change moves them (§2.4). */
  macro: { from: CategoryType; to: CategoryType } | null;
}

async function ownRow(ctx: Who, id: string, tx: Tx): Promise<Row> {
  const [row] = await tx
    .select()
    .from(sourceCategories)
    .where(and(eq(sourceCategories.id, id), userScoped(ctx).owns(sourceCategories)))
    .for("update");
  if (!row) throw new SourceCategoryError("not_found");
  return row;
}

/** The movements of the source that carry the category go where it counts now. A person's own choice stays. */
async function moveMovements(ctx: Who, id: string, categoryId: string, tx: Tx): Promise<number> {
  const moved = await tx
    .update(transactions)
    .set({ categoryId })
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.sourceCategoryId, id),
        eq(transactions.categoryOrigin, "provider"),
        ne(transactions.categoryId, categoryId),
      ),
    )
    .returning({ id: transactions.id });
  // A match to a category of another macro changes how they count (categories-and-rules.md §2.4).
  if (moved.length > 0) await retypeMovements(tx, ctx);
  return moved.length;
}

/** Whether the added category has nothing left that needs it: no movement, no child, no other source category. */
async function isIdle(ctx: Who, categoryId: string, tx: Tx): Promise<boolean> {
  // One after the other: a transaction is one connection, and asks one thing at a time.
  const [moved] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(userScoped(ctx).owns(transactions), eq(transactions.categoryId, categoryId)))
    .limit(1);
  if (moved) return false;
  const [child] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(userScoped(ctx).owns(categories), eq(categories.parentId, categoryId)))
    .limit(1);
  if (child) return false;
  const [other] = await tx
    .select({ id: sourceCategories.id })
    .from(sourceCategories)
    .where(and(userScoped(ctx).owns(sourceCategories), eq(sourceCategories.categoryId, categoryId)))
    .limit(1);
  return !other;
}

export interface SourceCategoryHooks {
  /**
   * Called when the change puts the added category away, with the one that takes its place: the
   * budgets of the two are another module's. What it returns is kept for "Undo".
   */
  onArchive?(input: { keepId: string; dropId: string }, tx: Tx): Promise<SourceCategoryUndo["limits"]>;
  /** Called by "Undo" with what `onArchive` returned. */
  onRestore?(limits: NonNullable<SourceCategoryUndo["limits"]>, tx: Tx): Promise<void>;
}

/**
 * Sets where a source's category counts: under another category of the person (`categoryId`), or
 * under its own (`null`, "add as a new category"). The movements of the source that carry it move
 * with it; the category added for it is put away when nothing else needs it, and comes back when
 * the category counts under its own again. Inside the caller's transaction.
 */
export async function chooseSourceCategory(
  ctx: Who,
  input: { id: string; categoryId: string | null },
  tx: Tx,
  hooks: SourceCategoryHooks = {},
): Promise<SourceCategoryChange> {
  const parsed = choiceSchema.safeParse(input);
  if (!parsed.success) throw new SourceCategoryError("invalid");
  const row = await ownRow(ctx, parsed.data.id, tx);
  // With no category of its own (the person deleted it) there is nothing to count under but a
  // match: the next reading makes the category again.
  const targetId = parsed.data.categoryId ?? row.addedCategoryId;
  if (targetId === null) throw new SourceCategoryError("invalid");

  const wanted = [
    ...new Set([targetId, row.addedCategoryId, row.categoryId].filter((id): id is string => id !== null)),
  ];
  const held = await tx
    .select()
    .from(categories)
    .where(and(userScoped(ctx).owns(categories), inArray(categories.id, wanted)))
    .for("update");
  const target = held.find((one) => one.id === targetId);
  const added = held.find((one) => one.id === row.addedCategoryId);
  if (!target) throw new SourceCategoryError("not_found");
  const matching = targetId !== row.addedCategoryId;
  // A match is to a category in use, of the kind the source's own is, or of Transfers: its
  // movements count as transfers then (categories-and-rules.md §2.4).
  const kind = added === undefined || added.type === target.type || target.type === "transfer";
  if (matching && (target.archivedAt !== null || !kind)) {
    throw new SourceCategoryError("invalid");
  }
  const unchanged: SourceCategoryChange = {
    name: row.name,
    categoryName: target.name,
    choice: matching ? "matched" : "added",
    moved: 0,
    undoId: null,
    macro: null,
  };
  if (row.categoryId === targetId) {
    if (row.seenAt === null) await markSeen(ctx, [row.id], tx);
    return unchanged;
  }

  const before: SourceCategoryUndo = {
    categoryId: row.categoryId,
    addedArchived: added !== undefined && added.archivedAt !== null,
    limits: null,
  };
  if (!matching && target.archivedAt !== null) {
    await tx
      .update(categories)
      .set({ archivedAt: null })
      .where(and(eq(categories.id, target.id), userScoped(ctx).owns(categories)));
  }
  const moved = await moveMovements(ctx, row.id, targetId, tx);
  await tx
    .update(sourceCategories)
    .set({ categoryId: targetId, seenAt: row.seenAt ?? new Date() })
    .where(and(eq(sourceCategories.id, row.id), userScoped(ctx).owns(sourceCategories)));
  if (matching && added && added.archivedAt === null && (await isIdle(ctx, added.id, tx))) {
    before.limits = (await hooks.onArchive?.({ keepId: targetId, dropId: added.id }, tx)) ?? null;
    await tx
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(and(eq(categories.id, added.id), userScoped(ctx).owns(categories)));
  }

  // One change can be undone, the last one: the rows before it go.
  await tx.delete(sourceCategoryUndos).where(eq(sourceCategoryUndos.userId, ctx.userId));
  const [undo] = await tx
    .insert(sourceCategoryUndos)
    .values(userScoped(ctx).stamp({ sourceCategoryId: row.id, before }))
    .returning({ id: sourceCategoryUndos.id });
  const from = held.find((one) => one.id === row.categoryId)?.type;
  const macro = from !== undefined && from !== target.type ? { from, to: target.type } : null;
  return { ...unchanged, moved, undoId: undo.id, macro };
}

/**
 * "Undo" of the last change: the category counts where it did, its movements go back, and the
 * category added for it is as it was. `null` when there is nothing to undo any more.
 */
export async function undoSourceCategory(
  ctx: Who,
  undoId: string,
  tx: Tx,
  hooks: SourceCategoryHooks = {},
): Promise<{ moved: number } | null> {
  if (!z.uuid().safeParse(undoId).success) throw new SourceCategoryError("invalid");
  const [undo] = await tx
    .delete(sourceCategoryUndos)
    .where(and(eq(sourceCategoryUndos.id, undoId), eq(sourceCategoryUndos.userId, ctx.userId)))
    .returning();
  if (!undo) return null;
  const row = await ownRow(ctx, undo.sourceCategoryId, tx);
  const { before } = undo;
  // The category it counted under is gone since: it counts under its own.
  const backTo = before.categoryId ?? row.addedCategoryId;
  if (backTo === null) return { moved: 0 };
  const [target] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, backTo), userScoped(ctx).owns(categories)));
  if (!target) return { moved: 0 };
  if (before.limits !== null) await hooks.onRestore?.(before.limits, tx);
  const moved = await moveMovements(ctx, row.id, backTo, tx);
  await tx
    .update(sourceCategories)
    .set({ categoryId: backTo })
    .where(and(eq(sourceCategories.id, row.id), userScoped(ctx).owns(sourceCategories)));
  if (row.addedCategoryId !== null) {
    // The category added for it is as it was before the change: put away, or in use.
    await tx
      .update(categories)
      .set({ archivedAt: before.addedArchived ? new Date() : null })
      .where(
        and(
          eq(categories.id, row.addedCategoryId),
          userScoped(ctx).owns(categories),
          before.addedArchived ? isNull(categories.archivedAt) : isNotNull(categories.archivedAt),
        ),
      );
  }
  return { moved };
}

async function markSeen(ctx: Who, ids: readonly string[], executor: Tx | ReturnType<typeof getDb>) {
  await executor
    .update(sourceCategories)
    .set({ seenAt: new Date() })
    .where(
      and(
        userScoped(ctx).owns(sourceCategories),
        inArray(sourceCategories.id, [...ids]),
        isNull(sourceCategories.seenAt),
      ),
    );
}

/** "Keep as it is": the person has looked at a new category of the source, and it stays added. */
export async function keepSourceCategory(ctx: Who, id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) throw new SourceCategoryError("invalid");
  await markSeen(ctx, [id], getDb());
}
