import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAccount } from "@/modules/accounts/queries";
import { removeAccount, saveBalanceEntry } from "@/modules/accounts/service";
import { users } from "@/platform/auth/schema";
import type { Ctx } from "@/platform/context";
import { addDays, addMonths, monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, newContext } from "../../../test/fixtures";
import { createRule } from "@/modules/interests/service";
import { pocketsAccrualJob } from "./jobs";
import { pocketsOnAccount, pocketsTotal, pocketsView } from "./queries";
import {
  accrueMonth,
  addToPocket,
  createPocket,
  PocketError,
  recordWithdrawal,
  setPocketState,
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
  it("records a withdrawal with its reason and refuses one past the balance", async () => {
    const pocket = await createPocket(ctx, pocketInput());
    await addToPocket(ctx, pocket.id, { cents: 50_000n, on: todayOn });
    await recordWithdrawal(ctx, pocket.id, { cents: 60_000n, on: todayOn, reason: "Hotel" });
    await expect(
      recordWithdrawal(ctx, pocket.id, { cents: 15_001n, on: todayOn, reason: "Ferry" }),
    ).rejects.toMatchObject({ code: "insufficient" });
    const view = (await pocketsView(ctx)).pockets[0];
    expect(view.balanceCents).toBe(15_000n);
    expect(view.withdrawnCents).toBe(-60_000n);
    expect(view.withdrawals.map((movement) => movement.reason)).toEqual(["Hotel"]);
  });

  it("refuses a date in the future, a withdrawal without a reason and a move on an archived pocket", async () => {
    const pocket = await createPocket(ctx, pocketInput());
    const tomorrow = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10);
    await expect(addToPocket(ctx, pocket.id, { cents: 1n, on: tomorrow })).rejects.toMatchObject({
      code: "future_date",
    });
    await expect(recordWithdrawal(ctx, pocket.id, { cents: 1n, on: todayOn, reason: " " })).rejects.toThrow();
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
      () => recordWithdrawal(other, pocket.id, { cents: 1n, on: todayOn, reason: "x" }),
      () => setPocketState(other, pocket.id, "archived"),
      () => updatePocket(other, pocket.id, pocketInput()),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(PocketError);
    }
    expect(await accrueMonth(other, thisMonth)).toEqual({ written: 0 });
    expect(await balanceOf(pocket.id)).toBe(25_000n);
  });
});
