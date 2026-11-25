import { and, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  categories,
  sourceCategories,
  sourceCategoryUndos,
  type SourceCategoryUndo,
  transactions,
} from "../schema";
import { retypeMovements } from "../macro";
import type { CategoryType } from "../rules";
import { type SourceCategoryChoice } from "../source-rules";
import { SourceCategoryError, type Row } from "./reading";
import type { Ctx } from "../../../platform/context";

type Who = Pick<Ctx, "userId">;

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
  // A match is to a category in use, of the kind the source's own is (categories-and-rules.md §2.4).
  const kind = added === undefined || added.type === target.type;
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

/* "Turn off" a source (plugin-settings.md §3.2) */

/** How many categories of a source the person has: what the dialog of "Turn off" counts (§3.3). */
export async function sourceCategoryCount(ctx: Who, provider: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(sourceCategories)
    .where(and(userScoped(ctx).owns(sourceCategories), eq(sourceCategories.provider, provider)));
  return row?.n ?? 0;
}

/**
 * Forgets the categories of a source and their match, inside the caller's transaction. Each
 * movement keeps the category it counts under here (`transactions.category_id` is written), and a
 * category added for one stays a category of Ledgerly: no number moves. The movements lose only
 * the source's category (`on delete set null`), and "Undo" of a match goes with it (cascade).
 */
export async function forgetSourceCategories(tx: Tx, ctx: Who, provider: string): Promise<number> {
  const rows = await tx
    .delete(sourceCategories)
    .where(and(userScoped(ctx).owns(sourceCategories), eq(sourceCategories.provider, provider)))
    .returning({ id: sourceCategories.id });
  return rows.length;
}
