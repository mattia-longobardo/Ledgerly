// Transactions (rewrite plan R2, 05-refactor.md §5.5): every route of the module. What is the domain's
// is called here; what the web still holds (the manual movement with its balance, the source of a
// movement, the queue) is lent by it (`TransactionCases`), like the guard, until R4. The static paths
// are served before `/transactions/{id}`: Hono tries the routes in their order.
import type { Hono } from "hono";
import { type RouteContract, searchRecords, TRANSACTIONS, TRANSACTIONS_ROUTES } from "@ledgerly/api-contract";

import { searchFunds } from "@ledgerly/domain/funds";
import { searchPockets } from "@ledgerly/domain/pockets";
import { searchSubscriptions } from "@ledgerly/domain/subscriptions";
import {
  expensesView,
  listTransactions,
  searchPayees,
  setCategory,
  spending,
  spendingBuckets,
  transactionsSummary,
  facetCounts,
  groupCounts,
  updateTransaction,
  type TransactionRow,
} from "@ledgerly/domain/transactions";
import { addonOn, type Ctx } from "@ledgerly/domain/platform/context";
import { parseCents } from "@ledgerly/domain/shared/money";
import { today } from "@ledgerly/domain/shared/dates";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { refusing, type TransactionCases } from "./cases";
import {
  breakdownOf,
  excludedOf,
  filtersOf,
  money,
  seriesOf,
  spendingGroup,
  summaryOf,
  transactionLine,
  transactionRow,
} from "./dto";
import { serveManual } from "./manual";
import { serveReview } from "./review";
import { serveRules } from "./rules";

const { movements, spending: spendingArea } = TRANSACTIONS;

/** The rows as the pages draw them, with what the web knows of their sources. */
async function linesOf(ctx: Ctx, rows: readonly TransactionRow[], cases: TransactionCases) {
  const waiting = rows.filter((row) => row.sendState !== null).map((row) => row.accountId);
  const [editableAtSource, sendSources] = await Promise.all([
    cases.editableAtSource(
      ctx,
      rows.map((row) => row.id),
    ),
    waiting.length === 0 ? new Map<string, string>() : cases.sendSources(ctx, [...new Set(waiting)]),
  ]);
  return rows.map((row) => transactionLine(row, { editableAtSource, sendSources }));
}

function serveReads(app: Hono<ApiEnv>, guard: Guard, cases: TransactionCases): void {
  serve(app, guard, movements.listTransactions, async ({ ctx, query }) => {
    const filters = filtersOf(query);
    const [rows, summary] = await Promise.all([
      listTransactions(ctx, filters),
      transactionsSummary(ctx, filters),
    ]);
    return { transactions: rows.map(transactionRow), summary: summaryOf(summary) };
  });
  serve(app, guard, movements.getTransactionsView, async ({ ctx, query }) => {
    const view = await expensesView(ctx, filtersOf(query));
    return {
      rows: await linesOf(ctx, view.rows, cases),
      months: view.months.map((month) => ({
        month: month.month,
        count: month.count,
        net: money(month.netCents),
        ...excludedOf(month.excludedCount),
      })),
      summary: {
        ...summaryOf(view.summary),
        transferCount: view.summary.transferCount,
        unpairedTransferCount: view.summary.unpairedTransferCount,
      },
      facets: { ...view.facets, groups: groupCounts(view.categories, view.facets.categories) },
      listCount: view.listCount,
      truncated: view.truncated,
      hasAny: view.hasAny,
      review: {
        count: view.review.count,
        suggested: view.review.suggested,
        amount: money(view.review.cents),
      },
    };
  });
  serve(app, guard, movements.getTransactionFacets, ({ ctx, query }) => facetCounts(ctx, filtersOf(query)));
}

function serveSpending(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, spendingArea.getSpending, async ({ ctx, query }) => {
    const { groupBy, ...rest } = query;
    // The chart draws one type: the first asked, spending when none.
    const type = rest.type ?? rest.types?.[0];
    const groups = await spending(
      ctx,
      filtersOf(
        groupBy === "day" || groupBy === "month" ? { ...rest, type: undefined, types: undefined } : rest,
      ),
      groupBy,
      type,
    );
    return { groups: groups.map(spendingGroup) };
  });
  serve(app, guard, spendingArea.getSpendingBreakdown, async ({ ctx, query }) => {
    const slices = await spending(ctx, filtersOf(query), "category");
    return breakdownOf(slices);
  });
  serve(app, guard, spendingArea.getSpendingSeries, async ({ ctx, query }) => {
    const { grain, ...rest } = query;
    const type = rest.type ?? rest.types?.[0];
    const points = await spending(
      ctx,
      filtersOf({ ...rest, type: undefined, types: undefined }),
      grain,
      type,
    );
    return seriesOf(points, spendingBuckets(query, grain, today(ctx.timeZone)));
  });
  serve(app, guard, movements.searchPayees, async ({ ctx, query }) => ({
    payees: await searchPayees(ctx, query.q, query.limit),
  }));
}

/** The search across modules of the ⌘K palette: it belongs to no module, so it lives with the first that serves it until R4. */
function serveSearch(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, searchRecords, async ({ ctx, query }) => {
    // An addon that is off is not searched (H52, PA10): the palette never offers it.
    const none = async () => [];
    const [pockets, funds, subscriptions] = await Promise.all([
      addonOn(ctx, "pockets") ? searchPockets(ctx, query.q) : none(),
      addonOn(ctx, "funds") ? searchFunds(ctx, query.q) : none(),
      addonOn(ctx, "subscriptions") ? searchSubscriptions(ctx, query.q) : none(),
    ]);
    return {
      records: [
        ...pockets.map((one) => ({ kind: "pocket" as const, ...one })),
        ...funds.map((one) => ({ kind: "fund" as const, ...one })),
        ...subscriptions.map((one) => ({ kind: "subscription" as const, ...one })),
      ],
    };
  });
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard, cases: TransactionCases): void {
  serve(app, guard, movements.setTransactionsCategory, async ({ ctx, body }) => ({
    count: await refusing(setCategory(ctx, body.ids, body.categoryId)),
  }));
  // Every action rebuilds the balance of a manual movement's account; `rebuildBalances` is read no more.
  serve(app, guard, movements.changeTransactionsVisibility, async ({ ctx, body }) => ({
    count: await refusing(cases.changeVisibility(ctx, body.ids, body.change)),
  }));
}

function serveOne(app: Hono<ApiEnv>, guard: Guard, cases: TransactionCases): void {
  serve(app, guard, movements.getTransaction, async ({ ctx, params }) => {
    const [row] = await listTransactions(ctx, { ids: [params.id], includeHidden: true, limit: 1 });
    if (!row) throw new ApiRefusal("not_found");
    const [line] = await linesOf(ctx, [row], cases);
    return line;
  });
  serve(app, guard, movements.updateTransaction, async ({ ctx, params, body }) => {
    const note = body.note === undefined ? undefined : body.note.trim() === "" ? null : body.note.trim();
    await refusing(
      updateTransaction(ctx, params.id, {
        ...(note === undefined ? {} : { note }),
        ...(body.labelIds === undefined ? {} : { labelIds: body.labelIds }),
      }),
    );
  });
  serve(app, guard, movements.editAtSource, async ({ ctx, params, body }) => {
    let amountCents;
    try {
      amountCents = parseCents(body.amount);
    } catch {
      throw new ApiRefusal("invalid", "amount");
    }
    if (amountCents === 0n) throw new ApiRefusal("invalid", "amount");
    const outcome = await cases.editAtSource(ctx, params.id, { ...body, amountCents });
    switch (outcome.state) {
      case "saved":
      case "unchanged":
        return { state: outcome.state };
      case "not_linked":
        throw new ApiRefusal("conflict", "not_linked");
      case "refused":
        throw new ApiRefusal("conflict", outcome.reason);
      case "failed":
        throw new ApiRefusal("unavailable", outcome.reason);
    }
  });
}

/** Every route of transactions, in the order that keeps the static paths before `{id}`. */
export function serveTransactions(
  app: Hono<ApiEnv>,
  guard: Guard,
  cases: TransactionCases,
): readonly RouteContract[] {
  serveReads(app, guard, cases);
  serveSpending(app, guard);
  serveSearch(app, guard);
  serveWrites(app, guard, cases);
  serveManual(app, guard, cases);
  serveReview(app, guard, cases);
  serveOne(app, guard, cases);
  serveRules(app, guard);
  return TRANSACTIONS_ROUTES;
}
