import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountsView, getAccount, listBalanceEntries } from "@/modules/accounts/queries";
import { applyProviderAccounts, deleteBalanceEntry, removeAccount } from "@/modules/accounts/service";
import { upsertFromProvider } from "@/modules/transactions/service";
import type { Ctx } from "@/platform/context";
import { WALLET_PROVIDER } from "@/platform/integrations/rules";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { fundDetail, fundsView, valuationAccountOptions } from "./queries";
import {
  addDeposit,
  createFund,
  deleteDeposit,
  deleteValuation,
  FundError,
  matchDeposits,
  recordValuation,
  saveDepositRule,
  setFundState,
  updateFund,
} from "./service";

let ctx: Ctx;

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Fideuram Piano Accumulo",
    provider: "Fideuram",
    isin: "LU0987654321",
    compartment: "Bilanciato",
    debitAccountId: null,
    debitDay: 5,
    ter: "0.012",
    startOn: "2026-01-01",
    monthlyCents: 25_100n,
    depositFeeCents: 100n,
    valuationAccountId: null,
    initialCents: 500_000n,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});

afterAll(closeDatabase);

describe("a PAC (spec §7.7)", () => {
  it("creates its valuation account and books the initial capital as the first deposit", async () => {
    const fund = await createFund(ctx, input());
    const account = await getAccount(ctx, fund.valuationAccountId);
    expect(account).toMatchObject({ name: "Fideuram Piano Accumulo", type: "investment", origin: "manual" });
    const detail = await fundDetail(ctx, fund.id);
    expect(detail.deposits).toEqual([
      expect.objectContaining({ on: "2026-01-01", chargedCents: 500_000n, feeCents: 0n }),
    ]);
    expect(detail.metrics).toMatchObject({ paidInCents: 500_000n, valueCents: null, gainCents: null });
  });

  it("keeps the value on the valuation account, where net worth reads it", async () => {
    const fund = await createFund(ctx, input());
    await addDeposit(ctx, fund.id, { on: "2026-02-05", chargedCents: 25_100n, feeCents: 100n, note: null });
    await addDeposit(ctx, fund.id, { on: "2026-03-05", chargedCents: 25_100n, feeCents: 100n, note: null });
    await recordValuation(ctx, fund.id, {
      on: "2026-02-28",
      cents: 530_000n,
      units: "100.5",
      note: "Statement Feb",
    });
    await recordValuation(ctx, fund.id, { on: "2026-03-31", cents: 560_000n });

    const detail = await fundDetail(ctx, fund.id);
    expect(detail.metrics).toMatchObject({
      paidInCents: 550_200n,
      feesCents: 200n,
      investedCents: 550_000n,
      valueCents: 560_000n,
      gainCents: 9_800n,
    });
    expect(detail.valuations.map((row) => [row.on, row.valueCents, row.units, row.paidInCents])).toEqual([
      ["2026-03-31", 560_000n, null, 550_200n],
      ["2026-02-28", 530_000n, "100.500000", 525_100n],
    ]);
    // March by Simple Dietz: (5.600 − 5.300 − 251) / (5.300 + 251).
    const march = detail.returns[detail.months.slice(-12).indexOf("2026-03-01")];
    expect(march).toBeCloseTo(4_900 / 555_100, 8);

    const view = await accountsView(ctx);
    expect(view.rows.find((row) => row.account.id === fund.valuationAccountId)?.balance).toBe(560_000n);
    expect((await fundsView(ctx)).rows[0].lastValuation).toBe("2026-03-31");
  });

  it("loses a valuation deleted from Account detail, and deletes one's balance", async () => {
    const fund = await createFund(ctx, input());
    await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 530_000n });
    const valuation = await recordValuation(ctx, fund.id, { on: "2026-03-31", cents: 560_000n });
    const [latest] = await listBalanceEntries(ctx, fund.valuationAccountId);
    await deleteBalanceEntry(ctx, latest.id);
    expect((await fundDetail(ctx, fund.id)).valuations.map((row) => row.on)).toEqual(["2026-02-28"]);
    await expect(deleteValuation(ctx, valuation.id)).rejects.toMatchObject({ code: "not_found" });
    const [left] = (await fundDetail(ctx, fund.id)).valuations;
    await deleteValuation(ctx, left.id);
    expect(await listBalanceEntries(ctx, fund.valuationAccountId)).toEqual([]);
  });

  it("refuses a future day, an archived fund, and a deposit linked to a movement is not deleted by hand", async () => {
    const fund = await createFund(ctx, input({ initialCents: null }));
    await expect(recordValuation(ctx, fund.id, { on: "2999-01-01", cents: 1n })).rejects.toMatchObject({
      code: "future_date",
    });
    const manual = await addDeposit(ctx, fund.id, {
      on: "2026-02-05",
      chargedCents: 100n,
      feeCents: null,
      note: null,
    });
    await deleteDeposit(ctx, manual.id);
    await setFundState(ctx, fund.id, "archived");
    await expect(
      addDeposit(ctx, fund.id, { on: "2026-02-05", chargedCents: 1n, feeCents: 0n, note: null }),
    ).rejects.toMatchObject({
      code: "archived",
    });
    expect((await fundsView(ctx)).archived.map((one) => one.id)).toEqual([fund.id]);
  });

  it("only holds its value on a manual account no other fund uses, and that account is archived, not deleted", async () => {
    const own = await anAccount(ctx, "Fondo");
    const fund = await createFund(ctx, input({ valuationAccountId: own }));
    expect(await valuationAccountOptions(ctx)).toEqual([]);
    await expect(createFund(ctx, input({ name: "Other", valuationAccountId: own }))).rejects.toMatchObject({
      code: "invalid_account",
    });
    await applyProviderAccounts(ctx, WALLET_PROVIDER, [
      {
        provider: WALLET_PROVIDER,
        providerAccountId: "wa-1",
        name: "Synced",
        type: "investment",
        currency: "EUR",
      },
    ]);
    const synced = (await accountsView(ctx)).rows.find((row) => row.account.name === "Synced")!.account.id;
    await expect(createFund(ctx, input({ name: "Other", valuationAccountId: synced }))).rejects.toMatchObject(
      {
        code: "invalid_account",
      },
    );
    await expect(createFund(ctx, input({ valuationAccountId: null }))).rejects.toMatchObject({
      code: "duplicate_name",
    });
    // The account made for the refused fund was taken back.
    expect(
      (await accountsView(ctx)).rows.filter((row) => row.account.name === "Fideuram Piano Accumulo"),
    ).toHaveLength(0);
    expect(await removeAccount(ctx, fund.valuationAccountId)).toBe("archived");
    await updateFund(ctx, fund.id, input({ name: "Renamed" }));
    expect((await fundDetail(ctx, fund.id)).fund.name).toBe("Renamed");
  });
});

describe("deposits from movements (spec §7.7)", () => {
  it("turns the matching debits into deposits once, with the fund's fee, and keeps them from being deleted", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    await upsertFromProvider(ctx, bank, [
      movement({
        payee: "FIDEURAM PAC — addebito SDD",
        amountCents: -25_100n,
        occurredAt: new Date("2026-02-05T10:00:00Z"),
      }),
      movement({
        payee: "Fideuram",
        amountCents: -25_100n,
        type: "transfer",
        occurredAt: new Date("2026-03-05T10:00:00Z"),
      }),
      movement({ payee: "Esselunga", amountCents: -2_000n, occurredAt: new Date("2026-03-06T10:00:00Z") }),
    ]);
    const fund = await createFund(ctx, input({ initialCents: null }));
    await saveDepositRule(ctx, fund.id, { payeeMatch: "fideuram", accountId: bank, active: true });
    expect(await matchDeposits(ctx)).toEqual({ written: 0 });
    const deposits = (await fundDetail(ctx, fund.id)).deposits;
    expect(
      deposits.map((row) => [row.on, row.chargedCents, row.feeCents, row.investedCents, row.source]),
    ).toEqual([
      ["2026-03-05", 25_100n, 100n, 25_000n, "rule"],
      ["2026-02-05", 25_100n, 100n, 25_000n, "rule"],
    ]);
    await expect(deleteDeposit(ctx, deposits[0].id)).rejects.toMatchObject({ code: "linked" });
  });

  it("matches nothing while the rule is off or on another account", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    const other = await anAccount(ctx, "Revolut");
    await upsertFromProvider(ctx, bank, [
      movement({ payee: "FIDEURAM", amountCents: -25_100n, occurredAt: new Date("2026-02-05T10:00:00Z") }),
    ]);
    const fund = await createFund(ctx, input({ initialCents: null }));
    await saveDepositRule(ctx, fund.id, { payeeMatch: "fideuram", accountId: other, active: true });
    await saveDepositRule(ctx, fund.id, { payeeMatch: "fideuram", accountId: bank, active: false });
    expect((await fundDetail(ctx, fund.id)).deposits).toEqual([]);
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  it("never reads, values, deposits into or builds on another user's fund or account", async () => {
    const fund = await createFund(ctx, input());
    const other = await newContext();
    expect((await fundsView(other)).rows).toEqual([]);
    await expect(fundDetail(other, fund.id)).rejects.toBeInstanceOf(FundError);
    for (const attempt of [
      () => recordValuation(other, fund.id, { on: "2026-02-28", cents: 1n }),
      () => addDeposit(other, fund.id, { on: "2026-02-05", chargedCents: 1n, feeCents: 0n, note: null }),
      () => updateFund(other, fund.id, input()),
      () => setFundState(other, fund.id, "archived"),
      () => saveDepositRule(other, fund.id, { payeeMatch: "x", accountId: null, active: true }),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(FundError);
    }
    await expect(
      createFund(other, input({ valuationAccountId: fund.valuationAccountId })),
    ).rejects.toMatchObject({
      code: "invalid_account",
    });
  });
});
