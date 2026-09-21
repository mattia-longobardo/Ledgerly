import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { removeAccount, saveBalanceEntry } from "@/modules/accounts/service";
import { refreshRecurrences } from "@/modules/transactions/jobs";
import { listTransactions } from "@/modules/transactions/queries";
import { hideTransaction, upsertFromProvider } from "@/modules/transactions/service";
import { createCategory } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { addDays, type CivilDate, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { subscriptionsCheckJob } from "./jobs";
import { subscriptionsOnAccount, subscriptionsView, suggestions } from "./queries";
import { addCycles } from "./rules";
import { subscriptions } from "./schema";
import {
  checkSubscriptions,
  createSubscription,
  deleteSubscription,
  setSubscriptionState,
  setUtility,
  SubscriptionError,
  updateSubscription,
} from "./service";

let ctx: Ctx;
let accountId: string;
let todayOn: CivilDate;

const noon = (on: CivilDate) => new Date(`${on}T11:00:00Z`);

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Netflix",
    categoryId: null,
    utility: 7,
    priceCents: 1_299n,
    cycle: "monthly" as const,
    nextChargeOn: todayOn,
    paymentAccountId: accountId,
    payeeMatch: "netflix",
    tolerance: "0.05",
    ...overrides,
  };
}

async function rowOf(id: string) {
  const view = await subscriptionsView(ctx);
  return [...view.rows, ...view.inactive].find((row) => row.subscription.id === id)!;
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  accountId = await anAccount(ctx);
  todayOn = today(ctx.timeZone);
});

afterAll(closeDatabase);

describe("the payment check (spec §7.5)", () => {
  it("pays this period with a matching expense on the paying account", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "NETFLIX.COM", amountCents: -1_299n, occurredAt: noon(todayOn) }),
    ]);
    const sub = await createSubscription(ctx, input());
    const row = await rowOf(sub.id);
    expect(row.current).toMatchObject({ state: "paid", actualCents: 1_299n });
    expect(row.lastMatch).toEqual({ on: todayOn, cents: 1_299n });
    expect(row.nextChargeOn).toBe(addCycles(todayOn, "monthly", 1));
  });

  it("turns a closed period's not_found into paid when the movement arrives late, and keeps its expected amount", async () => {
    const lastCycle = addCycles(todayOn, "monthly", -1);
    const sub = await createSubscription(ctx, input());
    // Created 40 days ago, so last month's period is one the check covers.
    await getDb()
      .update(subscriptions)
      .set({ createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(subscriptions.id, sub.id));
    await checkSubscriptions(ctx);
    let charges = (await subscriptionsView(ctx)).alerts.map((alert) => [
      alert.charge.dueOn,
      alert.charge.state,
    ]);
    expect(charges).toContainEqual([lastCycle, "not_found"]);

    await updateSubscription(ctx, sub.id, input({ priceCents: 1_799n }));
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "Netflix", amountCents: -1_299n, occurredAt: noon(lastCycle) }),
    ]);
    await checkSubscriptions(ctx);
    charges = (await subscriptionsView(ctx)).alerts.map((alert) => [alert.charge.dueOn, alert.charge.state]);
    expect(charges).not.toContainEqual([lastCycle, "not_found"]);
    const row = await rowOf(sub.id);
    expect(row.lastMatch).toEqual({ on: lastCycle, cents: 1_299n });
  });

  it("lets the period under way follow a new price, which clears an amount that differs", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "Netflix", amountCents: -1_499n, occurredAt: noon(todayOn) }),
    ]);
    const sub = await createSubscription(ctx, input());
    expect((await rowOf(sub.id)).current?.state).toBe("amount_differs");
    await updateSubscription(ctx, sub.id, input({ priceCents: 1_499n }));
    expect((await rowOf(sub.id)).current).toMatchObject({ state: "paid", expectedCents: 1_499n });
  });

  it("never matches a hidden movement, a giroconto, another account, or an amount off by more than the tolerance", async () => {
    const other = await anAccount(ctx, "Other");
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "Netflix hidden", amountCents: -1_299n, occurredAt: noon(todayOn) }),
      movement({ payee: "Netflix", amountCents: -1_299n, type: "transfer", occurredAt: noon(todayOn) }),
    ]);
    await upsertFromProvider(ctx, other, [
      movement({ payee: "Netflix", amountCents: -1_299n, occurredAt: noon(todayOn) }),
    ]);
    const hidden = (await listTransactions(ctx, {})).find((row) => row.payee === "Netflix hidden")!;
    await hideTransaction(ctx, hidden.id);
    const sub = await createSubscription(ctx, input());
    expect((await rowOf(sub.id)).current?.state).toBe("due");

    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "Netflix", amountCents: -1_499n, occurredAt: noon(todayOn) }),
    ]);
    await checkSubscriptions(ctx);
    expect((await rowOf(sub.id)).current).toMatchObject({ state: "amount_differs", actualCents: 1_499n });
  });

  it("is idempotent, and forgets what a paused or unmatched subscription no longer owes", async () => {
    const sub = await createSubscription(ctx, input());
    const first = await checkSubscriptions(ctx);
    expect(await checkSubscriptions(ctx)).toEqual(first);
    expect((await rowOf(sub.id)).current?.state).toBe("due");

    await setSubscriptionState(ctx, sub.id, "paused");
    expect((await rowOf(sub.id)).current).toBeNull();
    await setSubscriptionState(ctx, sub.id, "active");
    await updateSubscription(ctx, sub.id, input({ payeeMatch: "" }));
    expect((await subscriptionsView(ctx)).alerts).toEqual([]);
    expect(await subscriptionsCheckJob.run()).toMatchObject({ failed: 0, subscriptionsChecked: 0 });
  });
});

describe("the page's figures", () => {
  it("sums the equivalents, the low utility, the next 30 days and the projection per account", async () => {
    await saveBalanceEntry(ctx, accountId, { on: todayOn, cents: 100_000n });
    const fun = await createCategory(ctx, { name: "Fun" });
    await createSubscription(ctx, input({ nextChargeOn: addDays(todayOn, 3), categoryId: fun.id }));
    const prime = await createSubscription(
      ctx,
      input({
        name: "Prime",
        cycle: "yearly",
        priceCents: 4_990n,
        utility: 4,
        payeeMatch: "amazon",
        nextChargeOn: addDays(todayOn, 100),
      }),
    );
    await createSubscription(
      ctx,
      input({ name: "Gym", paymentAccountId: null, payeeMatch: null, nextChargeOn: addDays(todayOn, 40) }),
    );
    await setUtility(ctx, prime.id, 3);

    const view = await subscriptionsView(ctx);
    expect(view).toMatchObject({
      monthlyCents: 1_299n + 416n + 1_299n,
      yearlyCents: 15_588n + 4_990n + 15_588n,
      lowUtilityYearlyCents: 4_990n,
      lowUtilityCount: 1,
      // Netflix in 3 days, and the gym: anchored 40 days out, its charge before that is about 10 days away.
      next30Cents: 2n * 1_299n,
    });
    expect(view.byCategory[0]).toMatchObject({ name: null, yearlyCents: 20_578n });
    expect(view.byCategory[1]).toMatchObject({ name: "Fun", yearlyCents: 15_588n });
    const month = view.projections.month.find((one) => one.accountId === accountId)!;
    expect(month).toMatchObject({
      count: 2,
      balanceCents: 100_000n,
      commitCents: 1_299n,
      projectedCents: 98_701n,
    });
    const year = view.projections.year.find((one) => one.accountId === accountId)!;
    expect(year.commitCents).toBe(12n * 1_299n + 4_990n);
    expect(view.projections.month.at(-1)).toMatchObject({
      accountId: null,
      balanceCents: null,
      projectedCents: null,
    });
    expect(await subscriptionsOnAccount(ctx, accountId)).toEqual({ count: 2, monthlyCents: 1_715n });
  });

  it("suggests an outgoing recurring payee until a subscription covers it", async () => {
    await upsertFromProvider(
      ctx,
      accountId,
      [0, 30, 60, 90].map((days) =>
        movement({
          payee: "Spotify AB",
          amountCents: -1_099n,
          occurredAt: noon(addDays(todayOn, days - 100)),
        }),
      ),
    );
    await refreshRecurrences(ctx);
    expect(await suggestions(ctx)).toEqual([
      expect.objectContaining({ name: "Spotify AB", priceCents: 1_099n, cycle: "monthly", accountId }),
    ]);
    await createSubscription(ctx, input({ name: "Spotify", payeeMatch: "spotify" }));
    expect(await suggestions(ctx)).toEqual([]);
  });

  it("archives rather than deletes an account a subscription pays from", async () => {
    await createSubscription(ctx, input());
    expect(await removeAccount(ctx, accountId)).toBe("archived");
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  it("never reads, changes or checks against another user's data", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "Netflix", amountCents: -1_299n, occurredAt: noon(todayOn) }),
    ]);
    const fun = await createCategory(ctx, { name: "Fun" });
    const sub = await createSubscription(ctx, input());
    const other = await newContext();

    expect((await subscriptionsView(other)).rows).toEqual([]);
    expect(await suggestions(other)).toEqual([]);
    expect(await subscriptionsOnAccount(other, accountId)).toEqual({ count: 0, monthlyCents: 0n });
    for (const attempt of [
      () => updateSubscription(other, sub.id, input()),
      () => setUtility(other, sub.id, 1),
      () => setSubscriptionState(other, sub.id, "cancelled"),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "not_found" });
    }
    await expect(createSubscription(other, input())).rejects.toMatchObject({ code: "invalid_account" });
    await expect(
      createSubscription(other, input({ paymentAccountId: null, categoryId: fun.id })),
    ).rejects.toBeInstanceOf(SubscriptionError);

    // Another user's subscription with the same payee and no account finds nothing of this user's.
    const theirs = await createSubscription(other, input({ paymentAccountId: null }));
    expect((await subscriptionsView(other)).rows[0].current?.state).toBe("due");
    expect((await rowOf(sub.id)).current?.state).toBe("paid");
    expect(theirs.userId).toBe(other.userId);
  });
});

describe("deleteSubscription (owner, 2026-09-21)", () => {
  it("throws away a cancelled subscription and the periods it had checked", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "NETFLIX.COM", amountCents: -1_299n, occurredAt: noon(todayOn) }),
    ]);
    const sub = await createSubscription(ctx, input());
    await checkSubscriptions(ctx);
    expect((await subscriptionsView(ctx)).rows).toHaveLength(1);

    await setSubscriptionState(ctx, sub.id, "cancelled");
    await deleteSubscription(ctx, sub.id);

    const view = await subscriptionsView(ctx);
    expect(view.rows).toHaveLength(0);
    expect(view.inactive).toHaveLength(0);
    // The charges go with it (`ON DELETE cascade`), and the movement itself does not.
    expect(await getDb().select().from(subscriptions)).toHaveLength(0);
    expect(await listTransactions(ctx, {})).toHaveLength(1);
  });

  it("refuses one that is merely paused: cancelling is the step before deleting", async () => {
    const sub = await createSubscription(ctx, input());
    await expect(deleteSubscription(ctx, sub.id)).rejects.toMatchObject({ code: "not_cancelled" });
    await setSubscriptionState(ctx, sub.id, "paused");
    await expect(deleteSubscription(ctx, sub.id)).rejects.toMatchObject({ code: "not_cancelled" });
    expect((await subscriptionsView(ctx)).inactive).toHaveLength(1);
  });

  it("refuses somebody else's, and leaves it where it is", async () => {
    const sub = await createSubscription(ctx, input());
    await setSubscriptionState(ctx, sub.id, "cancelled");
    const other = await newContext();
    await expect(deleteSubscription(other, sub.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await subscriptionsView(ctx)).inactive).toHaveLength(1);
  });
});
