// Subscriptions (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the
// domain's. The static paths are served before `/subscriptions/{id}`: Hono tries the routes in order.
import type { Hono } from "hono";
import { z } from "zod";
import { SUBSCRIPTIONS, SUBSCRIPTIONS_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import {
  createSubscription,
  deleteSubscription,
  setSubscriptionState,
  SubscriptionError,
  subscriptionsView,
  suggestions,
  toleranceOf,
  updateSubscription,
} from "@ledgerly/domain/subscriptions";
import { centsToDecimal, parseCents } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { subscriptionsList } from "./dto";

const { subscriptions } = SUBSCRIPTIONS;

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SubscriptionError) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      throw new ApiRefusal(error.code === "not_cancelled" ? "conflict" : "invalid", error.code);
    }
    // The domain's own schema and conversions (a price of 0, a tolerance past 100 %).
    if (error instanceof z.ZodError || error instanceof RangeError)
      throw new ApiRefusal("invalid", "invalid");
    throw error;
  }
}

/** The subscription dialog as the domain takes it. */
function subscriptionInput(body: z.infer<typeof subscriptions.createSubscription.body>) {
  return {
    name: body.name,
    categoryId: body.categoryId,
    paymentAccountId: body.accountId,
    priceCents: parseCents(body.price),
    cycle: body.cycle,
    nextChargeOn: body.chargeOn,
    payeeMatch: body.payeeMatch,
    tolerance: toleranceOf(body.tolerance),
    utility: body.utility,
  };
}

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, subscriptions.listSubscriptions, async ({ ctx }) =>
    subscriptionsList(await subscriptionsView(ctx)),
  );
  serve(app, guard, subscriptions.listSubscriptionSuggestions, async ({ ctx }) => ({
    suggestions: (await suggestions(ctx)).map((one) => ({
      key: one.payeeKey,
      name: one.name,
      price: centsToDecimal(one.priceCents),
      cycle: one.cycle,
      nextChargeOn: one.nextChargeOn,
      accountId: one.accountId,
      categoryId: one.categoryId,
      occurrences: one.occurrences,
    })),
  }));
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, subscriptions.createSubscription, async ({ ctx, body }) => {
    const created = await refusing(() => createSubscription(ctx, subscriptionInput(body)));
    return { id: created.id };
  });
  serve(app, guard, subscriptions.updateSubscription, async ({ ctx, params, body }) => {
    await refusing(() => updateSubscription(ctx, params.id, subscriptionInput(body)));
  });
  serve(app, guard, subscriptions.setSubscriptionState, async ({ ctx, params, body }) => {
    await refusing(() => setSubscriptionState(ctx, params.id, body.state));
  });
  serve(app, guard, subscriptions.deleteSubscription, async ({ ctx, params }) => {
    await refusing(() => deleteSubscription(ctx, params.id));
  });
}

/** Every route of subscriptions, in the order that keeps the static paths before `{id}`. */
export function serveSubscriptions(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveReads(app, guard);
  serveWrites(app, guard);
  return SUBSCRIPTIONS_ROUTES;
}
