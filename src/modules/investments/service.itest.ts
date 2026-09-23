import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { balancesOn } from "@/modules/accounts/queries";
import { saveBalanceEntry } from "@/modules/accounts/service";
import { linkCandidates } from "@/modules/transactions/queries";
import {
  deleteHiddenTransactions,
  hideTransaction,
  upsertFromProvider,
} from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { addDays, today } from "@/platform/dates";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { investmentsView } from "./queries";
import {
  createMovement,
  createPlatform,
  deleteMovement,
  deletePlatform,
  InvestmentError,
  setValuation,
  updateMovement,
} from "./service";

let ctx: Ctx;
let todayOn: string;

const noon = (on: string) => new Date(`${on}T12:00:00Z`);

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  todayOn = today(ctx.timeZone);
});

afterAll(closeDatabase);

describe("platforms", () => {
  it("keeps names unique per person and only web links", async () => {
    await createPlatform(ctx, { name: "eToro", url: "www.etoro.com" });
    await expect(createPlatform(ctx, { name: "eToro", url: null })).rejects.toMatchObject({
      code: "duplicate_name",
    });
    const other = await newContext();
    await expect(createPlatform(other, { name: "eToro", url: null })).resolves.toMatchObject({
      name: "eToro",
    });
    const view = await investmentsView(ctx);
    expect(view.platforms.map((one) => one.platform.url)).toEqual(["https://www.etoro.com"]);
  });

  it("deletes a platform with its history and says how many movements went", async () => {
    const platform = await createPlatform(ctx, { name: "Binance", url: null });
    await createMovement(ctx, {
      platformId: platform.id,
      kind: "deposit",
      amountCents: 280_000n,
      on: todayOn,
    });
    await createMovement(ctx, {
      platformId: platform.id,
      kind: "deposit",
      amountCents: 70_000n,
      on: todayOn,
    });
    await setValuation(ctx, platform.id, { valueCents: 300_000n, on: todayOn });
    expect(await deletePlatform(ctx, platform.id)).toEqual({ movements: 2 });
    const view = await investmentsView(ctx);
    expect(view.platforms).toEqual([]);
    expect(view.movements).toEqual([]);
  });
});

describe("movements and statistics", () => {
  it("adds deposits and withdrawals up, and values the platform from its latest valuation", async () => {
    const platform = await createPlatform(ctx, { name: "Binance", url: null });
    const on = addDays(todayOn, -30);
    await createMovement(ctx, { platformId: platform.id, kind: "deposit", amountCents: 280_000n, on });
    await createMovement(ctx, {
      platformId: platform.id,
      kind: "withdrawal",
      amountCents: 50_000n,
      on: todayOn,
    });
    let view = await investmentsView(ctx);
    expect(view.totals).toMatchObject({
      depositedCents: 280_000n,
      withdrawnCents: 50_000n,
      valueCents: null,
    });
    expect(view.totals.partial).toBe(true);

    await setValuation(ctx, platform.id, { valueCents: 250_000n, on: addDays(todayOn, -1) });
    view = await investmentsView(ctx);
    expect(view.totals).toMatchObject({ valueCents: 200_000n, estimated: true, gainCents: -30_000n });

    // A second valuation the same day replaces the first.
    await setValuation(ctx, platform.id, { valueCents: 310_000n, on: todayOn });
    await setValuation(ctx, platform.id, { valueCents: 320_000n, on: todayOn });
    view = await investmentsView(ctx, { platformId: platform.id });
    expect(view.valuations.map((one) => one.valueCents)).toEqual([320_000n, 250_000n]);
    expect(view.totals).toMatchObject({ valueCents: 320_000n, estimated: false, gainCents: 90_000n });
  });

  it("refuses a date in the future and another person's platform", async () => {
    const platform = await createPlatform(ctx, { name: "Binance", url: null });
    await expect(
      createMovement(ctx, {
        platformId: platform.id,
        kind: "deposit",
        amountCents: 100n,
        on: addDays(todayOn, 1),
      }),
    ).rejects.toMatchObject({ code: "future_date" });
    const other = await newContext();
    await expect(
      createMovement(other, { platformId: platform.id, kind: "deposit", amountCents: 100n, on: todayOn }),
    ).rejects.toBeInstanceOf(InvestmentError);
    expect((await investmentsView(other)).movements).toEqual([]);
  });
});

describe("linking to an account movement", () => {
  it("links a deposit to money out of an account and leaves the balance alone", async () => {
    const accountId = await anAccount(ctx);
    await saveBalanceEntry(ctx, accountId, { on: todayOn, cents: 500_000n });
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "Bonifico eToro", amountCents: -200_000n, occurredAt: noon(todayOn) }),
      movement({ payee: "Rimborso eToro", amountCents: 240_158n, type: "income", occurredAt: noon(todayOn) }),
    ]);
    const window = { from: addDays(todayOn, -7), to: todayOn };
    const [out] = await linkCandidates(ctx, { direction: "out", ...window });
    const [incoming] = await linkCandidates(ctx, { direction: "in", ...window });
    const before = await balancesOn(ctx, [accountId], todayOn);

    const platform = await createPlatform(ctx, { name: "eToro", url: null });
    const deposit = await createMovement(ctx, {
      platformId: platform.id,
      kind: "deposit",
      amountCents: 200_000n,
      on: todayOn,
      transactionId: out.id,
    });
    // Money out of the account documents a deposit, not a withdrawal.
    await expect(
      createMovement(ctx, {
        platformId: platform.id,
        kind: "withdrawal",
        amountCents: 240_158n,
        on: todayOn,
        transactionId: out.id,
      }),
    ).rejects.toMatchObject({ code: "invalid_transaction" });
    // One bank movement documents one platform movement.
    await expect(
      createMovement(ctx, {
        platformId: platform.id,
        kind: "deposit",
        amountCents: 1n,
        on: todayOn,
        transactionId: out.id,
      }),
    ).rejects.toMatchObject({ code: "already_linked" });
    await createMovement(ctx, {
      platformId: platform.id,
      kind: "withdrawal",
      amountCents: 240_158n,
      on: todayOn,
      transactionId: incoming.id,
    });

    const view = await investmentsView(ctx);
    const linked = view.movements.find((row) => row.movement.id === deposit.id)?.linked;
    expect(linked).toMatchObject({
      payee: "Bonifico eToro",
      cents: 200_000n,
      accountName: "ING Conto Arancio",
    });
    expect(view.linkOptions.out.map((one) => one.id)).not.toContain(out.id);
    expect(await balancesOn(ctx, [accountId], todayOn)).toEqual(before);

    // Unlinking is an edit like any other.
    await updateMovement(ctx, deposit.id, {
      platformId: platform.id,
      kind: "deposit",
      amountCents: 200_000n,
      on: todayOn,
      transactionId: null,
    });
    expect((await investmentsView(ctx)).linkOptions.out.map((one) => one.id)).toContain(out.id);
  });

  it("forgets the link when the bank movement is deleted, and keeps the platform movement", async () => {
    const accountId = await anAccount(ctx);
    await upsertFromProvider(ctx, accountId, [
      movement({ payee: "Bonifico Binance", amountCents: -70_000n, occurredAt: noon(todayOn) }),
    ]);
    const [out] = await linkCandidates(ctx, { direction: "out", from: todayOn, to: todayOn });
    const platform = await createPlatform(ctx, { name: "Binance", url: null });
    const deposit = await createMovement(ctx, {
      platformId: platform.id,
      kind: "deposit",
      amountCents: 70_000n,
      on: todayOn,
      transactionId: out.id,
    });
    await hideTransaction(ctx, out.id);
    await deleteHiddenTransactions(ctx, [out.id]);
    const view = await investmentsView(ctx);
    expect(view.movements.map((row) => [row.movement.id, row.movement.transactionId])).toEqual([
      [deposit.id, null],
    ]);
    await deleteMovement(ctx, deposit.id);
    expect((await investmentsView(ctx)).movements).toEqual([]);
  });
});
