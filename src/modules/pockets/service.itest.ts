import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAccount } from "@/modules/accounts/queries";
import { removeAccount, saveBalanceEntry } from "@/modules/accounts/service";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { addDays, addMonths, monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { createRule } from "@/modules/interests/service";
import { hideTransaction, upsertFromProvider } from "@/modules/transactions/service";
import { pocketsAccrualJob } from "./jobs";
import { expenseLinkCandidates, pocketsOnAccount, pocketsTotal, pocketsView } from "./queries";
import {
  accrueMonth,
  addPlannedExpense,
  addToPocket,
  createPocket,
  linkExpense,
  PocketError,
  purgeExpiredPlanned,
  removePlannedExpense,
  setPocketState,
  unlinkExpense,
  updatePocket,
} from "./service";

let ctx: Ctx;
let thisMonth: string;
let todayOn: string;

function pocketInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Holidays",
    color: null,
    backingAccountId: null,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth: thisMonth,
    ...overrides,
  };
}

const noon = (on: string) => new Date(`${on}T11:00:00Z`);

/** The ids of an account's movements, newest first, as the pocket's page lists them. */
async function spend(
  account: string,
  rows: { cents: bigint; on: string; type?: "expense" | "income" | "transfer" }[],
) {
  await upsertFromProvider(
    ctx,
    account,
    rows.map((row) =>
      movement({
        amountCents: row.type === "income" ? row.cents : -row.cents,
        occurredAt: noon(row.on),
        type: row.type ?? "expense",
      }),
    ),
  );
}

async function balanceOf(id: string): Promise<bigint | undefined> {
  return (await pocketsView(ctx)).pockets.find((view) => view.pocket.id === id)?.balanceCents;
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  todayOn = today(ctx.timeZone);
  thisMonth = monthKey(todayOn);
});

afterAll(closeDatabase);

describe("accruals (spec §7.4)", () => {
  it("accrues the current month when a pocket starts now, and only once", async () => {
    const pocket = await createPocket(ctx, pocketInput());
    expect(await balanceOf(pocket.id)).toBe(25_000n);
    expect(await accrueMonth(ctx, thisMonth)).toEqual({ written: 0 });
    expect(await pocketsAccrualJob.run()).toMatchObject({ accrualsWritten: 0, failed: 0 });
    expect(await balanceOf(pocket.id)).toBe(25_000n);
  });

  it("writes no arrears for a start month in the past, and nothing before a future one", async () => {
    const past = await createPocket(ctx, pocketInput({ startMonth: addMonths(thisMonth, -6) }));
    const future = await createPocket(ctx, pocketInput({ name: "Car", startMonth: addMonths(thisMonth, 2) }));
    expect(await balanceOf(past.id)).toBe(25_000n);
    expect(await balanceOf(future.id)).toBe(0n);
    expect(await accrueMonth(ctx, addMonths(thisMonth, 2))).toEqual({ written: 2 });
  });

  it("gives a paused pocket nothing and accrues the month again on resuming", async () => {
    const pocket = await createPocket(ctx, pocketInput({ startMonth: addMonths(thisMonth, 1) }));
    await setPocketState(ctx, pocket.id, "paused");
    expect(await accrueMonth(ctx, addMonths(thisMonth, 1))).toEqual({ written: 0 });
    await updatePocket(ctx, pocket.id, pocketInput({ startMonth: thisMonth }));
    expect(await balanceOf(pocket.id)).toBe(0n);
    await setPocketState(ctx, pocket.id, "active");
    expect(await balanceOf(pocket.id)).toBe(25_000n);
  });

  it("leaves a pocket without a monthly amount to be filled by hand", async () => {
    const pocket = await createPocket(ctx, pocketInput({ monthlyCents: null, targetCents: null }));
    expect(await balanceOf(pocket.id)).toBe(0n);
    await addToPocket(ctx, pocket.id, { cents: 5_000n, on: todayOn });
    const view = (await pocketsView(ctx)).pockets[0];
    expect(view).toMatchObject({ balanceCents: 5_000n, eta: null, accruedCents: 0n });
  });
});

describe("moves", () => {
  it("refuses a date in the future and a move on an archived pocket", async () => {
    const pocket = await createPocket(ctx, pocketInput());
    const tomorrow = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10);
    await expect(addToPocket(ctx, pocket.id, { cents: 1n, on: tomorrow })).rejects.toMatchObject({
      code: "future_date",
    });
    await setPocketState(ctx, pocket.id, "archived");
    await expect(addToPocket(ctx, pocket.id, { cents: 1n, on: todayOn })).rejects.toMatchObject({
      code: "archived",
    });
    expect((await pocketsView(ctx)).archived.map((row) => row.id)).toEqual([pocket.id]);
  });

  it("refuses a second pocket with the same name", async () => {
    await createPocket(ctx, pocketInput());
    await expect(createPocket(ctx, pocketInput())).rejects.toMatchObject({ code: "duplicate_name" });
  });
});

describe("expenses (the budget they come off)", () => {
  it("takes every expense of the backing account since the start month, and no transfer or income", async () => {
    const account = await anAccount(ctx);
    const lastMonth = addMonths(thisMonth, -1);
    const pocket = await createPocket(ctx, pocketInput({ backingAccountId: account, startMonth: lastMonth }));
    await accrueMonth(ctx, lastMonth, [pocket.id]);
    await spend(account, [
      { cents: 10_000n, on: todayOn },
      { cents: 7_000n, on: lastMonth },
      { cents: 5_000n, on: addDays(lastMonth, -1) },
      { cents: 30_000n, on: todayOn, type: "income" },
    ]);
    const view = (await pocketsView(ctx)).pockets[0];
    // Two accruals of 250 € make the budget; the two expenses since the start come off it.
    expect(view).toMatchObject({ budgetCents: 50_000n, spentCents: -17_000n, balanceCents: 33_000n });
    expect(view.expenses.map((row) => row.cents)).toEqual([10_000n, 7_000n]);
    // The budget left carries over: last month ended at 250 − 70.
    expect(view.history.at(-2)).toBe(18_000n);
    expect(await expenseLinkCandidates(ctx)).toEqual([]);
  });

  it("lets a standalone pocket take the expenses linked to it, once, and give them back", async () => {
    const account = await anAccount(ctx);
    const pocket = await createPocket(ctx, pocketInput());
    await spend(account, [
      { cents: 4_000n, on: todayOn },
      { cents: 9_000n, on: todayOn, type: "income" },
    ]);
    const candidates = await expenseLinkCandidates(ctx);
    expect(candidates.map((row) => row.cents)).toEqual([4_000n]);
    await linkExpense(ctx, pocket.id, candidates[0].id);
    expect(await balanceOf(pocket.id)).toBe(21_000n);
    expect(await expenseLinkCandidates(ctx)).toEqual([]);

    const other = await createPocket(ctx, pocketInput({ name: "Other" }));
    await expect(linkExpense(ctx, other.id, candidates[0].id)).rejects.toMatchObject({
      code: "already_linked",
    });

    // Hidden, it no longer counts.
    await hideTransaction(ctx, candidates[0].id);
    expect(await balanceOf(pocket.id)).toBe(25_000n);

    await unlinkExpense(ctx, pocket.id, candidates[0].id);
    await expect(unlinkExpense(ctx, pocket.id, candidates[0].id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a link on a pocket with an account, an income, and an expense of a backing account", async () => {
    const backing = await anAccount(ctx, "Saving");
    const plain = await anAccount(ctx, "Main");
    const backed = await createPocket(ctx, pocketInput({ backingAccountId: backing }));
    const standalone = await createPocket(ctx, pocketInput({ name: "Gifts" }));
    await spend(backing, [{ cents: 1_000n, on: todayOn }]);
    await spend(plain, [{ cents: 2_000n, on: todayOn, type: "income" }]);
    const rows = (await pocketsView(ctx)).pockets.find((one) => one.pocket.id === backed.id)!.expenses;
    await expect(linkExpense(ctx, backed.id, rows[0].id)).rejects.toMatchObject({ code: "backed" });
    await expect(linkExpense(ctx, standalone.id, rows[0].id)).rejects.toMatchObject({ code: "backed" });
  });
});

describe("planned expenses", () => {
  it("lowers what would be left, stays a week past its day, and can be removed", async () => {
    const pocket = await createPocket(ctx, pocketInput());
    await addPlannedExpense(ctx, pocket.id, {
      cents: 6_000n,
      dueOn: addDays(todayOn, 3),
      description: "Ferry",
    });
    await expect(
      addPlannedExpense(ctx, pocket.id, { cents: 1n, dueOn: addDays(todayOn, -1), description: "Late" }),
    ).rejects.toMatchObject({ code: "past_date" });
    let view = (await pocketsView(ctx)).pockets[0];
    expect(view).toMatchObject({ balanceCents: 25_000n, plannedCents: 6_000n, projectedCents: 19_000n });

    // Seven days past its day it is still there; eight days past, gone from the page and the table.
    const later = (days: number) => new Date(Date.now() + days * 86_400_000);
    view = (await pocketsView(ctx, later(10))).pockets[0];
    expect(view.planned).toMatchObject([{ description: "Ferry", overdue: true }]);
    expect((await pocketsView(ctx, later(12))).pockets[0].planned).toEqual([]);
    expect(await purgeExpiredPlanned(ctx, addDays(todayOn, 10))).toBe(0);
    expect(await purgeExpiredPlanned(ctx, addDays(todayOn, 11))).toBe(1);

    await addPlannedExpense(ctx, pocket.id, { cents: 1_000n, dueOn: todayOn, description: "Taxi" });
    const [taxi] = (await pocketsView(ctx)).pockets[0].planned;
    await removePlannedExpense(ctx, taxi.id);
    expect((await pocketsView(ctx)).pockets[0].planned).toEqual([]);
  });
});

describe("the page's figures", () => {
  it("computes free, ETA, the totals and the pockets on an account", async () => {
    const revolut = await anAccount(ctx, "Revolut Saving");
    await saveBalanceEntry(ctx, revolut, { on: todayOn, cents: 1_000_000n });
    const holidays = await createPocket(ctx, pocketInput({ backingAccountId: revolut }));
    await addToPocket(ctx, holidays.id, { cents: 300_000n, on: todayOn });
    await createPocket(ctx, pocketInput({ name: "Gifts", targetCents: null, monthlyCents: 5_000n }));

    const view = await pocketsView(ctx);
    expect(view).toMatchObject({
      earmarkedCents: 330_000n,
      backingCents: 1_000_000n,
      freeCents: 675_000n,
      monthlyCents: 30_000n,
      backingNames: ["Revolut Saving"],
      nextAccrual: addMonths(thisMonth, 1),
    });
    expect(view.freeByAccount[revolut]).toBe(675_000n);
    const found = view.pockets.find((one) => one.pocket.id === holidays.id)!;
    // (400.000 − 325.000) / 25.000 = 3 months; the interest share is unknown until F4.
    expect(found).toMatchObject({ eta: 3, accountName: "Revolut Saving", interestCents: null });
    expect(found.history.at(-1)).toBe(325_000n);
    expect(await pocketsTotal(ctx)).toEqual({ totalCents: 330_000n, monthlyCents: 30_000n, count: 2 });
    expect(await pocketsOnAccount(ctx, revolut)).toEqual([{ id: holidays.id, name: "Holidays" }]);
  });

  it("does not know what is free while a backing account has no balance", async () => {
    const account = await anAccount(ctx);
    await createPocket(ctx, pocketInput({ backingAccountId: account }));
    expect((await pocketsView(ctx)).freeCents).toBeNull();
  });
});

describe("interest on the backing account (spec §7.4)", () => {
  it("is the account's accrued interest × the pocket's share, as an estimate", async () => {
    const saving = await anAccount(ctx, "Revolut Saving");
    await saveBalanceEntry(ctx, saving, { on: addDays(todayOn, -400), cents: 1_000_000n });
    // 3,65 % on 10.000 € and no tax: 1,00 € a day.
    await createRule(ctx, {
      accountId: saving,
      taxRate: "0",
      dayBasis: "365",
      settlement: "monthly",
      validFrom: addDays(todayOn, -365),
      tiers: [{ upToCents: null, annualRate: "0.0365" }],
    });
    const pocket = await createPocket(ctx, pocketInput({ backingAccountId: saving, monthlyCents: null }));
    await addToPocket(ctx, pocket.id, { cents: 250_000n, on: todayOn });
    const view = (await pocketsView(ctx)).pockets[0];
    // The window is the 365 days to today and today has not accrued yet: 364,00 € × 2.500 / 10.000.
    expect(view).toMatchObject({ interestCents: 9_100n, interestReason: "estimate" });
  });
});

describe("an account a pocket rests on (spec §7.1)", () => {
  it("is archived instead of deleted, and deleted once nothing rests on it", async () => {
    const account = await anAccount(ctx);
    const pocket = await createPocket(ctx, pocketInput({ backingAccountId: account }));
    expect(await removeAccount(ctx, account)).toBe("archived");
    expect((await getAccount(ctx, account))?.state).toBe("archived");

    await updatePocket(ctx, pocket.id, pocketInput({ backingAccountId: null }));
    expect(await removeAccount(ctx, account)).toBe("deleted");
  });

  it("refuses an archived account as backing, and deleting the user still takes everything", async () => {
    const account = await anAccount(ctx);
    await createPocket(ctx, pocketInput({ backingAccountId: account }));
    const other = await anAccount(ctx, "Old");
    await removeAccount(ctx, other);
    await expect(
      createPocket(ctx, pocketInput({ name: "X", backingAccountId: other })),
    ).rejects.toMatchObject({
      code: "invalid_account",
    });
    await getDb().delete(users).where(eq(users.id, ctx.userId));
    expect(await getAccount(ctx, account)).toBeNull();
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  it("never reads, moves or rests a pocket on another user's data", async () => {
    const account = await anAccount(ctx);
    const pocket = await createPocket(ctx, pocketInput({ backingAccountId: account }));
    const other = await newContext();

    expect((await pocketsView(other)).pockets).toEqual([]);
    expect(await pocketsTotal(other)).toEqual({ totalCents: 0n, monthlyCents: 0n, count: 0 });
    expect(await pocketsOnAccount(other, account)).toEqual([]);
    await expect(createPocket(other, pocketInput({ backingAccountId: account }))).rejects.toMatchObject({
      code: "invalid_account",
    });
    for (const attempt of [
      () => addToPocket(other, pocket.id, { cents: 1n, on: todayOn }),
      () => addPlannedExpense(other, pocket.id, { cents: 1n, dueOn: todayOn, description: "x" }),
      () => setPocketState(other, pocket.id, "archived"),
      () => updatePocket(other, pocket.id, pocketInput()),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(PocketError);
    }
    expect(await accrueMonth(other, thisMonth)).toEqual({ written: 0 });
    expect(await balanceOf(pocket.id)).toBe(25_000n);
  });
});
