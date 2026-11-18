// src/app/(app)/settings/categories/merge.ts — the merge of two categories as one use case
// (rewrite plan N3; ux/n3-categories-manual.md §6.3). The categories and their movements are the
// transactions module's, the limits of their budgets are the budgets module's: only the
// application joins them (rule M8), in one transaction — both halves, or nothing.
import "server-only";
import { categoriesWithLimit } from "@ledgerly/domain/budgets";
import { listMergeProposals, type MergeProposal } from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { monthKey, today } from "@ledgerly/domain/shared/dates";

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
// The merge and its "Undo" join two modules in one transaction: they live in `apps/api`, with the routes.
export { mergeTwoCategories, undoMergeOfTwo } from "@ledgerly/api";
