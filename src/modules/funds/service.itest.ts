import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountsView, getAccount, listBalanceEntries } from "@/modules/accounts/queries";
import { applyProviderAccounts, deleteBalanceEntry, removeAccount } from "@/modules/accounts/service";
import { chargeCandidates } from "@/modules/transactions/queries";
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
  proposeDepositRule,
  recordValuation,
  saveDepositRule,
  setFundState,
  updateFund,
  updateValuation,
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
    // The stretch between the two valuations, by Simple Dietz: (5.600 − 5.300 − 251) / (5.300 +
    // 251). Between them and not month by month: a month nobody valued has no end to measure
    // against (owner, 2026-09-20).
    expect(detail.periods).toHaveLength(1);
    expect(detail.periods[0]).toMatchObject({
      from: "2026-02-28",
      to: "2026-03-31",
      days: 31,
      flowsCents: 25_100n,
      gainCents: 4_900n,
    });
    expect(detail.periods[0].fraction).toBeCloseTo(4_900 / 555_100, 8);

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

  it("corrects a valuation's value in place, leaving the balance it lives in where it was", async () => {
    const fund = await createFund(ctx, input());
    const valuation = await recordValuation(ctx, fund.id, {
      on: "2026-02-28",
      cents: 530_000n,
      units: "100.5",
      note: "Statement Feb",
    });
    const updated = await updateValuation(ctx, valuation.id, {
      on: "2026-02-28",
      cents: 545_000n,
      units: "101",
      note: "Corrected",
    });
    expect(updated.id).toBe(valuation.id);
    expect(updated.balanceEntryId).toBe(valuation.balanceEntryId);
    const detail = await fundDetail(ctx, fund.id);
    expect(detail.valuations.map((row) => [row.on, row.valueCents, row.units, row.note])).toEqual([
      ["2026-02-28", 545_000n, "101.000000", "Corrected"],
    ]);
    expect(detail.metrics.valueCents).toBe(545_000n);
    // The value's one home moved with it: net worth reads the account, not the valuation row.
    const view = await accountsView(ctx);
    expect(view.rows.find((row) => row.account.id === fund.valuationAccountId)?.balance).toBe(545_000n);
  });

  it("moves the balance with the valuation when the day changes, leaving neither a second row nor an orphan", async () => {
    const fund = await createFund(ctx, input());
    const valuation = await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 530_000n });
    const moved = await updateValuation(ctx, valuation.id, { on: "2026-03-31", cents: 560_000n });
    expect(moved.id).toBe(valuation.id);
    expect(moved.balanceEntryId).not.toBe(valuation.balanceEntryId);
    expect((await fundDetail(ctx, fund.id)).valuations.map((row) => [row.on, row.valueCents])).toEqual([
      ["2026-03-31", 560_000n],
    ]);
    // The old day's balance went with it: one manual entry, on the new day.
    expect(
      (await listBalanceEntries(ctx, fund.valuationAccountId)).map((entry) => [
        entry.on,
        entry.source,
        entry.balanceCents,
      ]),
    ).toEqual([["2026-03-31", "manual", 560_000n]]);
  });

  it("keeps one value a day: moving onto a day that already has one replaces it", async () => {
    const fund = await createFund(ctx, input());
    const february = await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 530_000n });
    await recordValuation(ctx, fund.id, { on: "2026-03-31", cents: 560_000n });
    await updateValuation(ctx, february.id, { on: "2026-03-31", cents: 555_000n, units: "102" });
    const detail = await fundDetail(ctx, fund.id);
    expect(detail.valuations.map((row) => [row.id, row.on, row.valueCents, row.units])).toEqual([
      [february.id, "2026-03-31", 555_000n, "102.000000"],
    ]);
    expect(await listBalanceEntries(ctx, fund.valuationAccountId)).toHaveLength(1);
  });

  it("refuses a future day, an unknown valuation and an archived fund on an edit", async () => {
    const fund = await createFund(ctx, input());
    const valuation = await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 530_000n });
    await expect(updateValuation(ctx, valuation.id, { on: "2999-01-01", cents: 1n })).rejects.toMatchObject({
      code: "future_date",
    });
    await expect(updateValuation(ctx, fund.id, { on: "2026-02-28", cents: 1n })).rejects.toMatchObject({
      code: "not_found",
    });
    // Refused means nothing moved.
    expect((await fundDetail(ctx, fund.id)).valuations.map((row) => [row.on, row.valueCents])).toEqual([
      ["2026-02-28", 530_000n],
    ]);
    await setFundState(ctx, fund.id, "archived");
    await expect(updateValuation(ctx, valuation.id, { on: "2026-03-31", cents: 1n })).rejects.toMatchObject({
      code: "archived",
    });
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

  /*
    "Find this charge everywhere" (owner, 2026-09-20): one charge names the rest. The payee here
    changes from month to month, as a bank's does; the creditor identifier of the direct debit does
    not, and it is what the rule ends up matching on — no model asked, no text typed.
  */
  it("names a recurring charge by its creditor, and takes the past ones on", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    const debit = (on: string, payee: string) =>
      movement({
        payee,
        note: `Addebito SDD Id creditore IT66 ZZZ 12345678901234 rata PAC`,
        amountCents: -25_100n,
        occurredAt: new Date(`${on}T10:00:00Z`),
      });
    await upsertFromProvider(ctx, bank, [
      debit("2026-02-05", "SDD FIDEURAM 02/26"),
      debit("2026-03-05", "SDD FIDEURAM 03/26"),
      movement({ payee: "Esselunga", amountCents: -2_000n, occurredAt: new Date("2026-03-06T10:00:00Z") }),
    ]);
    const fund = await createFund(ctx, input({ initialCents: null, debitAccountId: bank }));
    const charges = await chargeCandidates(ctx, {
      accountId: bank,
      from: "2026-01-01",
      to: "2026-12-31",
      types: ["expense", "transfer"],
    });
    const chosen = charges.find((one) => one.on === "2026-03-05")!;

    const found = await proposeDepositRule(ctx, fund.id, chosen.id);
    expect(found).toMatchObject({
      key: { kind: "creditor", text: "IT66ZZZ12345678901234" },
      first: "2026-02-05",
      last: "2026-03-05",
      medianCents: 25_100n,
    });
    expect(found?.charges).toHaveLength(2);

    // The shopping is not part of it, and saving the rule brings the two charges in as deposits.
    await saveDepositRule(ctx, fund.id, {
      payeeMatch: found!.key.text,
      accountId: bank,
      active: true,
    });
    expect((await fundDetail(ctx, fund.id)).deposits.map((row) => [row.on, row.source])).toEqual([
      ["2026-03-05", "rule"],
      ["2026-02-05", "rule"],
    ]);
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
    const valuation = await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 530_000n });
    const other = await newContext();
    expect((await fundsView(other)).rows).toEqual([]);
    await expect(fundDetail(other, fund.id)).rejects.toBeInstanceOf(FundError);
    for (const attempt of [
      () => recordValuation(other, fund.id, { on: "2026-02-28", cents: 1n }),
      () => updateValuation(other, valuation.id, { on: "2026-02-28", cents: 1n }),
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
    // Nothing of the owner's was touched by the attempts above.
    expect((await fundDetail(ctx, fund.id)).valuations.map((row) => [row.on, row.valueCents])).toEqual([
      ["2026-02-28", 530_000n],
    ]);
    expect(valuation.source).toBe("manual");
  });
});
