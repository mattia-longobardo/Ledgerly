// src/app/(app)/settings/categories/merge.ts — the merge of two categories as one use case
// (rewrite plan N3; ux/n3-categories-manual.md §6.3). The categories and their movements are the
// transactions module's, the limits of their budgets are the budgets module's: only the
// application joins them (rule M8), in one transaction — both halves, or nothing.
import "server-only";
import { categoriesWithLimit, mergeLimits } from "@/modules/budgets/service";
import {
  listMergeProposals,
  mergeCategories,
  type MergeProposal,
} from "@/modules/transactions/categorize/review";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";

type Who = Pick<Ctx, "userId" | "timeZone">;

/** A proposal with what the dialog has to say before the merge: whether two budgets are summed. */
export interface MergeProposalView extends MergeProposal {
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
): Promise<{ moved: number }> {
  const month = monthKey(today(ctx.timeZone));
  return getDb().transaction(async (tx) => {
    // The limits first: they are read while both categories are still active.
    await mergeLimits(ctx, { ...input, month }, tx);
    return mergeCategories(ctx, input, tx);
  });
}
