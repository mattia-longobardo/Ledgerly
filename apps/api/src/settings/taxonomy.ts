// The changes of the categories that touch more than one module, as one use case each (rewrite plan
// N3, N3.1; ux/n3-categories-manual.md §6.3-§6.4): the categories and their movements are the
// transactions module's, the limits of the budgets are the budgets module's, the facts of pockets,
// interests and subscriptions are theirs. Only the app joins them (rule M8), in one transaction —
// every half, or nothing. The Server Actions and the routes call these. Moved from `apps/web`.
import { z } from "zod";
import { listAccounts } from "@ledgerly/domain/accounts";
import {
  limitsSnapshot,
  type LimitsSnapshot,
  mergeLimits,
  restoreLimits,
  stopLimitsOf,
} from "@ledgerly/domain/budgets";
import { postsUnderAny } from "@ledgerly/domain/interests";
import { expensesAmong } from "@ledgerly/domain/pockets";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { getDb } from "@ledgerly/domain/platform/db";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { chargesAmong } from "@ledgerly/domain/subscriptions";
import {
  type CategoryType,
  chooseSourceCategory,
  getCategory,
  type MacroPlace,
  macroMoveFacts,
  mergeCategories,
  type MergeUndo,
  mergeUndoSchema,
  moveCategoryToMacro,
  movesBetweenMacros,
  type SourceCategoryChange,
  type SourceCategoryHooks,
  sourceNamesByCategory,
  TransactionError,
  undoSourceCategory,
  unmergeCategories,
} from "@ledgerly/domain/transactions";

type Who = Pick<Ctx, "userId" | "timeZone">;

/** The name a person reads for a source; the web's registry of providers says it until E5 (R2). */
export type SourceName = (provider: string, locale: Ctx["locale"]) => Promise<string>;

/** The limits an «Undo» brings back, checked again: kept by the client, so read like any input. */
function limitsSchema(most: { categories: number; rows: number }) {
  return z.object({
    month: z.string().regex(/^\d{4}-\d{2}-01$/),
    categoryIds: z.array(z.uuid()).max(most.categories),
    rows: z
      .array(
        z.object({
          categoryId: z.uuid(),
          accountId: z.uuid().nullable(),
          fromMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
          amountCents: z
            .string()
            .regex(/^-?\d{1,15}$/)
            .nullable(),
          stopped: z.boolean(),
        }),
      )
      .max(most.rows),
  });
}

/** True when every limit is of one of `ids` and of an account of the person. */
async function limitsFit(ctx: Who, limits: LimitsSnapshot, ids: ReadonlySet<string>): Promise<boolean> {
  const owned = new Set((await listAccounts(ctx, { includeArchived: true })).map((account) => account.id));
  return (
    limits.categoryIds.every((id) => ids.has(id)) &&
    limits.rows.every(
      (row) => ids.has(row.categoryId) && (row.accountId === null || owned.has(row.accountId)),
    )
  );
}

/* Merge of two categories (N3). */

export async function mergeTwoCategories(
  ctx: Who,
  input: { keepId: string; dropId: string },
): Promise<{ moved: number; undo: MergeUndo & { limits: LimitsSnapshot | null } }> {
  const month = monthKey(today(ctx.timeZone));
  return getDb().transaction(async (transaction) => {
    // The limits first: they are read while both categories are still active.
    const before = await limitsSnapshot(ctx, [input.keepId, input.dropId], month, transaction);
    const summed = await mergeLimits(ctx, { ...input, month }, transaction);
    const { moved, undo } = await mergeCategories(ctx, input, transaction);
    return { moved, undo: { ...undo, limits: summed > 0 ? before : null } };
  });
}

export async function undoMergeOfTwo(ctx: Who, input: unknown): Promise<number> {
  const undo = mergeUndoSchema
    .extend({ limits: limitsSchema({ categories: 2, rows: 200 }).nullable() })
    .parse(input);
  if (undo.limits && !(await limitsFit(ctx, undo.limits, new Set([undo.keepId, undo.dropId])))) {
    throw new TransactionError("invalid");
  }
  return getDb().transaction(async (transaction) => {
    const moved = await unmergeCategories(ctx, undo, transaction);
    if (undo.limits) await restoreLimits(ctx, undo.limits, transaction);
    return moved;
  });
}

/* The categories of a source (N3.1). */

/** For each category: "From {source}: {names}", where the names say more than the category's own. */
export async function sourceNotes(
  ctx: Pick<Ctx, "userId" | "locale">,
  nameOf: SourceName,
): Promise<Map<string, { provider: string; source: string; names: string[] }>> {
  const byCategory = await sourceNamesByCategory(ctx);
  const notes = new Map<string, { provider: string; source: string; names: string[] }>();
  for (const [categoryId, entry] of byCategory) {
    notes.set(categoryId, {
      provider: entry.provider,
      source: await nameOf(entry.provider, ctx.locale),
      names: entry.names,
    });
  }
  return notes;
}

/** The budgets' side of a change: the limits of a category put away go to the one that stays. */
function limitHooks(ctx: Who): SourceCategoryHooks {
  const month = monthKey(today(ctx.timeZone));
  return {
    async onArchive({ keepId, dropId }, transaction) {
      const before = await limitsSnapshot(ctx, [keepId, dropId], month, transaction);
      const summed = await mergeLimits(ctx, { keepId, dropId, month }, transaction);
      return summed > 0 ? before : null;
    },
    onRestore: (limits, transaction) => restoreLimits(ctx, limits, transaction),
  };
}

/** Matches a source's category to a category of the person, or adds it back as its own (`null`). */
export async function setSourceCategory(
  ctx: Who,
  input: { id: string; categoryId: string | null },
): Promise<SourceCategoryChange> {
  return getDb().transaction((transaction) => chooseSourceCategory(ctx, input, transaction, limitHooks(ctx)));
}

/** "Undo" of the last change. `null` when it can no longer be undone. */
export async function undoSourceCategoryChange(ctx: Who, undoId: string): Promise<{ moved: number } | null> {
  return getDb().transaction((transaction) => undoSourceCategory(ctx, undoId, transaction, limitHooks(ctx)));
}

/* Move to another macro (§5.6, QC8). */

/** What the dialog says before the move: the numbers that change (§3.3, §3.5, QC8). */
export interface MacroMoveView {
  from: CategoryType;
  /** Movements that count in `from` now and will not, their total (absolute), the first year. */
  count: number;
  amountCents: bigint;
  firstYear: number | null;
  linked: { subscriptions: number; pockets: number; interests: number };
  /** Whether a budget of the category stops from this month (a move to Transfers). */
  stopsBudget: boolean;
  /** The names of the sources whose categories count under it: their movements move too. */
  sources: string[];
}

export async function macroMoveView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "locale">,
  id: string,
  nameOf: SourceName,
): Promise<MacroMoveView> {
  const category = await getCategory(ctx, id);
  if (!movesBetweenMacros(category)) throw new TransactionError("invalid");
  const facts = await macroMoveFacts(ctx, category.id);
  const counting = facts.byType[category.type] ?? 0n;
  const month = monthKey(today(ctx.timeZone));
  const [subscriptions, pockets, interests, limits, sources] = await Promise.all([
    chargesAmong(ctx, facts.movementIds),
    expensesAmong(ctx, facts.movementIds),
    postsUnderAny(ctx, facts.ids),
    getDb().transaction((transaction) => limitsSnapshot(ctx, facts.ids, month, transaction)),
    sourceNotes(ctx, nameOf),
  ]);
  const names = facts.ids.flatMap((one) => {
    const note = sources.get(one);
    return note ? [note.source] : [];
  });
  return {
    from: category.type,
    count: facts.countByType[category.type] ?? 0,
    amountCents: counting < 0n ? -counting : counting,
    firstYear: facts.firstYear,
    linked: { subscriptions, pockets, interests: interests ? (facts.countByType.income ?? 0) : 0 },
    stopsBudget: limits.rows.some((row) => !row.stopped),
    sources: [...new Set(names)].sort(),
  };
}

/** What "Undo" is asked with: kept by the client, checked again here. */
export interface MacroMoveUndo {
  id: string;
  place: MacroPlace;
  limits: LimitsSnapshot | null;
}

const goesToTransfers = (place: unknown) =>
  z.object({ type: z.literal("transfer") }).safeParse(place).success;

/**
 * Moves a group, or a category of Transfers, to another macro. A move to Transfers stops its
 * budgets from this month (QC8). Returns what "Undo" needs.
 */
export async function moveToMacro(ctx: Who, id: string, place: unknown): Promise<MacroMoveUndo> {
  const month = monthKey(today(ctx.timeZone));
  const facts = await macroMoveFacts(ctx, id);
  return getDb().transaction(async (transaction) => {
    let limits: LimitsSnapshot | null = null;
    if (goesToTransfers(place)) {
      const before = await limitsSnapshot(ctx, facts.ids, month, transaction);
      if ((await stopLimitsOf(ctx, facts.ids, month, transaction)) > 0 || before.rows.length > 0)
        limits = before;
    }
    const left = await moveCategoryToMacro(ctx, facts.ids[0], place, transaction);
    return { id: facts.ids[0], place: left, limits };
  });
}

const macroUndoSchema = z.object({
  id: z.uuid(),
  place: z.object({ type: z.enum(["income", "expense", "transfer"]), parentId: z.uuid().nullable() }),
  limits: limitsSchema({ categories: 500, rows: 500 }).nullable(),
});

/**
 * "Undo" of a move: the category goes back to its macro and place, and the budgets it stopped
 * come back. The limits are checked against the category's own ids and the person's accounts.
 */
export async function undoMoveToMacro(ctx: Who, input: unknown): Promise<void> {
  const undo = macroUndoSchema.parse(input);
  const facts = await macroMoveFacts(ctx, undo.id);
  if (undo.limits && !(await limitsFit(ctx, undo.limits, new Set(facts.ids))))
    throw new TransactionError("invalid");
  await getDb().transaction(async (transaction) => {
    await moveCategoryToMacro(ctx, undo.id, undo.place, transaction, { restoring: true });
    if (undo.limits) await restoreLimits(ctx, undo.limits, transaction);
  });
}
