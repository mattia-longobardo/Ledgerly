import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountsView, getAccount, listBalanceEntries } from "../accounts/queries";
import { deleteBalanceEntry, removeAccount, runSnapshot } from "../accounts/service";
import { chargeCandidates } from "../transactions/queries";
import { markRemovedUpstream, purgeRemovedUpstream, upsertFromProvider } from "../transactions/service";
import type { Ctx } from "../../platform/context";
import { today } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { anAccount, movement, newContext } from "../../../../../test/fixtures";
import { addDeposit, debitFund, payrollFund, saveDepositRule } from "../../../../../test/funds";
import { fundSummary } from "./detail";
import { firstDataOn, homeSummary } from "./home";
import { fundHomeRow, fundsHomeRows } from "./home-queries";
import { fundsDepositsJob } from "../../../../../apps/web/src/modules/funds/jobs";
import { fundsExport } from "./overview";
import { allPeriod } from "./period";
import { type FundDetail, fundDetail, fundDetailFlows, hasPayrollCalendar } from "./queries";
import { periodReturns } from "./rules";
import { fundContributionSources, fundFees } from "./schema";
import {
  addContribution,
  addFee,
  addSource,
  createFund,
  deleteContribution,
  deleteValuation,
  feesOf,
  FundError,
  matchDebits,
  proposeDebitMatch,
  recordValuation,
  removeFee,
  removeSource,
  restoreSource,
  setFundState,
  setSourceState,
  sourcesOf,
  updateFee,
  updateFund,
  updateValuation,
} from "./service";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

let ctx: Ctx;

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Fideuram Piano Accumulo",
    provider: "Fideuram",
    code: "LU0987654321",
    compartment: "Bilanciato",
    debitAccountId: null,
    debitDay: 5,
    ter: "0.012",
    startOn: "2026-01-01",
    monthlyCents: 25_100n,
    depositFeeCents: 100n,
    initialCents: 500_000n,
    ...overrides,
  };
}

/**
 * The fund's register as the Deposits tab listed it before release N6: newest first, with the
 * names its columns had then. The rows are the fund's operations.
 */
async function depositsOf(fundId: string) {
  const { operations } = await fundDetail(ctx, fundId);
  return [...operations].reverse().map((row) => ({
    id: row.id,
    on: row.operationDate,
    chargedCents: row.workerCents,
    feeCents: row.feesUnknown ? null : row.feesCents,
    investedCents: row.netCents,
    source: row.source,
    transactionId: row.transactionId,
  }));
}

/** The fund's figures under the names they had before release N6: the value is a dated value now. */
function metricsOf(detail: FundDetail) {
  const { paidInCents, feesCents, investedCents, gainCents, value } = detail.metrics;
  return { paidInCents, feesCents, investedCents, valueCents: value?.cents ?? null, gainCents };
}

/** What the fund did between one recorded value and the next: the stretches the page drew before N6. */
function periodsOf(detail: FundDetail) {
  return periodReturns(
    detail.valuations.map((row) => ({ on: row.on, cents: row.valueCents })),
    fundDetailFlows(detail, today(ctx.timeZone)),
  );
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});

afterAll(closeDatabase);

describe("a PAC (spec §7.7)", () => {
  it("creates its valuation account and books the initial capital as the first deposit", async () => {
    const fund = await debitFund(ctx, input());
    const account = await getAccount(ctx, fund.valuationAccountId);
    expect(account).toMatchObject({ name: "Fideuram Piano Accumulo", type: "pension", origin: "manual" });
    const detail = await fundDetail(ctx, fund.id);
    expect(await depositsOf(fund.id)).toEqual([
      expect.objectContaining({ on: "2026-01-01", chargedCents: 500_000n, feeCents: 0n }),
    ]);
    expect(metricsOf(detail)).toMatchObject({ paidInCents: 500_000n, valueCents: null, gainCents: null });
  });

  it("keeps the value on the valuation account, where net worth reads it", async () => {
    const fund = await debitFund(ctx, input());
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
    expect(metricsOf(detail)).toMatchObject({
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
    const periods = periodsOf(detail);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      from: "2026-02-28",
      to: "2026-03-31",
      days: 31,
      flowsCents: 25_100n,
      gainCents: 4_900n,
    });
    expect(periods[0].fraction).toBeCloseTo(4_900 / 555_100, 8);

    const view = await accountsView(ctx);
    expect(view.rows.find((row) => row.account.id === fund.valuationAccountId)?.balance).toBe(560_000n);
    expect((await fundsExport(ctx))[0].lastValuation).toBe("2026-03-31");
  });

  it("loses a valuation deleted from Account detail, and deletes one's balance", async () => {
    const fund = await debitFund(ctx, input());
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
    const fund = await debitFund(ctx, input());
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
    expect(metricsOf(detail).valueCents).toBe(545_000n);
    // The value's one home moved with it: net worth reads the account, not the valuation row.
    const view = await accountsView(ctx);
    expect(view.rows.find((row) => row.account.id === fund.valuationAccountId)?.balance).toBe(545_000n);
  });

  it("moves the balance with the valuation when the day changes, leaving neither a second row nor an orphan", async () => {
    const fund = await debitFund(ctx, input());
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
    const fund = await debitFund(ctx, input());
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
    const fund = await debitFund(ctx, input());
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
    const fund = await debitFund(ctx, input({ initialCents: null }));
    await expect(recordValuation(ctx, fund.id, { on: "2999-01-01", cents: 1n })).rejects.toMatchObject({
      code: "future_date",
    });
    const manual = await addDeposit(ctx, fund.id, {
      on: "2026-02-05",
      chargedCents: 100n,
      feeCents: null,
      note: null,
    });
    await deleteContribution(ctx, manual.id);
    await setFundState(ctx, fund.id, "archived");
    await expect(
      addDeposit(ctx, fund.id, { on: "2026-02-05", chargedCents: 1n, feeCents: 0n, note: null }),
    ).rejects.toMatchObject({
      code: "archived",
    });
    expect(
      (await fundsExport(ctx)).filter((one) => one.fund.state === "archived").map((one) => one.fund.id),
    ).toEqual([fund.id]);
  });

  it("refuses a second fund of the same name, and its account is not deleted while the fund rests on it", async () => {
    const fund = await debitFund(ctx, input());
    await expect(debitFund(ctx, input())).rejects.toMatchObject({
      code: "duplicate_name",
    });
    // No account was left behind for the refused fund: the one of that name is the first fund's.
    expect(
      (await accountsView(ctx)).rows.filter((row) => row.account.name === "Fideuram Piano Accumulo"),
    ).toHaveLength(1);
    await expect(removeAccount(ctx, fund.valuationAccountId)).rejects.toMatchObject({ code: "in_use" });
    await updateFund(ctx, fund.id, input({ name: "Renamed" }));
    expect((await fundDetail(ctx, fund.id)).fund.name).toBe("Renamed");
  });

  it("renames its account with it: the fund's page shows the account's name (PERS-589)", async () => {
    const fund = await debitFund(ctx, input());
    await updateFund(ctx, fund.id, input({ name: "Renamed" }));
    expect((await getAccount(ctx, fund.valuationAccountId))?.name).toBe("Renamed");
  });
});

describe("deposits from movements (spec §7.7)", () => {
  it("turns the matching debits into deposits once, with the fund's fee, and keeps them from being deleted", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    await upsertFromProvider(
      ctx,
      bank,
      [
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
      ],
      { provider: WALLET_PROVIDER },
    );
    const fund = await debitFund(ctx, input({ initialCents: null }));
    await saveDepositRule(ctx, fund.id, { payeeMatch: "fideuram", accountId: bank, active: true });
    expect(await matchDebits(ctx)).toEqual({ written: 0 });
    const deposits = await depositsOf(fund.id);
    expect(
      deposits.map((row) => [row.on, row.chargedCents, row.feeCents, row.investedCents, row.source]),
    ).toEqual([
      ["2026-03-05", 25_100n, 100n, 25_000n, "rule"],
      ["2026-02-05", 25_100n, 100n, 25_000n, "rule"],
    ]);
    await expect(deleteContribution(ctx, deposits[0].id)).rejects.toMatchObject({ code: "linked" });
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
    await upsertFromProvider(
      ctx,
      bank,
      [
        debit("2026-02-05", "SDD FIDEURAM 02/26"),
        debit("2026-03-05", "SDD FIDEURAM 03/26"),
        movement({ payee: "Esselunga", amountCents: -2_000n, occurredAt: new Date("2026-03-06T10:00:00Z") }),
      ],
      { provider: WALLET_PROVIDER },
    );
    const fund = await debitFund(ctx, input({ initialCents: null, debitAccountId: bank }));
    const charges = await chargeCandidates(ctx, {
      accountId: bank,
      from: "2026-01-01",
      to: "2026-12-31",
      types: ["expense", "transfer"],
    });
    const chosen = charges.find((one) => one.on === "2026-03-05")!;

    const found = await proposeDebitMatch(ctx, fund.id, chosen.id, bank);
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
    expect((await depositsOf(fund.id)).map((row) => [row.on, row.source])).toEqual([
      ["2026-03-05", "rule"],
      ["2026-02-05", "rule"],
    ]);
  });

  /*
    Wallet gave the debit of 19 October a new id on every pass: the old movement was purged, its
    deposit lost the link, and the new movement made a second one — six in two days (owner,
    2026-10-25). The new movement takes the orphan back instead.
  */
  it("takes an orphaned deposit back when the provider sends its debit again under a new id", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    const fund = await debitFund(ctx, input({ initialCents: null }));
    await saveDepositRule(ctx, fund.id, { payeeMatch: "fideuram", accountId: bank, active: true });
    const debit = (externalId: string) =>
      movement({
        externalId,
        payee: "FIDEURAM",
        amountCents: -25_100n,
        occurredAt: new Date("2026-10-19T10:00:00Z"),
      });

    await upsertFromProvider(ctx, bank, [debit("wallet-1")], { provider: WALLET_PROVIDER });
    await matchDebits(ctx);
    const [first] = await depositsOf(fund.id);
    for (const next of ["wallet-2", "wallet-3"]) {
      await markRemovedUpstream(ctx, [(await depositsOf(fund.id))[0].transactionId!]);
      await purgeRemovedUpstream(ctx, { provider: WALLET_PROVIDER });
      await upsertFromProvider(ctx, bank, [debit(next)], { provider: WALLET_PROVIDER });
      expect(await matchDebits(ctx)).toEqual({ written: 0 });
    }

    const deposits = await depositsOf(fund.id);
    expect(deposits).toHaveLength(1);
    expect(deposits[0].id).toBe(first.id);
    expect(deposits[0].transactionId).not.toBeNull();
    expect(deposits[0].transactionId).not.toBe(first.transactionId);
  });

  it("matches nothing while the rule is off or on another account", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    const other = await anAccount(ctx, "Revolut");
    await upsertFromProvider(
      ctx,
      bank,
      [movement({ payee: "FIDEURAM", amountCents: -25_100n, occurredAt: new Date("2026-02-05T10:00:00Z") })],
      { provider: WALLET_PROVIDER },
    );
    const fund = await debitFund(ctx, input({ initialCents: null }));
    await saveDepositRule(ctx, fund.id, { payeeMatch: "fideuram", accountId: other, active: true });
    await saveDepositRule(ctx, fund.id, { payeeMatch: "fideuram", accountId: bank, active: false });
    expect(await depositsOf(fund.id)).toEqual([]);
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  /*
    The totals row is the column above it, added up. Worked out instead from a combined value less
    a combined paid-in, it read +2.418,59 € under two rows worth +225,53 € — because a fund whose
    gain stands on its own last valuation cannot be re-derived from two sums (owner, 2026-09-20).
  */
  it("adds the gains of the rows into the total, and leaves a fund with no value out", async () => {
    const first = await debitFund(ctx, input({ name: "Fideuram", initialCents: 500_000n }));
    await recordValuation(ctx, first.id, { on: "2026-03-31", cents: 560_000n });
    // A deposit after that valuation: outside its gain, and outside the total's.
    await addDeposit(ctx, first.id, {
      on: "2026-04-05",
      chargedCents: 25_100n,
      feeCents: 100n,
      note: null,
    });
    const second = await debitFund(ctx, input({ name: "Anima", initialCents: 100_000n }));
    await recordValuation(ctx, second.id, { on: "2026-03-31", cents: 90_000n });
    // A third with nothing recorded: it has no gain to add.
    await debitFund(ctx, input({ name: "Senza valore", initialCents: 300_000n }));

    const todayOn = today(ctx.timeZone);
    const funds = (await fundsHomeRows(ctx)).map((row) => row.home);
    const view = homeSummary({ funds, period: allPeriod(todayOn), todayOn, firstOn: firstDataOn(funds) });
    // By name, as the list orders them: Anima, Fideuram, Senza valore.
    const gains = view.lines.map((line) => line.measure.gainCents);
    expect(gains).toEqual([-10_000n, 60_000n, null]);
    expect(view.gainCents).toBe(50_000n);
    // The paid-in stays what really left the bank, the April deposit included.
    expect(view.paidInCents).toBe(925_100n);
  });

  it("never reads, values, deposits into or builds on another user's fund or account", async () => {
    const fund = await debitFund(ctx, input());
    const valuation = await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 530_000n });
    const other = await newContext();
    expect(await fundsExport(other)).toEqual([]);
    await expect(fundDetail(other, fund.id)).rejects.toBeInstanceOf(FundError);
    for (const attempt of [
      () => recordValuation(other, fund.id, { on: "2026-02-28", cents: 1n }),
      () => updateValuation(other, valuation.id, { on: "2026-02-28", cents: 1n }),
      () => addDeposit(other, fund.id, { on: "2026-02-05", chargedCents: 1n, feeCents: 0n, note: null }),
      () => updateFund(other, fund.id, input()),
      () => setFundState(other, fund.id, "archived"),
      () =>
        addSource(other, fund.id, {
          kind: "bank_debit",
          amountCents: 25_100n,
          frequency: { count: 1, unit: "month" },
          payeeMatch: "x",
        }),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(FundError);
    }
    // Nothing of the owner's was touched by the attempts above.
    expect((await fundDetail(ctx, fund.id)).valuations.map((row) => [row.on, row.valueCents])).toEqual([
      ["2026-02-28", 530_000n],
    ]);
    expect(valuation.source).toBe("manual");
  });
});

describe("a fund's system copies (funds-ux §4, n. 1)", () => {
  const NOW = new Date("2026-11-01T12:00:00Z");

  it("leaves a pension fund's value and date on the last reading in fundsView", async () => {
    const fund = await payrollFund(ctx, { name: "Cometa", startOn: "2026-01-01" });
    await recordValuation(ctx, fund.id, { on: "2026-09-30", cents: 223_536n });
    await runSnapshot(ctx, "2026-10-01");
    expect((await listBalanceEntries(ctx, fund.valuationAccountId))[0]).toMatchObject({
      on: "2026-10-31",
      source: "system",
    });

    const view = await fundsExport(ctx, NOW);
    expect(view[0]).toMatchObject({ lastValuation: "2026-09-30", valueCents: 223_536n });
  });

  it("measures the gain against the money in by that date, not by the copy's", async () => {
    const fund = await debitFund(ctx, input({ initialCents: 100_000n }));
    await recordValuation(ctx, fund.id, { on: "2026-09-30", cents: 110_000n });
    await addDeposit(ctx, fund.id, { on: "2026-10-15", chargedCents: 25_100n, feeCents: 100n, note: null });
    await runSnapshot(ctx, "2026-10-01");
    const view = await fundsExport(ctx, NOW);
    expect(view[0]).toMatchObject({ lastValuation: "2026-09-30", gainCents: 10_000n });
    // What went in after the value: the figure `paidInAfterValueCents` held before release N6.
    expect((await fundDetail(ctx, fund.id, NOW)).metrics.laterCents).toBe(25_100n);
  });

  it("leaves a PAC's value and date on the last reading in fundsView, not on an older copy (F5)", async () => {
    const fund = await debitFund(ctx, input({ initialCents: 100_000n }));
    const valuation = await recordValuation(ctx, fund.id, { on: "2026-09-30", cents: 110_000n });
    await runSnapshot(ctx, "2026-10-01");
    // The value is corrected after the copy was made: the copy still says the old one, a day later.
    await updateValuation(ctx, valuation.id, { on: "2026-09-30", cents: 120_000n });
    const view = await fundsExport(ctx, NOW);
    expect(view[0]).toMatchObject({
      lastValuation: "2026-09-30",
      valueCents: 120_000n,
      gainCents: 20_000n,
    });
  });

  it("projects a PAC on its plan, not on the average with the initial capital", async () => {
    const fund = await debitFund(ctx, input({ initialCents: 3_250_00n, monthlyCents: 251_00n }));
    const detail = await fundDetail(ctx, fund.id, new Date("2026-03-01T12:00:00Z"));
    expect(detail.forecast.monthlyCents).toBe(251_00n);
  });
});

// ——— Release N6: one model of fund ————————————————————————————————————————————————————————————

/** A fund with nothing but its name and its start: what the form hands over when every step is skipped. */
const bare = (name = "Fondo Alfa", startOn = "2026-01-01") => ({
  fund: { name, provider: "Esempio Previdenza", startOn },
  sources: [],
  fees: [],
});

/** A debit of 100,00 € that names the fund, every `count` `unit`. */
const debit = (overrides: Record<string, unknown> = {}) => ({
  kind: "bank_debit" as const,
  amountCents: 10_000n,
  frequency: { count: 1, unit: "month" as const },
  debitDay: 5,
  payeeMatch: "fondo alfa",
  ...overrides,
});

const at = (day: string) => new Date(`${day}T12:00:00Z`);

describe("a fund with no source and no fee (release N6)", () => {
  it("writes no source and no fee, has no due date, and reads what is written by hand", async () => {
    const fund = await createFund(ctx, bare());
    expect(
      await getDb().select().from(fundContributionSources).where(eq(fundContributionSources.fundId, fund.id)),
    ).toEqual([]);
    expect(await getDb().select().from(fundFees).where(eq(fundFees.fundId, fund.id))).toEqual([]);

    await addContribution(ctx, fund.id, {
      kind: "voluntary",
      on: "2026-02-05",
      amountCents: 10_000n,
      feeCents: 100n,
    });
    await recordValuation(ctx, fund.id, { on: "2026-03-31", cents: 10_500n });

    const detail = await fundDetail(ctx, fund.id);
    expect(detail).toMatchObject({ sources: [], fees: [], payroll: null, debits: [], quarters: [] });
    expect(hasPayrollCalendar(detail)).toBe(false);
    expect(metricsOf(detail)).toEqual({
      paidInCents: 10_000n,
      feesCents: 100n,
      investedCents: 9_900n,
      valueCents: 10_500n,
      gainCents: 500n,
    });

    const row = await fundHomeRow(ctx, fund.id);
    expect(row).toMatchObject({ month: { kind: "none" }, onTheWayCents: 0n, onTheWay: [] });
    expect(row.home.points).toEqual([{ on: "2026-03-31", cents: 10_500n }]);
    expect(row.home.flows).toEqual([
      expect.objectContaining({ on: "2026-02-05", chargedCents: 10_000n, feeCents: 100n, recurring: false }),
    ]);
    const todayOn = today(ctx.timeZone);
    const { summary } = fundSummary({ fund: row.home, period: allPeriod(todayOn), todayOn });
    expect(summary).toMatchObject({
      state: "measured",
      paidInCents: 10_000n,
      valueCents: 10_500n,
      gainCents: 500n,
      feesCents: 100n,
    });
  });
});

describe("the debits found among the movements, run twice (release N6)", () => {
  it("writes one operation per movement, however many times matchDebits and the job run", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    const charge = (on: string) =>
      movement({ payee: "FONDO ALFA SDD", amountCents: -10_000n, occurredAt: new Date(`${on}T10:00:00Z`) });
    const fund = await createFund(ctx, { ...bare(), sources: [debit({ accountId: bank })] });
    const [source] = await sourcesOf(ctx, [fund.id]);

    await upsertFromProvider(ctx, bank, [charge("2026-02-05"), charge("2026-03-05")], {
      provider: WALLET_PROVIDER,
    });
    expect(await matchDebits(ctx)).toEqual({ written: 2 });
    expect(await matchDebits(ctx)).toEqual({ written: 0 });
    expect(await matchDebits(ctx, [fund.id])).toEqual({ written: 0 });

    await upsertFromProvider(ctx, bank, [charge("2026-04-05")], { provider: WALLET_PROVIDER });
    expect(await fundsDepositsJob.run()).toMatchObject({ failed: 0, depositsWritten: 1 });
    expect(await fundsDepositsJob.run()).toMatchObject({ failed: 0, depositsWritten: 0 });

    const { operations } = await fundDetail(ctx, fund.id);
    expect(
      operations.map((row) => [row.operationDate, row.classification, row.source, row.sourceId]),
    ).toEqual([
      ["2026-02-05", "voluntary", "rule", source.id],
      ["2026-03-05", "voluntary", "rule", source.id],
      ["2026-04-05", "voluntary", "rule", source.id],
    ]);
    expect(new Set(operations.map((row) => row.transactionId)).size).toBe(3);
  });
});

describe("a debit every N weeks, months or years, with a start and an end (owner's decision 7)", () => {
  /** The state of the fund's first debit on a day. */
  const statusOn = async (fundId: string, day: string) =>
    (await fundDetail(ctx, fundId, at(day))).debits[0].status;
  const paid = (fundId: string, on: string) =>
    addContribution(ctx, fundId, { kind: "voluntary", on, amountCents: 10_000n, feeCents: 0n });

  it("only takes the movements inside the plan's dates", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    await upsertFromProvider(
      ctx,
      bank,
      ["2026-02-05", "2026-03-01", "2026-04-05", "2026-05-31", "2026-06-01"].map((on) =>
        movement({ payee: "Fondo Alfa", amountCents: -10_000n, occurredAt: new Date(`${on}T10:00:00Z`) }),
      ),
      { provider: WALLET_PROVIDER },
    );
    const fund = await createFund(ctx, {
      ...bare(),
      sources: [debit({ accountId: bank, validFrom: "2026-03-01", validTo: "2026-05-31" })],
    });
    expect(await matchDebits(ctx)).toEqual({ written: 0 });
    expect((await fundDetail(ctx, fund.id)).operations.map((row) => row.operationDate)).toEqual([
      "2026-03-01",
      "2026-04-05",
      "2026-05-31",
    ]);
  });

  it("every month on day 5: awaited, missing after the grace days, found in the month", async () => {
    const fund = await createFund(ctx, { ...bare(), sources: [debit()] });
    await paid(fund.id, "2026-05-05");
    // May's debit says nothing about June.
    expect(await statusOn(fund.id, "2026-06-03")).toEqual({ kind: "awaited" });
    expect(await statusOn(fund.id, "2026-06-08")).toEqual({ kind: "awaited" });
    expect(await statusOn(fund.id, "2026-06-09")).toEqual({ kind: "missing", by: "2026-06-08" });
    await paid(fund.id, "2026-06-12");
    expect(await statusOn(fund.id, "2026-06-20")).toEqual({ kind: "found", on: "2026-06-12" });
    expect(await statusOn(fund.id, "2026-05-31")).toEqual({ kind: "found", on: "2026-05-05" });
  });

  it("every 3 months: one debit covers the three months it falls in", async () => {
    const fund = await createFund(ctx, {
      ...bare(),
      sources: [debit({ frequency: { count: 3, unit: "month" }, validFrom: "2026-01-01" })],
    });
    await paid(fund.id, "2026-04-05");
    // April, May and June are one period: nothing is missing in May or June.
    expect(await statusOn(fund.id, "2026-05-20")).toEqual({ kind: "found", on: "2026-04-05" });
    expect(await statusOn(fund.id, "2026-06-30")).toEqual({ kind: "found", on: "2026-04-05" });
    // July opens the next one: expected on the 5th of its first month.
    expect(await statusOn(fund.id, "2026-07-03")).toEqual({ kind: "awaited" });
    expect(await statusOn(fund.id, "2026-08-20")).toEqual({ kind: "missing", by: "2026-07-08" });
  });

  it("every year: the year runs from the month of the start", async () => {
    const fund = await createFund(ctx, {
      ...bare("Fondo Alfa", "2025-03-01"),
      sources: [debit({ frequency: { count: 1, unit: "year" }, debitDay: 15, validFrom: "2025-03-01" })],
    });
    await paid(fund.id, "2025-03-15");
    // February 2026 is still the year that started in March 2025.
    expect(await statusOn(fund.id, "2026-02-20")).toEqual({ kind: "found", on: "2025-03-15" });
    expect(await statusOn(fund.id, "2026-03-10")).toEqual({ kind: "awaited" });
    expect(await statusOn(fund.id, "2026-04-01")).toEqual({ kind: "missing", by: "2026-03-18" });
    await paid(fund.id, "2026-03-16");
    expect(await statusOn(fund.id, "2026-11-01")).toEqual({ kind: "found", on: "2026-03-16" });
  });

  it("every 2 weeks: the fortnights run from the start day", async () => {
    const fund = await createFund(ctx, {
      ...bare(),
      sources: [debit({ frequency: { count: 2, unit: "week" }, debitDay: null, validFrom: "2026-06-01" })],
    });
    await paid(fund.id, "2026-06-02");
    // 1–14 June, 15–28 June, 29 June–12 July.
    expect(await statusOn(fund.id, "2026-06-14")).toEqual({ kind: "found", on: "2026-06-02" });
    expect(await statusOn(fund.id, "2026-06-16")).toEqual({ kind: "awaited" });
    expect(await statusOn(fund.id, "2026-06-19")).toEqual({ kind: "missing", by: "2026-06-18" });
    await paid(fund.id, "2026-06-20");
    expect(await statusOn(fund.id, "2026-06-22")).toEqual({ kind: "found", on: "2026-06-20" });
    expect(await statusOn(fund.id, "2026-06-30")).toEqual({ kind: "awaited" });
  });

  it("a plan that ended expects nothing after its last day", async () => {
    const fund = await createFund(ctx, {
      ...bare(),
      sources: [debit({ validFrom: "2026-01-01", validTo: "2026-05-31" })],
    });
    expect(await statusOn(fund.id, "2026-05-20")).toEqual({ kind: "missing", by: "2026-05-08" });
    expect(await statusOn(fund.id, "2026-06-01")).toEqual({ kind: "none" });
    expect(await statusOn(fund.id, "2026-09-20")).toEqual({ kind: "none" });
  });
});

describe("an operation that is not a contribution (owner's decision 4)", () => {
  const month = (number: string, last: string) => ({
    from: `2026-${number}-01`,
    to: `2026-${number}-${last}`,
  });
  const other = (
    fundId: string,
    classification: "transfer_in" | "switch" | "withdrawal",
    on: string,
    amountCents: bigint,
    feeCents = 0n,
  ) => addContribution(ctx, fundId, { kind: "other", classification, on, amountCents, feeCents });
  /** The fund's page over a period, on a day after everything written here. */
  const measured = async (fundId: string, period: { from: string | null; to: string }) => {
    const row = await fundHomeRow(ctx, fundId, at("2026-05-15"));
    return fundSummary({ fund: row.home, period, todayOn: "2026-05-15" });
  };

  it("does not read a withdrawal as a loss, nor take it off the paid-in", async () => {
    const fund = await createFund(ctx, bare());
    await addContribution(ctx, fund.id, {
      kind: "voluntary",
      on: "2026-01-10",
      amountCents: 100_000n,
      feeCents: 0n,
    });
    await recordValuation(ctx, fund.id, { on: "2026-01-31", cents: 100_000n });
    const operation = await other(fund.id, "withdrawal", "2026-02-15", 20_000n);
    expect(operation).toMatchObject({
      classification: "withdrawal",
      source: "manual",
      otherCents: 20_000n,
      netCents: -20_000n,
    });
    await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 83_000n });

    // The value went from 1.000 to 830 with 200 taken out: the market gave 30, and nothing was lost.
    const february = await measured(fund.id, month("02", "28"));
    expect(february.summary).toMatchObject({ state: "measured", gainCents: 3_000n, paidInCents: 0n });
    expect(february.line.measure).toMatchObject({ flowsCents: -20_000n, marketCents: 3_000n });
    const all = await measured(fund.id, { from: null, to: "2026-05-15" });
    expect(all.summary).toMatchObject({ gainCents: 3_000n, paidInCents: 100_000n });
    expect((await fundDetail(ctx, fund.id)).metrics).toMatchObject({
      paidInCents: 100_000n,
      withdrawalsCents: 20_000n,
      gainCents: 3_000n,
    });
  });

  it("measures the gain against a transfer in, and a switch carries only its fee", async () => {
    const fund = await createFund(ctx, bare());
    await addContribution(ctx, fund.id, {
      kind: "voluntary",
      on: "2026-01-10",
      amountCents: 100_000n,
      feeCents: 0n,
    });
    await recordValuation(ctx, fund.id, { on: "2026-02-28", cents: 103_000n });
    await other(fund.id, "transfer_in", "2026-03-10", 50_000n);
    await recordValuation(ctx, fund.id, { on: "2026-03-31", cents: 154_000n });

    // 1.030 → 1.540 with 500 brought in from another fund: the gain is 10, not 510.
    const march = await measured(fund.id, month("03", "31"));
    expect(march.summary).toMatchObject({ state: "measured", gainCents: 1_000n, paidInCents: 50_000n });
    expect(march.summary.origin).toEqual({
      youCents: 0n,
      employerCents: 0n,
      tfrCents: 0n,
      otherCents: 50_000n,
    });
    expect((await fundDetail(ctx, fund.id)).metrics).toMatchObject({
      paidInCents: 100_000n,
      transfersInCents: 50_000n,
      gainCents: 4_000n,
    });

    await expect(other(fund.id, "switch", "2026-04-10", 1n, 1_000n)).rejects.toMatchObject({
      code: "invalid",
    });
    const moved = await other(fund.id, "switch", "2026-04-10", 0n, 1_000n);
    expect(moved).toMatchObject({
      classification: "switch",
      workerCents: 0n,
      otherCents: 0n,
      feesCents: 1_000n,
      netCents: -1_000n,
    });
    await recordValuation(ctx, fund.id, { on: "2026-04-30", cents: 153_500n });
    const row = await fundHomeRow(ctx, fund.id, at("2026-05-15"));
    expect(row.home.flows.find((flow) => flow.on === "2026-04-10")).toEqual({
      on: "2026-04-10",
      chargedCents: 0n,
      feeCents: 1_000n,
      origin: { youCents: 0n, employerCents: 0n, tfrCents: 0n, otherCents: 0n },
      recurring: false,
    });
    // No money moved in April: the value fell by 5, of which 10 are the switch's cost.
    const april = await measured(fund.id, month("04", "30"));
    expect(april.summary).toMatchObject({
      gainCents: -500n,
      feesCents: 1_000n,
      marketCents: 500n,
      paidInCents: 0n,
    });
    expect(april.line.measure.flowsCents).toBe(0n);
  });
});

describe("the sources of a fund (release N6)", () => {
  it("pauses and resumes a debit: paused, it finds nothing", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    const fund = await createFund(ctx, { ...bare(), sources: [debit({ accountId: bank })] });
    const [source] = await sourcesOf(ctx, [fund.id]);
    await setSourceState(ctx, source.id, "paused");
    await upsertFromProvider(
      ctx,
      bank,
      [
        movement({
          payee: "Fondo Alfa",
          amountCents: -10_000n,
          occurredAt: new Date("2026-02-05T10:00:00Z"),
        }),
      ],
      { provider: WALLET_PROVIDER },
    );
    expect(await matchDebits(ctx)).toEqual({ written: 0 });
    const paused = await fundDetail(ctx, fund.id, at("2026-02-20"));
    expect(paused.debits[0]).toMatchObject({ source: { state: "paused" }, status: { kind: "none" } });
    expect(paused.operations).toEqual([]);

    // Resuming is what brings the debit in.
    await setSourceState(ctx, source.id, "active");
    const resumed = await fundDetail(ctx, fund.id, at("2026-02-20"));
    expect(resumed.debits[0]).toMatchObject({
      source: { id: source.id, state: "active" },
      status: { kind: "found", on: "2026-02-05" },
    });
    expect(resumed.operations.map((row) => [row.operationDate, row.sourceId])).toEqual([
      ["2026-02-05", source.id],
    ]);
  });

  it("does not remove a source with contributions, removes one without, and restores it as it was", async () => {
    const bank = await anAccount(ctx, "ING Conto Arancio");
    await upsertFromProvider(
      ctx,
      bank,
      [
        movement({
          payee: "Fondo Alfa",
          amountCents: -10_000n,
          occurredAt: new Date("2026-02-05T10:00:00Z"),
        }),
      ],
      { provider: WALLET_PROVIDER },
    );
    const fund = await createFund(ctx, { ...bare(), sources: [debit({ accountId: bank })] });
    const [used] = await sourcesOf(ctx, [fund.id]);
    expect((await fundDetail(ctx, fund.id)).sourceContributions.get(used.id)).toBe(1);
    await expect(removeSource(ctx, used.id)).rejects.toMatchObject({ code: "has_contributions" });
    expect((await sourcesOf(ctx, [fund.id])).map((one) => one.id)).toEqual([used.id]);

    const unused = await addSource(
      ctx,
      fund.id,
      debit({
        payeeMatch: "nessun movimento",
        frequency: { count: 2, unit: "week" },
        validFrom: "2026-03-02",
      }),
    );
    const own = await addFee(ctx, fund.id, {
      label: "Per debit",
      basis: "per_contribution",
      amountCents: 150n,
      sourceId: unused.id,
    });
    const general = await addFee(ctx, fund.id, {
      label: "Management",
      basis: "on_assets",
      rate: "0.012",
      period: "year",
    });
    const removed = await removeSource(ctx, unused.id);
    expect(removed.source.id).toBe(unused.id);
    expect(removed.fees.map((fee) => fee.id)).toEqual([own.id]);
    expect((await sourcesOf(ctx, [fund.id])).map((one) => one.id)).toEqual([used.id]);
    // Its own fee went with it; the fund's other fee stayed.
    expect((await feesOf(ctx, [fund.id])).map((fee) => fee.id)).toEqual([general.id]);

    await restoreSource(ctx, fund.id, {
      source: {
        id: removed.source.id,
        state: removed.source.state,
        kind: "bank_debit",
        amountCents: removed.source.amountCents!,
        frequency: { count: removed.source.intervalCount!, unit: removed.source.intervalUnit! },
        debitDay: removed.source.debitDay,
        accountId: removed.source.accountId,
        payeeMatch: removed.source.payeeMatch!,
        validFrom: removed.source.validFrom,
        validTo: removed.source.validTo,
      },
      fees: removed.fees.map((fee) => ({
        id: fee.id,
        label: fee.label,
        basis: fee.basis,
        amountCents: fee.amountCents,
        rate: fee.rate,
        period: fee.period,
        component: fee.component,
        validFrom: fee.validFrom,
        validTo: fee.validTo,
        note: fee.note,
      })),
    });
    const restored = (await sourcesOf(ctx, [fund.id])).find((one) => one.id === unused.id);
    expect(restored).toMatchObject({
      id: unused.id,
      kind: "bank_debit",
      state: "active",
      payeeMatch: "nessun movimento",
      amountCents: 10_000n,
      intervalCount: 2,
      intervalUnit: "week",
      validFrom: "2026-03-02",
    });
    expect((await feesOf(ctx, [fund.id])).find((fee) => fee.id === own.id)).toMatchObject({
      id: own.id,
      label: "Per debit",
      basis: "per_contribution",
      amountCents: 150n,
      sourceId: unused.id,
    });
  });
});

describe("the fees of a fund (release N6)", () => {
  it("adds, corrects and removes a fee", async () => {
    const fund = await createFund(ctx, bare());
    const fee = await addFee(ctx, fund.id, {
      label: "Management",
      basis: "on_assets",
      rate: "0.012",
      period: "year",
    });
    expect(fee).toMatchObject({ basis: "on_assets", rate: "0.012000", period: "year", sourceId: null });
    const corrected = await updateFee(ctx, fee.id, {
      label: "Management, from 2026",
      basis: "on_assets",
      rate: "0.015",
      period: "year",
      validFrom: "2026-01-01",
    });
    expect(corrected).toMatchObject({
      id: fee.id,
      label: "Management, from 2026",
      rate: "0.015000",
      validFrom: "2026-01-01",
    });
    expect((await fundDetail(ctx, fund.id)).fees.map((one) => [one.id, one.rate])).toEqual([
      [fee.id, "0.015000"],
    ]);
    expect((await removeFee(ctx, fee.id)).id).toBe(fee.id);
    expect(await feesOf(ctx, [fund.id])).toEqual([]);
    await expect(removeFee(ctx, fee.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("takes a component only on a payslip source, a source only of its own fund, and no scope on assets", async () => {
    const fund = await createFund(ctx, {
      ...bare(),
      sources: [debit(), { kind: "payroll", components: ["worker", "employer"], accrualPeriod: "quarter" }],
    });
    const sources = await sourcesOf(ctx, [fund.id]);
    const debitSource = sources.find((one) => one.kind === "bank_debit")!;
    const payslip = sources.find((one) => one.kind === "payroll")!;
    const elsewhere = await createFund(ctx, { ...bare("Fondo Beta"), sources: [debit()] });
    const [foreign] = await sourcesOf(ctx, [elsewhere.id]);
    const perContribution = { label: "Entry", basis: "per_contribution" as const, amountCents: 100n };

    await expect(
      addFee(ctx, fund.id, { ...perContribution, component: "worker", sourceId: debitSource.id }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(addFee(ctx, fund.id, { ...perContribution, component: "worker" })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(addFee(ctx, fund.id, { ...perContribution, sourceId: foreign.id })).rejects.toMatchObject({
      code: "not_found",
    });
    const onAssets = {
      label: "Management",
      basis: "on_assets" as const,
      rate: "0.012",
      period: "year" as const,
    };
    await expect(addFee(ctx, fund.id, { ...onAssets, sourceId: payslip.id })).rejects.toMatchObject({
      code: "invalid",
    });
    // A fee on assets is a percentage, never an amount.
    await expect(
      addFee(ctx, fund.id, { label: "Management", basis: "on_assets", amountCents: 100n, period: "year" }),
    ).rejects.toThrow();
    expect(await feesOf(ctx, [fund.id])).toEqual([]);

    const scoped = await addFee(ctx, fund.id, {
      ...perContribution,
      component: "employer",
      sourceId: payslip.id,
    });
    expect(scoped).toMatchObject({ component: "employer", sourceId: payslip.id });
    // A correction is held to the same scope.
    await expect(
      updateFee(ctx, scoped.id, { ...perContribution, component: "employer", sourceId: debitSource.id }),
    ).rejects.toMatchObject({ code: "invalid" });
    // The same at creation: a fee names a source of the same input by its place in the list.
    await expect(
      createFund(ctx, {
        ...bare("Fondo Alfa bis"),
        sources: [debit()],
        fees: [{ ...perContribution, component: "worker", sourceIndex: 0 }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      createFund(ctx, {
        ...bare("Fondo Alfa bis"),
        sources: [debit()],
        fees: [{ ...onAssets, sourceIndex: 0 }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
