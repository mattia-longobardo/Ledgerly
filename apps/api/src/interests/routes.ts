// Interests (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the
// domain's. Hono tries the routes in order; `/interests/{id}` has no static sibling to shadow.
import type { Hono } from "hono";
import { z } from "zod";
import { INTERESTS, INTERESTS_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import {
  createRule,
  InterestError,
  interestsView,
  markPosted,
  postEntry,
  ruleAccounts,
  ruleDetail,
  ruleInputOf,
  setRuleState,
  updateRule,
} from "@ledgerly/domain/interests";
import { today } from "@ledgerly/domain/shared/dates";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { interestRule, interestsList } from "./dto";

const { interests } = INTERESTS;

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InterestError) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      throw new ApiRefusal(error.code === "not_synced" ? "conflict" : "invalid", error.code);
    }
    // The domain's own schema and conversions (a rate past 100 %, bands out of order).
    if (error instanceof z.ZodError || error instanceof RangeError)
      throw new ApiRefusal("invalid", "invalid");
    throw error;
  }
}

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, interests.listInterestRules, async ({ ctx }) => {
    const [view, accounts] = await Promise.all([interestsView(ctx), ruleAccounts(ctx)]);
    return interestsList(view, accounts, today(ctx.timeZone).slice(0, 4));
  });
  serve(app, guard, interests.getInterestRule, async ({ ctx, params }) => {
    const [detail, view] = await Promise.all([
      refusing(() => ruleDetail(ctx, params.id)),
      interestsView(ctx),
    ]);
    return interestRule(detail, view.find((row) => row.rule.id === params.id) ?? null);
  });
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, interests.createInterestRule, async ({ ctx, body }) => {
    const created = await refusing(() => createRule(ctx, ruleInputOf(body)));
    return { id: created.id };
  });
  serve(app, guard, interests.updateInterestRule, async ({ ctx, params, body }) => {
    await refusing(() => updateRule(ctx, params.id, ruleInputOf(body)));
  });
  serve(app, guard, interests.setInterestRuleState, async ({ ctx, params, body }) => {
    await refusing(() => setRuleState(ctx, params.id, body.state));
  });
  serve(app, guard, interests.postInterestSettlement, async ({ ctx, params, body }) => ({
    posting: await refusing(() => postEntry(ctx, params.entryId, { retry: body.retry, ruleId: params.id })),
  }));
  serve(app, guard, interests.markInterestSettlementPosted, async ({ ctx, params }) => {
    await refusing(() => markPosted(ctx, params.id, params.entryId));
    return { posting: "posted" as const };
  });
}

/** Every route of interests. */
export function serveInterests(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveReads(app, guard);
  serveWrites(app, guard);
  return INTERESTS_ROUTES;
}
