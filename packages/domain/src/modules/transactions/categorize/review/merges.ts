import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../../platform/context";
import { type CivilDate, civilDateIn } from "../../../../shared/dates";
import { getDb, type Tx } from "../../../../platform/db/client";
import { userScoped } from "../../../../platform/db/scope";
import type { UiLocale } from "../../../../platform/format";
import {
  categories,
  categoryGroupMarks,
  categoryMemory,
  categoryMergeDismissals,
  transactions,
} from "../../schema";
import { TransactionError } from "../../service";
import { type MergeCategory, mergeProposals, pairKey } from "../review-rules";
import { DEFAULT_GROUPS } from "../tables";
import { shownText } from "../text";
import { requireCategory } from "../../taxonomy";
import { AUTOMATIC_CATEGORY_ORIGINS } from "../../rules";

type Who = Pick<Ctx, "userId">;

/** A movement similar to one a person just filed, as the dialog lists it. */
interface SimilarRow {
  id: string;
  on: CivilDate;
  amountCents: bigint;
  categoryId: string | null;
  suggestedCategoryId: string | null;
  automatic: boolean;
}

/**
 * The movements with the same text as `id` that Ledgerly may touch (decision K3): automatic or
 * with no category, with a category other than `categoryId`, of the same kind, in every period.
 * Never one with a category a person or a source chose. The newest first.
 */
export async function similarTo(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  categoryId: string,
): Promise<{ text: string; rows: SimilarRow[] }> {
  const [source] = await getDb()
    .select({
      key: transactions.categoryKey,
      type: transactions.type,
      payee: transactions.payee,
      counterparty: transactions.counterpartyName,
      rawText: transactions.rawText,
      note: transactions.note,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), userScoped(ctx).owns(transactions)));
  if (!source || source.key === null || source.key === "") return { text: "", rows: [] };
  const rows = await getDb()
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      suggestedCategoryId: transactions.suggestedCategoryId,
      origin: transactions.categoryOrigin,
    })
    .from(transactions)
    .where(
      and(
        userScoped(ctx).owns(transactions),
        eq(transactions.categoryKey, source.key),
        eq(transactions.type, source.type),
        ne(transactions.id, id),
        isNull(transactions.hiddenAt),
        isNull(transactions.removedUpstreamAt),
        or(
          isNull(transactions.categoryOrigin),
          inArray(transactions.categoryOrigin, [...AUTOMATIC_CATEGORY_ORIGINS]),
        ),
        or(isNull(transactions.categoryId), ne(transactions.categoryId, categoryId)),
      ),
    )
    .orderBy(desc(transactions.occurredAt), transactions.id);
  return {
    text: shownText(source),
    rows: rows.map((row) => ({
      id: row.id,
      on: civilDateIn(row.occurredAt, ctx.timeZone),
      amountCents: row.amountCents,
      categoryId: row.categoryId,
      suggestedCategoryId: row.suggestedCategoryId,
      automatic: row.origin !== null && row.categoryId !== null,
    })),
  };
}

/* Categories that look like the same one */

export interface MergeProposal {
  first: MergeCategory & { usage: number };
  second: MergeCategory & { usage: number };
}

/** The pairs of active categories that look like the same one, with how many movements each has. */
export async function listMergeProposals(ctx: Who): Promise<MergeProposal[]> {
  const [active, dismissed, usage] = await Promise.all([
    getDb()
      .select({
        id: categories.id,
        name: categories.name,
        type: categories.type,
        parentId: categories.parentId,
        providerName: categories.providerName,
      })
      .from(categories)
      .where(and(userScoped(ctx).owns(categories), isNull(categories.archivedAt)))
      .orderBy(categories.name, categories.id),
    getDb()
      .select({ firstId: categoryMergeDismissals.firstId, secondId: categoryMergeDismissals.secondId })
      .from(categoryMergeDismissals)
      .where(userScoped(ctx).owns(categoryMergeDismissals))
      .orderBy(categoryMergeDismissals.firstId, categoryMergeDismissals.secondId),
    getDb()
      .select({ categoryId: transactions.categoryId, total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(userScoped(ctx).owns(transactions), isNotNull(transactions.categoryId)))
      .groupBy(transactions.categoryId)
      .orderBy(transactions.categoryId),
  ]);
  const used = new Map(usage.map((row) => [row.categoryId, row.total]));
  const pairs = mergeProposals(
    active.map((category) => ({ ...category, fromSource: category.providerName !== null })),
    new Set(dismissed.map((row) => pairKey(row.firstId, row.secondId))),
  );
  return pairs.map(([first, second]) => ({
    first: { ...first, usage: used.get(first.id) ?? 0 },
    second: { ...second, usage: used.get(second.id) ?? 0 },
  }));
}

const ordered = (a: string, b: string) => (a < b ? { firstId: a, secondId: b } : { firstId: b, secondId: a });

/** "They are different": the proposal for this pair does not come back. */
export async function dismissMergeProposal(ctx: Who, a: string, b: string): Promise<void> {
  const [first, second] = z.tuple([z.uuid(), z.uuid()]).parse([a, b]);
  for (const id of [first, second]) {
    await requireCategory(ctx, id, () => new TransactionError("invalid_reference"), { active: true });
  }
  await getDb()
    .insert(categoryMergeDismissals)
    .values(userScoped(ctx).stamp(ordered(first, second)))
    .onConflictDoNothing();
}

/** Takes "They are different" back, for the toast's "Undo". */
export async function restoreMergeProposal(ctx: Who, a: string, b: string): Promise<void> {
  const pair = ordered(...z.tuple([z.uuid(), z.uuid()]).parse([a, b]));
  await getDb()
    .delete(categoryMergeDismissals)
    .where(
      and(
        userScoped(ctx).owns(categoryMergeDismissals),
        eq(categoryMergeDismissals.firstId, pair.firstId),
        eq(categoryMergeDismissals.secondId, pair.secondId),
      ),
    );
}

/**
 * Merges `dropId` into `keepId`, inside the caller's transaction (the budgets of the two are
 * another module's, merged by the same caller): the movements and the suggestions of the one go to
 * the other with their state unchanged — an automatic one stays automatic — its sub-categories
 * move under it, and it is archived. Refused for a category a source gives, for two kinds, and
 * where the sub-categories would end on a third level.
 */
/** What a merge changed, for its "Undo" (categories-and-rules.md §5.6): ids only, no amount. */
export interface MergeUndo {
  keepId: string;
  dropId: string;
  movedIds: string[];
  suggestedIds: string[];
  childIds: string[];
  /** The default group the one put away stood for (`category_group_marks`), if any. */
  groupKey: string | null;
}

export const mergeUndoSchema = z.object({
  keepId: z.uuid(),
  dropId: z.uuid(),
  movedIds: z.array(z.uuid()).max(100_000),
  suggestedIds: z.array(z.uuid()).max(100_000),
  childIds: z.array(z.uuid()).max(500),
  groupKey: z.string().max(60).nullable(),
});

export async function mergeCategories(
  ctx: Who,
  input: { keepId: string; dropId: string },
  tx: Tx,
): Promise<{ moved: number; undo: MergeUndo }> {
  const { keepId, dropId } = z.object({ keepId: z.uuid(), dropId: z.uuid() }).parse(input);
  if (keepId === dropId) throw new TransactionError("invalid");
  const rows = await tx
    .select()
    .from(categories)
    .where(
      and(
        userScoped(ctx).owns(categories),
        inArray(categories.id, [keepId, dropId]),
        isNull(categories.archivedAt),
      ),
    )
    .for("update");
  const keep = rows.find((row) => row.id === keepId);
  const drop = rows.find((row) => row.id === dropId);
  if (!keep || !drop) throw new TransactionError("not_found");
  if (keep.type !== drop.type || keep.providerName !== null || drop.providerName !== null) {
    throw new TransactionError("invalid");
  }
  const children = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(userScoped(ctx).owns(categories), eq(categories.parentId, dropId)));
  if (children.length > 0 && keep.parentId !== null) throw new TransactionError("invalid");

  const moved = await tx
    .update(transactions)
    .set({ categoryId: keepId })
    .where(and(userScoped(ctx).owns(transactions), eq(transactions.categoryId, dropId)))
    .returning({ id: transactions.id });
  const suggested = await tx
    .update(transactions)
    .set({ suggestedCategoryId: keepId })
    .where(and(userScoped(ctx).owns(transactions), eq(transactions.suggestedCategoryId, dropId)))
    .returning({ id: transactions.id });
  // The memory is rewritten at the next training; until then what it knew of the one is the other's.
  await tx
    .delete(categoryMemory)
    .where(and(eq(categoryMemory.userId, ctx.userId), eq(categoryMemory.categoryId, dropId)));
  const [mark] = await tx
    .delete(categoryGroupMarks)
    .where(eq(categoryGroupMarks.categoryId, dropId))
    .returning({ groupKey: categoryGroupMarks.groupKey });
  if (children.length > 0) {
    await tx
      .update(categories)
      .set({ parentId: keepId, parentSetLocally: true })
      .where(and(userScoped(ctx).owns(categories), eq(categories.parentId, dropId)));
  }
  await tx
    .update(categories)
    .set({ archivedAt: new Date() })
    .where(and(eq(categories.id, dropId), userScoped(ctx).owns(categories)));
  return {
    moved: moved.length,
    undo: {
      keepId,
      dropId,
      movedIds: moved.map((row) => row.id),
      suggestedIds: suggested.map((row) => row.id),
      childIds: children.map((row) => row.id),
      groupKey: mark?.groupKey ?? null,
    },
  };
}

/**
 * "Undo" of a merge, inside the caller's transaction: the one put away comes back with its
 * movements, suggestions and sub-categories — only those still in the one that stayed. The memory
 * of the classifier is rewritten at the next training, as after the merge. Returns the movements
 * moved back.
 */
export async function unmergeCategories(ctx: Who, input: unknown, tx: Tx): Promise<number> {
  const undo = mergeUndoSchema.parse(input);
  const [drop] = await tx
    .update(categories)
    .set({ archivedAt: null })
    .where(and(eq(categories.id, undo.dropId), userScoped(ctx).owns(categories)))
    .returning({ id: categories.id });
  if (!drop) throw new TransactionError("not_found");
  const back = (column: typeof transactions.categoryId | typeof transactions.suggestedCategoryId) =>
    and(userScoped(ctx).owns(transactions), eq(column, undo.keepId));
  let moved = 0;
  // In slices: a list of ids is one parameter each, and Postgres takes 65535 of them at most.
  for (let start = 0; start < undo.movedIds.length; start += 5000) {
    const ids = undo.movedIds.slice(start, start + 5000);
    const rows = await tx
      .update(transactions)
      .set({ categoryId: undo.dropId })
      .where(and(back(transactions.categoryId), inArray(transactions.id, ids)))
      .returning({ id: transactions.id });
    moved += rows.length;
  }
  for (let start = 0; start < undo.suggestedIds.length; start += 5000) {
    const ids = undo.suggestedIds.slice(start, start + 5000);
    await tx
      .update(transactions)
      .set({ suggestedCategoryId: undo.dropId })
      .where(and(back(transactions.suggestedCategoryId), inArray(transactions.id, ids)));
  }
  if (undo.childIds.length > 0) {
    await tx
      .update(categories)
      .set({ parentId: undo.dropId })
      .where(
        and(
          userScoped(ctx).owns(categories),
          eq(categories.parentId, undo.keepId),
          inArray(categories.id, undo.childIds),
        ),
      );
  }
  if (undo.groupKey !== null) {
    await tx
      .insert(categoryGroupMarks)
      .values(userScoped(ctx).stamp({ categoryId: undo.dropId, groupKey: undo.groupKey }))
      .onConflictDoNothing();
  }
  return moved;
}

/* Default groups */

/**
 * Creates the default groups a person chose (decision K4), with their names in the person's
 * language, and marks each so the static tables can point at it. Only for a person with no active
 * category: anybody else already has their own, and gets nothing added.
 */
export async function createDefaultGroups(
  ctx: Who,
  keys: readonly string[],
  locale: UiLocale,
): Promise<number> {
  const wanted = DEFAULT_GROUPS.filter((group) => keys.includes(group.key));
  if (wanted.length === 0) throw new TransactionError("invalid");
  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(userScoped(ctx).owns(categories), isNull(categories.archivedAt)))
      .limit(1);
    if (existing) throw new TransactionError("invalid");
    for (const group of wanted) {
      const [row] = await tx
        .insert(categories)
        .values(userScoped(ctx).stamp({ name: locale === "it" ? group.it : group.en, type: group.type }))
        .onConflictDoNothing()
        .returning({ id: categories.id });
      // An archived category already holds the name: the group is skipped, never resurrected.
      if (!row) continue;
      await tx
        .insert(categoryGroupMarks)
        .values(userScoped(ctx).stamp({ categoryId: row.id, groupKey: group.key }))
        .onConflictDoNothing();
    }
    return wanted.length;
  });
}
