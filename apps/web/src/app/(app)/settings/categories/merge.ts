// src/app/(app)/settings/categories/merge.ts — the merge of two categories as one use case
// (rewrite plan N3; ux/n3-categories-manual.md §6.3). The categories and their movements are the
// transactions module's, the limits of their budgets are the budgets module's: only the
// application joins them (rule M8), in one transaction — both halves, or nothing.
import "server-only";
import { z } from "zod";
import { listAccounts } from "@ledgerly/domain/accounts";
import {
  categoriesWithLimit,
  limitsSnapshot,
  type LimitsSnapshot,
  mergeLimits,
  restoreLimits,
} from "@ledgerly/domain/budgets";
import {
  listMergeProposals,
  mergeCategories,
  type MergeProposal,
  type MergeUndo,
  mergeUndoSchema,
  unmergeCategories,
} from "@ledgerly/domain/transactions";
import { TransactionError } from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { monthKey, today } from "@ledgerly/domain/shared/dates";
import { getDb } from "@ledgerly/domain/platform/db";

type Who = Pick<Ctx, "userId" | "timeZone">;

/** A proposal with what the dialog has to say before the merge: whether two budgets are summed. */
interface MergeProposalView extends MergeProposal {
  sumsBudgets: boolean;
}

export async function mergeProposalsView(ctx: Who): Promise<MergeProposalView[]> {
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

/**
 * Merges `dropId` into `keepId`: from this month on the limits of the two budgets are one, the
 * movements of the one are the other's, and the one is archived. Returns how many movements moved.
 */
export async function mergeTwoCategories(
  ctx: Who,
  input: { keepId: string; dropId: string },
): Promise<{ moved: number; undo: MergeUndo & { limits: LimitsSnapshot | null } }> {
  const month = monthKey(today(ctx.timeZone));
  return getDb().transaction(async (tx) => {
    // The limits first: they are read while both categories are still active.
    const before = await limitsSnapshot(ctx, [input.keepId, input.dropId], month, tx);
    const summed = await mergeLimits(ctx, { ...input, month }, tx);
    const { moved, undo } = await mergeCategories(ctx, input, tx);
    return { moved, undo: { ...undo, limits: summed > 0 ? before : null } };
  });
}

const limitsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  categoryIds: z.array(z.uuid()).max(2),
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
    .max(200),
});

/**
 * "Undo" of a merge from the page of the categories: what `mergeTwoCategories` handed back, as the
 * browser kept it. Checked again here — the two categories, the limits on those two only and on
 * the person's own accounts — and applied in one transaction. Returns the movements moved back.
 */
export async function undoMergeOfTwo(ctx: Who, input: unknown): Promise<number> {
  const undo = mergeUndoSchema.extend({ limits: limitsSchema.nullable() }).parse(input);
  const pair = new Set([undo.keepId, undo.dropId]);
  if (undo.limits) {
    const owned = new Set((await listAccounts(ctx, { includeArchived: true })).map((account) => account.id));
    const fits =
      undo.limits.categoryIds.every((id) => pair.has(id)) &&
      undo.limits.rows.every(
        (row) => pair.has(row.categoryId) && (row.accountId === null || owned.has(row.accountId)),
      );
    if (!fits) throw new TransactionError("invalid");
  }
  return getDb().transaction(async (tx) => {
    const moved = await unmergeCategories(ctx, undo, tx);
    if (undo.limits) await restoreLimits(ctx, undo.limits as LimitsSnapshot, tx);
    return moved;
  });
}
