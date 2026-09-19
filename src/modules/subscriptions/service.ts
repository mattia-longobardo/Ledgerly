import "server-only";
import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { getAccount } from "@/modules/accounts/queries";
import { chargeCandidates } from "@/modules/transactions/queries";
import { getCategory, TaxonomyError } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import {
  addCycles,
  type CheckedSubscription,
  periodOf,
  planCharges,
  type SubscriptionInput,
  subscriptionInputSchema,
} from "./rules";
import { subscriptionCharges, subscriptions } from "./schema";

export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionCharge = typeof subscriptionCharges.$inferSelect;

export type SubscriptionErrorCode = "not_found" | "invalid_account" | "invalid_category";

export class SubscriptionError extends Error {
  constructor(readonly code: SubscriptionErrorCode) {
    super(code);
    this.name = "SubscriptionError";
  }
}

async function requireSubscription(ctx: Pick<Ctx, "userId">, id: string): Promise<Subscription> {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, id), userScoped(ctx).owns(subscriptions)));
  if (!row) throw new SubscriptionError("not_found");
  return row;
}

/** The references a subscription may hold: one of this user's open accounts, a spending category. */
async function checkReferences(
  ctx: Pick<Ctx, "userId">,
  input: { paymentAccountId: string | null; categoryId: string | null },
  current?: Subscription,
): Promise<void> {
  if (input.paymentAccountId !== null && input.paymentAccountId !== current?.paymentAccountId) {
    const account = await getAccount(ctx, input.paymentAccountId);
    if (!account || account.state === "archived") throw new SubscriptionError("invalid_account");
  }
  if (input.categoryId !== null && input.categoryId !== current?.categoryId) {
    try {
      const category = await getCategory(ctx, input.categoryId);
      if (category.type !== "expense") throw new SubscriptionError("invalid_category");
    } catch (error) {
      if (error instanceof TaxonomyError) throw new SubscriptionError("invalid_category");
      throw error;
    }
  }
}

export async function createSubscription(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: SubscriptionInput,
): Promise<Subscription> {
  const parsed = subscriptionInputSchema.parse(input);
  await checkReferences(ctx, parsed);
  const [row] = await getDb().insert(subscriptions).values(userScoped(ctx).stamp(parsed)).returning();
  await checkSubscriptions(ctx, { ids: [row.id] });
  return row;
}

export async function updateSubscription(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  input: SubscriptionInput,
): Promise<Subscription> {
  const current = await requireSubscription(ctx, id);
  const parsed = subscriptionInputSchema.parse(input);
  await checkReferences(ctx, parsed, current);
  const [row] = await getDb()
    .update(subscriptions)
    .set(parsed)
    .where(and(eq(subscriptions.id, id), userScoped(ctx).owns(subscriptions)))
    .returning();
  await checkSubscriptions(ctx, { ids: [id] });
  return row;
}

/** The design's "n/10" button: the utility alone. */
export async function setUtility(ctx: Pick<Ctx, "userId">, id: string, utility: number): Promise<void> {
  await requireSubscription(ctx, id);
  const parsed = subscriptionInputSchema.shape.utility.parse(utility);
  await getDb()
    .update(subscriptions)
    .set({ utility: parsed })
    .where(and(eq(subscriptions.id, id), userScoped(ctx).owns(subscriptions)));
}

/** Pause, resume, cancel (design: "Cancel subscription") or bring back a cancelled one. */
export async function setSubscriptionState(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  state: "active" | "paused" | "cancelled",
): Promise<void> {
  await requireSubscription(ctx, id);
  await getDb()
    .update(subscriptions)
    .set({ state, cancelledAt: state === "cancelled" ? new Date() : null })
    .where(and(eq(subscriptions.id, id), userScoped(ctx).owns(subscriptions)));
  await checkSubscriptions(ctx, { ids: [id] });
}

/**
 * The payment check of spec §7.5 for this user's subscriptions (or only `ids`), from scratch every
 * time: the periods are recomputed by `planCharges` over the stored movements, so a movement that
 * arrived late turns a `not_found` into `paid`, and editing the match text re-reads the past. A
 * closed period keeps the expected amount it was written with; the one under way follows the price.
 *
 * A subscription that is not active keeps the history it has but no longer owes anything: its
 * `due` rows go. One without match text cannot be checked, and keeps nothing. Reads first, then
 * one short transaction; no network anywhere (spec §4.3).
 */
export async function checkSubscriptions(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  options: { ids?: readonly string[]; now?: Date } = {},
): Promise<{ checked: number; written: number }> {
  const todayOn = today(ctx.timeZone, options.now ?? new Date());
  const all = await getDb()
    .select()
    .from(subscriptions)
    .where(userScoped(ctx).owns(subscriptions))
    .orderBy(asc(subscriptions.id));
  const inScope = options.ids === undefined ? all : all.filter((row) => options.ids?.includes(row.id));
  if (inScope.length === 0) return { checked: 0, written: 0 };
  const checkable = inScope.filter((row) => row.state === "active" && row.payeeMatch !== null);
  const checkedIds = checkable.map((row) => row.id);

  const existing = await getDb()
    .select({
      subscriptionId: subscriptionCharges.subscriptionId,
      dueOn: subscriptionCharges.dueOn,
      periodTo: subscriptionCharges.periodTo,
      expectedCents: subscriptionCharges.expectedCents,
      transactionId: subscriptionCharges.transactionId,
    })
    .from(subscriptionCharges)
    .where(userScoped(ctx).owns(subscriptionCharges));
  const takenElsewhere = new Set(
    existing
      .filter((row) => !checkedIds.includes(row.subscriptionId) && row.transactionId !== null)
      .map((row) => row.transactionId as string),
  );

  const checked: CheckedSubscription[] = checkable.map((row) => ({
    id: row.id,
    priceCents: row.priceCents,
    cycle: row.cycle,
    anchor: row.nextChargeOn,
    paymentAccountId: row.paymentAccountId,
    payeeMatch: row.payeeMatch as string,
    tolerance: row.tolerance,
    createdOn: civilDateIn(row.createdAt, ctx.timeZone),
    // A closed period keeps the amount it was written with, so a price rise does not rewrite the
    // past; the period under way follows the price (the design's "Update price").
    expected: new Map(
      existing
        .filter((charge) => charge.subscriptionId === row.id && charge.periodTo < todayOn)
        .map((charge) => [charge.dueOn, charge.expectedCents]),
    ),
  }));
  const earliest = checked.reduce<CivilDate>((first, row) => {
    const start = periodOf(addCycles(row.createdOn, row.cycle, -1), row.cycle).from;
    return start < first ? start : first;
  }, todayOn);
  const candidates =
    checked.length === 0
      ? []
      : (await chargeCandidates(ctx, { accountId: null, from: addDays(earliest, -31), to: todayOn })).filter(
          (candidate) => !takenElsewhere.has(candidate.id),
        );
  const plan = planCharges(checked, candidates, todayOn);

  const uncheckable = inScope.filter((row) => row.payeeMatch === null).map((row) => row.id);
  const idle = inScope
    .filter((row) => row.state !== "active" && row.payeeMatch !== null)
    .map((row) => row.id);
  await getDb().transaction(async (tx) => {
    const scope = userScoped(ctx).owns(subscriptionCharges);
    if (uncheckable.length > 0) {
      await tx
        .delete(subscriptionCharges)
        .where(and(scope, inArray(subscriptionCharges.subscriptionId, uncheckable)));
    }
    if (idle.length > 0) {
      await tx
        .delete(subscriptionCharges)
        .where(
          and(scope, inArray(subscriptionCharges.subscriptionId, idle), eq(subscriptionCharges.state, "due")),
        );
    }
    if (checkedIds.length === 0) return;
    // Free every movement first: one may move from one period to another in this pass, and the
    // unique key on `transaction_id` would refuse it while the old row still held it.
    await tx
      .update(subscriptionCharges)
      .set({ transactionId: null })
      .where(
        and(
          scope,
          inArray(subscriptionCharges.subscriptionId, checkedIds),
          isNotNull(subscriptionCharges.transactionId),
        ),
      );
    for (const id of checkedIds) {
      const keep = plan.filter((row) => row.subscriptionId === id).map((row) => row.dueOn);
      await tx
        .delete(subscriptionCharges)
        .where(
          and(
            scope,
            eq(subscriptionCharges.subscriptionId, id),
            keep.length > 0 ? notInArray(subscriptionCharges.dueOn, keep) : undefined,
          ),
        );
    }
    if (plan.length > 0) {
      await tx
        .insert(subscriptionCharges)
        .values(plan.map((row) => userScoped(ctx).stamp(row)))
        .onConflictDoUpdate({
          target: [subscriptionCharges.subscriptionId, subscriptionCharges.dueOn],
          set: {
            periodFrom: sql`excluded.period_from`,
            periodTo: sql`excluded.period_to`,
            transactionId: sql`excluded.transaction_id`,
            // The plan carries the stored amount for a closed period and the price for an open one.
            expectedCents: sql`excluded.expected_cents`,
            actualCents: sql`excluded.actual_cents`,
            state: sql`excluded.state`,
          },
        });
    }
  });
  return { checked: checkedIds.length, written: plan.length };
}
