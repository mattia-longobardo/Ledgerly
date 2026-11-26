// Transactions · «To review» and the automatic categories: the read of its page and the choices of
// `categorize/actions.ts`. A person's choice is learnt from after the answer, in the worker.
import type { Hono } from "hono";
import { TRANSACTIONS } from "@ledgerly/api-contract";
import {
  categorisableAccountIds,
  categoryCounts,
  changeCategories,
  createDefaultGroups,
  dismissMergeProposal,
  isPreparing,
  listMergeProposals,
  restoreMergeProposal,
  reviewOf,
  reviewTotals,
  similarTo,
  suggestionsForMovement,
  undoChange,
  type ReviewGroup,
} from "@ledgerly/domain/transactions";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { refusing, type TransactionCases } from "./cases";
import { money } from "./dto";

const { review } = TRANSACTIONS;

type Row = ReviewGroup["rows"][number];
const reviewRow = (row: Row) => ({
  id: row.id,
  text: row.text,
  on: row.on,
  accountId: row.accountId,
  amount: money(row.amountCents),
  suggestedCategoryId: row.suggestedCategoryId,
  reason: row.reason,
  params: row.params,
});
const reviewGroup = (group: ReviewGroup) => ({
  id: group.id,
  text: group.text,
  count: group.count,
  total: money(group.totalCents),
  suggestedCategoryId: group.suggestedCategoryId,
  reason: group.reason,
  params: group.params,
  rows: group.rows.map(reviewRow),
});

function serveReviewPage(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, review.getReview, async ({ ctx, query }) => {
    const [eligible, proposals, preparing] = await Promise.all([
      categorisableAccountIds(ctx),
      listMergeProposals(ctx),
      isPreparing(ctx),
    ]);
    const selected = (query.accounts ?? []).filter((id) => eligible.includes(id));
    const accountIds = selected.length > 0 ? selected : eligible;
    const [found, counts] = await Promise.all([
      accountIds.length === 0
        ? { suggested: [], unsuggested: [], singles: [] }
        : reviewOf(ctx, { from: query.from, to: query.to, accountIds }),
      categoryCounts(ctx, accountIds),
    ]);
    const totals = reviewTotals(found);
    return {
      accountIds: eligible,
      preparing,
      suggested: found.suggested.map(reviewGroup),
      unsuggested: found.unsuggested.map(reviewGroup),
      singles: found.singles.map(reviewRow),
      mergeProposals: proposals,
      count: totals.count,
      total: money(totals.totalCents),
      counts,
    };
  });
}

export function serveReview(app: Hono<ApiEnv>, guard: Guard, cases: TransactionCases): void {
  serveReviewPage(app, guard);
  serve(app, guard, review.confirmCategories, async ({ ctx, body }) => {
    const done = await refusing(changeCategories(ctx, body.ids, { kind: "confirm" }));
    // Every confirmation or correction trains the model again (PERS-634), not only the memory.
    if (done.count > 0) await cases.learn(ctx, true);
    return done;
  });
  serve(app, guard, review.chooseCategory, async ({ ctx, body }) => {
    const done = await refusing(
      changeCategories(ctx, body.ids, { kind: "set", categoryId: body.categoryId }),
    );
    if (done.count > 0) await cases.learn(ctx, true);
    return done;
  });
  serve(app, guard, review.undoCategories, async ({ ctx, params }) => ({
    count: await refusing(undoChange(ctx, params.undoId)),
  }));
  serve(app, guard, review.listSimilarMovements, async ({ ctx, params, query }) => {
    const similar = await similarTo(ctx, params.id, query.categoryId);
    return {
      text: similar.text,
      rows: similar.rows.map((row) => ({
        id: row.id,
        on: row.on,
        amount: money(row.amountCents),
        categoryId: row.categoryId,
        suggestedCategoryId: row.suggestedCategoryId,
        automatic: row.automatic,
      })),
    };
  });
  serve(app, guard, review.dismissMergeProposal, ({ ctx, body }) =>
    refusing(dismissMergeProposal(ctx, body.firstId, body.secondId)),
  );
  serve(app, guard, review.restoreMergeProposal, ({ ctx, body }) =>
    refusing(restoreMergeProposal(ctx, body.firstId, body.secondId)),
  );
  serve(app, guard, review.getCategorySuggestions, async ({ ctx, params }) => {
    const found = await refusing(suggestionsForMovement(ctx, params.id));
    if (found === null) throw new ApiRefusal("not_found");
    return { categoryId: found.suggestion?.categoryId ?? null, top: found.top };
  });
  serve(app, guard, review.createDefaultGroups, async ({ ctx, body }) => {
    const count = await refusing(createDefaultGroups(ctx, body.keys, ctx.locale));
    await cases.learn(ctx, true);
    return { count };
  });
}
