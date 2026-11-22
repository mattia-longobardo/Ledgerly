import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { requireOpenAccount } from "../accounts";
import { chargeCandidates } from "../transactions/queries";
import { getCategory, TaxonomyError } from "../transactions/taxonomy";
import type { Ctx } from "../../platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import {
  frequencyColumns,
  frequencyOf,
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

type SubscriptionErrorCode = "not_found" | "invalid_account" | "invalid_category" | "not_cancelled";

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
    await requireOpenAccount(ctx, input.paymentAccountId, () => new SubscriptionError("invalid_account"));
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

/** The columns of a parsed input: the frequency as the table keeps it (R5a). */
function columnsOf(parsed: z.output<typeof subscriptionInputSchema>, current?: Subscription) {
  const { every, cycle, ...rest } = parsed;
  // A form that does not know «every» (the screens before R5a) keeps the one saved while the
  // nearest cycle it shows is sent back unchanged.
  const kept =
    every === undefined && current?.everyUnit && current.everyCount && current.cycle === cycle
      ? frequencyOf(current)
      : null;
  return {
    ...rest,
    ...(kept && typeof kept !== "string"
      ? frequencyColumns(cycle, kept)
      : frequencyColumns(cycle, every ?? null)),
  };
}

export async function createSubscription(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  input: SubscriptionInput,
): Promise<Subscription> {
  const parsed = subscriptionInputSchema.parse(input);
  await checkReferences(ctx, parsed);
  const [row] = await getDb()
    .insert(subscriptions)
    .values(userScoped(ctx).stamp(columnsOf(parsed)))
    .returning();
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
    .set(columnsOf(parsed, current))
    .where(and(eq(subscriptions.id, id), userScoped(ctx).owns(subscriptions)))
    .returning();
  await checkSubscriptions(ctx, { ids: [id] });
  return row;
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
 * Deletes a subscription for good, with the charges it has collected (`ON DELETE cascade`).
 *
 * Only a **cancelled** one (owner, 2026-09-21). Cancelling is the reversible move and deleting the
 * irreversible one, so the two are deliberately two steps: a list nobody can tidy grows for ever,
 * and a button that throws away a payment history from the same row that pauses it is a button
 * somebody presses by accident.
 *
 * The movements themselves are untouched — a subscription is a plan laid over them, never their
 * owner — so what goes is the plan and the periods it had checked.
 */
export async function deleteSubscription(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const row = await requireSubscription(ctx, id);
  if (row.state !== "cancelled") throw new SubscriptionError("not_cancelled");
  await getDb()
    .delete(subscriptions)
    .where(and(eq(subscriptions.id, id), userScoped(ctx).owns(subscriptions)));
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The subscriptions in scope (all of this user's, or only `ids`). */
async function subscriptionsIn(
  ctx: Pick<Ctx, "userId">,
  ids: readonly string[] | undefined,
): Promise<Subscription[]> {
  if (ids !== undefined && ids.length === 0) return [];
  return getDb()
    .select()
    .from(subscriptions)
    .where(
      and(
        userScoped(ctx).owns(subscriptions),
        ids === undefined ? undefined : inArray(subscriptions.id, [...ids]),
      ),
    )
    .orderBy(asc(subscriptions.id));
}

/**
 * What the check needs of the stored charges (SUB-9: read for the checked subscriptions only): the
 * amounts their closed periods were written with, and the movements other subscriptions hold.
 */
async function storedCharges(ctx: Pick<Ctx, "userId">, checkedIds: readonly string[]) {
  const scope = userScoped(ctx).owns(subscriptionCharges);
  const [own, held] = await Promise.all([
    getDb()
      .select({
        subscriptionId: subscriptionCharges.subscriptionId,
        dueOn: subscriptionCharges.dueOn,
        periodTo: subscriptionCharges.periodTo,
        expectedCents: subscriptionCharges.expectedCents,
      })
      .from(subscriptionCharges)
      .where(and(scope, inArray(subscriptionCharges.subscriptionId, [...checkedIds]))),
    getDb()
      .select({ transactionId: subscriptionCharges.transactionId })
      .from(subscriptionCharges)
      .where(
        and(
          scope,
          notInArray(subscriptionCharges.subscriptionId, [...checkedIds]),
          isNotNull(subscriptionCharges.transactionId),
        ),
      ),
  ]);
  return { own, takenElsewhere: new Set(held.flatMap((row) => row.transactionId ?? [])) };
}

/** The plan of the checkable subscriptions over the movements no other subscription holds. */
async function chargePlan(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  checkable: readonly Subscription[],
  todayOn: CivilDate,
): Promise<ReturnType<typeof planCharges>> {
  if (checkable.length === 0) return [];
  const { own, takenElsewhere } = await storedCharges(
    ctx,
    checkable.map((row) => row.id),
  );
  const checked: CheckedSubscription[] = checkable.map((row) => ({
    id: row.id,
    priceCents: row.priceCents,
    cycle: frequencyOf(row),
    anchor: row.nextChargeOn,
    paymentAccountId: row.paymentAccountId,
    payeeMatch: row.payeeMatch ?? "", // only the checkable ones, which have it
    tolerance: row.tolerance,
    createdOn: civilDateIn(row.createdAt, ctx.timeZone),
    // A closed period keeps the amount it was written with, so a price rise does not rewrite the
    // past; the period under way follows the price (the design's "Update price").
    expected: new Map(
      own
        .filter((charge) => charge.subscriptionId === row.id && charge.periodTo < todayOn)
        .map((charge) => [charge.dueOn, charge.expectedCents]),
    ),
  }));
  const earliest = checked.reduce<CivilDate>((first, row) => {
    const start = periodOf(addCycles(row.createdOn, row.cycle, -1), row.cycle).from;
    return start < first ? start : first;
  }, todayOn);
  const candidates = (
    await chargeCandidates(ctx, { accountId: null, from: addDays(earliest, -31), to: todayOn })
  ).filter((candidate) => !takenElsewhere.has(candidate.id));
  return planCharges(checked, candidates, todayOn);
}

/** Writes the plan of the checked subscriptions, in place of the rows it replaces. */
async function writePlan(
  writer: Tx,
  ctx: Pick<Ctx, "userId">,
  checkedIds: readonly string[],
  plan: ReturnType<typeof planCharges>,
): Promise<void> {
  const scope = userScoped(ctx).owns(subscriptionCharges);
  // Free every movement first: one may move from one period to another in this pass, and the
  // unique key on `transaction_id` would refuse it while the old row still held it.
  await writer
    .update(subscriptionCharges)
    .set({ transactionId: null })
    .where(
      and(
        scope,
        inArray(subscriptionCharges.subscriptionId, [...checkedIds]),
        isNotNull(subscriptionCharges.transactionId),
      ),
    );
  for (const id of checkedIds) {
    const keep = plan.filter((row) => row.subscriptionId === id).map((row) => row.dueOn);
    await writer
      .delete(subscriptionCharges)
      .where(
        and(
          scope,
          eq(subscriptionCharges.subscriptionId, id),
          keep.length > 0 ? notInArray(subscriptionCharges.dueOn, keep) : undefined,
        ),
      );
  }
  if (plan.length === 0) return;
  await writer
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
  const inScope = await subscriptionsIn(ctx, options.ids);
  if (inScope.length === 0) return { checked: 0, written: 0 };
  const checkable = inScope.filter((row) => row.state === "active" && row.payeeMatch !== null);
  const checkedIds = checkable.map((row) => row.id);
  const plan = await chargePlan(ctx, checkable, todayOn);

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
    if (checkedIds.length > 0) await writePlan(tx, ctx, checkedIds, plan);
  });
  return { checked: checkedIds.length, written: plan.length };
}

// ——— What rests on an account (PERS-419) ——————————————————————————————————————————————————————
// The deletion of an account lists these and moves each to another account first: the foreign key
// is `on delete no action`, so one left behind makes the deletion refuse.

/** The subscriptions paid from an account, whatever their state. */
export async function subscriptionsToMove(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: subscriptions.id, name: subscriptions.name })
    .from(subscriptions)
    .where(and(userScoped(ctx).owns(subscriptions), eq(subscriptions.paymentAccountId, accountId)))
    .orderBy(asc(subscriptions.name), asc(subscriptions.id));
}

/** A subscription paid from another account: the same check as the subscription's own form. */
export async function moveSubscriptionAccount(
  ctx: Pick<Ctx, "userId">,
  id: string,
  accountId: string,
): Promise<void> {
  await checkReferences(ctx, { paymentAccountId: accountId, categoryId: null });
  const moved = await getDb()
    .update(subscriptions)
    .set({ paymentAccountId: accountId })
    .where(and(eq(subscriptions.id, id), userScoped(ctx).owns(subscriptions)))
    .returning({ id: subscriptions.id });
  if (moved.length === 0) throw new SubscriptionError("not_found");
}

/** How many of some movements are charges of a subscription (categories-and-rules.md §3.5). */
export async function chargesAmong(
  ctx: Pick<Ctx, "userId">,
  transactionIds: readonly string[],
): Promise<number> {
  let found = 0;
  // In slices: a list of ids is one parameter each, and Postgres takes 65535 of them at most.
  for (let start = 0; start < transactionIds.length; start += 5000) {
    const rows = await getDb()
      .select({ id: subscriptionCharges.id })
      .from(subscriptionCharges)
      .where(
        and(
          userScoped(ctx).owns(subscriptionCharges),
          inArray(subscriptionCharges.transactionId, transactionIds.slice(start, start + 5000)),
        ),
      );
    found += rows.length;
  }
  return found;
}
