import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { externalIdsOf, unlinkEntities } from "../../../platform/integrations/service";
import { CATEGORY_TYPES, type CategoryType, markCategoryEdited } from "../rules";
import { retypeMovements } from "../macro";
import type { TransactionsProvider } from "../ports";
import { categories, transactions } from "../schema";
import {
  CATEGORY_ENTITY,
  CATEGORY_ORDER,
  GROUP_ENTITY,
  TaxonomyError,
  categoryById,
  categoryInputSchema,
  duplicateAware,
  getCategory,
  hasChildren,
  idSchema,
  parentFor,
  parentSchema,
  parsed,
  type Category,
} from "./category-reads";

/** A sub-category always has its group's type (spec §7.2, F2.5), whatever the input said. */
export async function createCategory(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Category> {
  const values = parsed(categoryInputSchema, input);
  const parent = await parentFor(ctx, values.parentId, null);
  try {
    const [row] = await getDb()
      .insert(categories)
      .values(userScoped(ctx).stamp({ ...values, type: parent?.type ?? values.type }))
      .returning();
    return row;
  } catch (error) {
    return duplicateAware(error);
  }
}

/**
 * Name, parent, type and colour in one write: the edit dialog submits all four together. Moving a
 * category under a group gives it the group's type; changing a group's type takes its
 * sub-categories along, in the same transaction, so a child and its parent never disagree.
 */
export async function updateCategory(
  ctx: Pick<Ctx, "userId">,
  id: string,
  input: unknown,
): Promise<Category> {
  const categoryId = parsed(idSchema, id);
  const values = parsed(categoryInputSchema, input);
  const current = await categoryById(ctx, categoryId);
  if (!current) throw new TaxonomyError("not_found");
  const parent = await parentFor(ctx, values.parentId, categoryId);
  // A group with sub-categories cannot go inside another one: that would be a third level. The
  // foreign key refuses it too; asking first gives the person a reason rather than an error.
  if (parent && (await hasChildren(ctx, categoryId))) throw new TaxonomyError("invalid_parent");
  const type = parent?.type ?? values.type;
  // Choosing the group by hand — into one, out of one, or into another — is a local edit the sync
  // must not undo (spec §7.2); a rename that leaves the group alone is not that choice.
  const parentSetLocally = current.parentSetLocally || current.parentId !== values.parentId;
  // A name or a type changed *here* is marked the way §7.2 marks a movement's fields. For the name
  // that is not only "never overwrite it": the next pass of the provider writes it there and clears
  // the marker (its integration's category sync), which is what makes the two-way sync
  // settle instead of swinging between the two names. The baseline is deliberately left alone:
  // it still holds the name the provider last published, which is how the pass tells a rename
  // that only happened here from one that happened on both sides.
  const edited = [
    ...(values.name === current.name ? [] : (["name"] as const)),
    ...(type === current.type ? [] : (["type"] as const)),
  ];
  const locallyEdited = markCategoryEdited(current.locallyEdited, edited);
  let row: Category | undefined;
  try {
    row = await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(categories)
        .set({ ...values, type, parentSetLocally, locallyEdited })
        .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)))
        .returning();
      if (updated?.parentId === null) {
        await tx
          .update(categories)
          // The children's type follows their group by rule (F2.5), so it is not a choice made on
          // each of them: only the group carries the `type` marker.
          .set({ type })
          .where(
            and(
              eq(categories.parentId, updated.id),
              ne(categories.type, type),
              userScoped(ctx).owns(categories),
            ),
          );
      }
      // Another macro changes how its movements count (CR3).
      if (type !== current.type) await retypeMovements(tx, ctx);
      return updated;
    });
  } catch (error) {
    return duplicateAware(error);
  }
  if (!row) throw new TaxonomyError("not_found");
  return row;
}

export async function renameCategory(ctx: Pick<Ctx, "userId">, id: string, name: string): Promise<Category> {
  const current = await getCategory(ctx, id);
  return updateCategory(ctx, current.id, {
    name,
    parentId: current.parentId,
    type: current.type,
    color: current.color,
  });
}

/**
 * Archiving a group archives its active sub-categories with the same moment (F2.5): a group put
 * away should not leave its children offered in every picker. Restoring brings the group alone
 * back, because which of its children are still wanted is not something this can know.
 */
async function setArchived(ctx: Pick<Ctx, "userId">, id: string, archivedAt: Date | null): Promise<string[]> {
  const categoryId = parsed(idSchema, id);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({ archivedAt })
      .where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)))
      .returning({ id: categories.id, parentId: categories.parentId });
    if (!row) throw new TaxonomyError("not_found");
    if (archivedAt === null || row.parentId !== null) return [row.id];
    const children = await tx
      .update(categories)
      .set({ archivedAt })
      .where(
        and(eq(categories.parentId, row.id), isNull(categories.archivedAt), userScoped(ctx).owns(categories)),
      )
      .returning({ id: categories.id });
    return [row.id, ...children.map((child) => child.id)];
  });
}

/**
 * A category is archived, never deleted (spec §7.2): the movements filed under it keep their
 * history, and the name stays taken so the next sync adopts this row instead of making a twin.
 */
/** Returns the ids it archived, the group's own sub-categories with it: what "Undo" restores. */
export async function archiveCategory(ctx: Pick<Ctx, "userId">, id: string): Promise<string[]> {
  return setArchived(ctx, id, new Date());
}

export async function restoreCategory(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await setArchived(ctx, id, null);
}

/** "Undo" of an archive (categories-and-rules.md §5.6): the categories it put away, all of them. */
export async function restoreCategories(ctx: Pick<Ctx, "userId">, ids: readonly string[]): Promise<number> {
  const wanted = z.array(idSchema).min(1).max(500).safeParse(ids);
  if (!wanted.success) throw new TaxonomyError("invalid");
  const rows = await getDb()
    .update(categories)
    .set({ archivedAt: null })
    .where(and(inArray(categories.id, wanted.data), userScoped(ctx).owns(categories)))
    .returning({ id: categories.id });
  return rows.length;
}

/**
 * "Move to another group" (categories-and-rules.md §5.6): a category goes under another group of the
 * same macro, so no movement counts differently. Returns the group it left, for "Undo".
 */
export async function moveCategory(
  ctx: Pick<Ctx, "userId">,
  id: string,
  parentId: string,
): Promise<{ fromId: string }> {
  const current = await getCategory(ctx, id);
  if (current.parentId === null) throw new TaxonomyError("invalid_parent");
  const target = await categoryById(ctx, parsed(idSchema, parentId));
  if (!target || target.type !== current.type) {
    throw new TaxonomyError("invalid_parent");
  }
  await updateCategory(ctx, current.id, {
    name: current.name,
    parentId: target.id,
    type: current.type,
    color: current.color,
  });
  return { fromId: current.parentId };
}

/** Where a category is in the tree: what "Move to another section" changes and "Undo" puts back. */
export interface MacroPlace {
  type: CategoryType;
  parentId: string | null;
}

const macroPlaceSchema = z.object({ type: z.enum(CATEGORY_TYPES), parentId: parentSchema });

/**
 * Whether "Move to another section" is offered for a category (categories-and-rules.md §5.6): a
 * group of Income or Expenses. A category in a group moves with it.
 */
export function movesBetweenMacros(category: Pick<Category, "type" | "parentId">): boolean {
  return category.parentId === null;
}

/**
 * The category and its sub-categories, with what "Move to another section" would change: how many
 * movements and their total by the type they count as now, and the first year they are in.
 */
export async function macroMoveFacts(
  ctx: Pick<Ctx, "userId">,
  id: string,
): Promise<{
  ids: string[];
  movementIds: string[];
  byType: Partial<Record<string, bigint>>;
  countByType: Partial<Record<string, number>>;
  firstYear: number | null;
}> {
  const current = await getCategory(ctx, id);
  const children = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, current.id), userScoped(ctx).owns(categories)));
  const ids = [current.id, ...children.map((child) => child.id)];
  const rows = await getDb()
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCents: transactions.amountCents,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.categoryId, ids),
        isNull(transactions.hiddenAt),
        userScoped(ctx).owns(transactions),
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id));
  const byType: Partial<Record<string, bigint>> = {};
  const countByType: Partial<Record<string, number>> = {};
  for (const row of rows) {
    byType[row.type] = (byType[row.type] ?? 0n) + row.amountCents;
    countByType[row.type] = (countByType[row.type] ?? 0) + 1;
  }
  return {
    ids,
    movementIds: rows.map((row) => row.id),
    byType,
    countByType,
    firstYear: rows[0]?.occurredAt.getUTCFullYear() ?? null,
  };
}

/**
 * "Move to another section" (categories-and-rules.md §5.6): a group, with its categories, or a
 * category of Transfers goes to another macro — under a group of it, or as a group of its own. Its
 * movements count as the new macro says (CR3), in the caller's transaction. Returns the place it
 * left, for "Undo", which calls this again with it and `restoring`: a category of an old group of
 * Transfers (a source's, §2.2) goes back under it.
 */
export async function moveCategoryToMacro(
  ctx: Pick<Ctx, "userId">,
  id: string,
  input: unknown,
  tx: Tx,
  options: { restoring?: boolean } = {},
): Promise<MacroPlace> {
  const place = parsed(macroPlaceSchema, input);
  const [current] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.id, parsed(idSchema, id)), userScoped(ctx).owns(categories)))
    .for("update");
  if (!current) throw new TaxonomyError("not_found");
  if (!movesBetweenMacros(current) || place.type === current.type) throw new TaxonomyError("invalid");
  let parentId: string | null = null;
  if (place.parentId !== null) {
    const [parent] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.id, place.parentId), userScoped(ctx).owns(categories)));
    const [child] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.parentId, current.id), userScoped(ctx).owns(categories)))
      .limit(1);
    // A group of the macro of arrival, and no third level.
    const refused = options.restoring !== true && parent?.archivedAt !== null;
    if (!parent || parent.parentId !== null || parent.type !== place.type || refused || child) {
      throw new TaxonomyError("invalid_parent");
    }
    parentId = parent.id;
  }
  await tx
    .update(categories)
    .set({
      type: place.type,
      parentId,
      parentSetLocally: current.parentSetLocally || current.parentId !== parentId,
      locallyEdited: markCategoryEdited(current.locallyEdited, ["type"]),
    })
    .where(and(eq(categories.id, current.id), userScoped(ctx).owns(categories)));
  await tx
    .update(categories)
    .set({ type: place.type })
    .where(and(eq(categories.parentId, current.id), userScoped(ctx).owns(categories)));
  await retypeMovements(tx, ctx);
  return { type: current.type, parentId: current.parentId };
}

/** What a deletion took with it, so the screen can say it rather than guess. */
interface CategoryDeletion {
  /** The category asked for, and its sub-categories: all of them go together. */
  removed: { id: string; name: string; parentId: string | null }[];
  /** The provider's own ids for those categories, for whoever propagates the deletion. */
  externalIds: string[];
  /** Movements that were filed under one of them and are now uncategorised. */
  uncategorised: number;
}

/**
 * Deletes a category for good, with its sub-categories (owner, 2026-09-21).
 *
 * This is deliberately **not** what spec §7.2 wrote — a category was archived and never deleted —
 * and the owner asked for the other thing, twice and in as many words. What archiving bought was
 * that history kept its labels; what it cost was a list that only ever grew. So both exist: the
 * screen offers archiving as the reversible move and this as the irreversible one, and says which
 * is which.
 *
 * What goes with it is decided by the foreign keys that were already there: a movement and a
 * subscription lose their category (`set null`), a budget on it is deleted (`cascade`), an interest
 * rule stops publishing under it (`set null`). The sub-categories go first because the self key
 * carries a generated column and so can have no `ON DELETE` action of its own.
 *
 * The provider's ids are read **before** the rows go and handed back rather than used: the network
 * call that would spend them has no business inside this transaction (spec §4.3), and the caller
 * is the one that knows whether the person asked for it.
 */
export async function deleteCategory(
  ctx: Pick<Ctx, "userId">,
  id: string,
  source: Pick<TransactionsProvider, "provider">,
): Promise<CategoryDeletion> {
  const categoryId = parsed(idSchema, id);
  const category = await categoryById(ctx, categoryId);
  if (!category) throw new TaxonomyError("not_found");
  const children = await getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.parentId, categoryId), userScoped(ctx).owns(categories)))
    .orderBy(...CATEGORY_ORDER);
  const doomed = [category, ...children];
  const ids = doomed.map((one) => one.id);

  const [links, groupLinks, [counted]] = await Promise.all([
    externalIdsOf(ctx, source.provider, CATEGORY_ENTITY, ids),
    externalIdsOf(ctx, source.provider, GROUP_ENTITY, ids),
    getDb()
      .select({ n: count() })
      .from(transactions)
      .where(and(inArray(transactions.categoryId, ids), userScoped(ctx).owns(transactions))),
  ]);

  await getDb().transaction(async (tx) => {
    if (children.length > 0) {
      await tx.delete(categories).where(
        and(
          inArray(
            categories.id,
            children.map((one) => one.id),
          ),
          userScoped(ctx).owns(categories),
        ),
      );
    }
    await tx.delete(categories).where(and(eq(categories.id, categoryId), userScoped(ctx).owns(categories)));
    // Its movements have no category now: the sign decides (CR3).
    await retypeMovements(tx, ctx);
  });

  // The links outlive their rows — `provider_links` points at an id, with no key to cascade — so
  // they are cleared here. A link left behind would make the next pass adopt a category that is
  // gone and file movements under nothing.
  for (const entity of [CATEGORY_ENTITY, GROUP_ENTITY]) {
    await unlinkEntities(ctx, source.provider, entity, ids);
  }

  return {
    removed: doomed.map((one) => ({ id: one.id, name: one.name, parentId: one.parentId })),
    externalIds: [...new Set([...links.values(), ...groupLinks.values()])],
    uncategorised: Number(counted?.n ?? 0),
  };
}
