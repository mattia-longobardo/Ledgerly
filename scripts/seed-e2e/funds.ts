// scripts/seed-e2e/funds.ts — the users and the data of the flow `funds` (tests/e2e/funds/).
import { randomUUID } from "node:crypto";
import { pensionCompetences } from "@domain/modules/funds/schema";
import { createFund, recordValuation, setFundState } from "@domain/modules/funds/service";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { getPreferences, updatePreferences } from "@domain/modules/users/service";
import { addDays, addMonths, monthKey, today } from "@domain/shared/dates";
import { getDb } from "@domain/platform/db/client";
import { userScoped } from "@domain/platform/db/scope";
import {
  addDeposit,
  addVoluntaryContribution,
  debitFund,
  importedOperation,
  payrollFund,
  saveDepositRule,
} from "../../test/funds";
import { USERS } from "../../tests/e2e/_shared/env";
import { contextOf, syncedAccount, walletMovement } from "./common";

/**
 * Funds (F4): a synced current account with two Fideuram direct debits of 251,00 €, on the 5th of
 * the two months before this one, for the deposit rule to turn into deposits.
 */
export async function seedFunds(): Promise<void> {
  const ctx = await contextOf(USERS.funds.email);
  const accountId = await syncedAccount(ctx, "e2e-fund-1", "ING Conto Arancio");
  const thisMonth = monthKey(today(ctx.timeZone));
  await upsertFromProvider(ctx, accountId, [
    walletMovement(
      "e2e-fund-tx-1",
      `${addMonths(thisMonth, -2).slice(0, 7)}-05`,
      -25100n,
      "FIDEURAM PAC SDD",
      "Investimenti",
    ),
    walletMovement(
      "e2e-fund-tx-2",
      `${addMonths(thisMonth, -1).slice(0, 7)}-05`,
      -25100n,
      "FIDEURAM PAC SDD",
      "Investimenti",
    ),
  ]);
}

/**
 * The new Funds home (docs/design/funds-ux.md §6): the years, counted back from this one, each in a
 * state of the table. Y−4: payslips alone. Y−3: measured, with an archived fund. Y−2: money and no
 * value. Y−1: nothing. Y: one fund with a debit plan measured, a pension fund with an old value, a
 * fund with a debit plan and no value.
 * Every amount is invented.
 */
export async function seedFundsHome(): Promise<void> {
  const ctx = await contextOf(USERS.fundsHome.email);
  const on = today(ctx.timeZone);
  const year = Number(on.slice(0, 4));

  const beta = await debitFund(ctx, {
    name: "Piano Beta",
    provider: "Esempio",
    startOn: `${year - 3}-01-10`,
  });
  for (const [day, chargedCents, feeCents] of [
    [`${year - 3}-01-10`, 100_000n, 100n],
    [`${year - 3}-07-10`, 100_000n, 100n],
    [`${year - 2}-05-10`, 50_000n, 50n],
    [`${year}-01-01`, 30_000n, 30n],
  ] as const) {
    await addDeposit(ctx, beta.id, { on: day, chargedCents, feeCents, note: null });
  }
  for (const [day, cents] of [
    [`${year - 3}-02-28`, 101_000n],
    // The 1st of January closes the year before (decision 3 of §9): this one is Y−3's last value.
    [`${year - 2}-01-01`, 210_000n],
    [on, 330_000n],
  ] as const) {
    await recordValuation(ctx, beta.id, { on: day, cents, units: null, note: null });
  }

  // Its payslip source is paused: the rows below are its own, and it takes no payslip of anybody.
  const pension = await payrollFund(ctx, {
    name: "Pensione Alfa",
    provider: "Esempio",
    compartment: "Crescita",
    startOn: `${year - 4}-10-01`,
    receivesPayroll: false,
  });
  // Payslips of Y−4, and of the quarter running: the second is what "On the way" reports.
  const quarter = Math.floor((Number(on.slice(5, 7)) - 1) / 3) + 1;
  for (const [competenceYear, competenceQuarter, period] of [
    [year - 4, 4, `${year - 4}-11-01`],
    [year, quarter, `${on.slice(0, 7)}-01`],
  ] as const) {
    await getDb()
      .insert(pensionCompetences)
      .values(
        userScoped(ctx).stamp({
          fundId: pension.id,
          payslipId: randomUUID(),
          payrollPeriod: period,
          payslipType: "ordinary",
          year: competenceYear,
          quarter: competenceQuarter,
          workerCents: 15_000n,
          employerCents: 20_000n,
          tfrCents: 30_000n,
        }),
      );
  }
  await recordValuation(ctx, pension.id, {
    on: `${year - 3}-06-30`,
    cents: 66_000n,
    units: null,
    note: null,
  });

  const gamma = await debitFund(ctx, {
    name: "Piano Gamma",
    provider: "Esempio",
    startOn: `${year - 3}-03-10`,
  });
  await addDeposit(ctx, gamma.id, {
    on: `${year - 3}-03-10`,
    chargedCents: 40_000n,
    feeCents: 0n,
    note: null,
  });
  await recordValuation(ctx, gamma.id, { on: `${year - 3}-09-30`, cents: 41_000n, units: null, note: null });
  await setFundState(ctx, gamma.id, "archived");

  const delta = await debitFund(ctx, {
    name: "Piano Delta",
    provider: "Esempio",
    startOn: `${year}-01-01`,
  });
  // A fee nobody knows, and a debit with no fee set: what the Contributions tab has to say out loud.
  await addDeposit(ctx, delta.id, { on: `${year}-01-01`, chargedCents: 20_000n, feeCents: null, note: null });
  await saveDepositRule(ctx, delta.id, { payeeMatch: "Delta", accountId: null, active: true });
}

/**
 * A fund's new page (docs/design/funds-ux.md §6, F3): two funds over three years, counted back from this
 * one. One fund has a debit plan, the other is fed by the payslip: operations with their units and a quarter on the way.
 * Every amount is invented.
 */
export async function seedFundsDetail(email: string): Promise<void> {
  const ctx = await contextOf(email);
  const on = today(ctx.timeZone);
  const year = Number(on.slice(0, 4));
  const thisMonth = `${on.slice(0, 7)}-01`;

  const pac = await debitFund(ctx, {
    name: "Piano Uno",
    provider: "Esempio",
    debitDay: 1,
    startOn: `${year - 2}-01-05`,
    monthlyCents: 25_000n,
    depositFeeCents: 100n,
  });
  for (const [day, chargedCents] of [
    [`${year - 2}-01-05`, 100_000n],
    [`${year - 1}-03-05`, 50_000n],
    // This month's: so the plan's status does not depend on the day of the run.
    [thisMonth, 25_000n],
  ] as const) {
    await addDeposit(ctx, pac.id, { on: day, chargedCents, feeCents: 100n, note: null });
  }
  for (const [day, cents] of [
    [`${year - 2}-06-30`, 104_000n],
    [`${year - 1}-12-15`, 160_000n],
    [on, 190_000n],
  ] as const) {
    await recordValuation(ctx, pac.id, { on: day, cents, units: null, note: null });
  }

  const pension = await payrollFund(ctx, {
    name: "Pensione Beta",
    provider: "Esempio",
    compartment: "Crescita",
    startOn: `${year - 2}-01-01`,
    receivesPayroll: false,
  });
  const contributions = [
    [year - 2, 1, `${year - 2}-04-15`, "10.000000"],
    [year - 1, 1, `${year - 1}-04-15`, "11.000000"],
    [year - 1, 2, `${year - 1}-07-15`, "12.000000"],
    [year - 1, 4, `${year}-01-02`, "12.500000"],
  ] as const;
  for (const [competenceYear, competenceQuarter, operationDate, unitPrice] of contributions) {
    // What a document left before release N6: the app reads these rows, and writes none.
    await importedOperation(ctx, pension.id, {
      originKey: `e2e:${operationDate}`,
      originalType: "Contributo",
      classification: "contribution",
      originalState: "QUOTATO",
      competenceYear,
      competenceQuarter,
      operationDate,
      workerCents: 10_000n,
      employerCents: 15_000n,
      tfrCents: 35_000n,
      feesCents: 300n,
      netCents: 59_700n,
      movements: [{ compartment: "Crescita", units: "50.000000", unitPrice, unitPriceDate: operationDate }],
    });
  }
  for (const [day, cents] of [
    [`${year - 2}-06-30`, 62_000n],
    [`${year - 1}-08-31`, 190_000n],
    [on, 260_000n],
  ] as const) {
    await recordValuation(ctx, pension.id, { on: day, cents, units: null, note: null });
  }
  const quarter = Math.floor((Number(on.slice(5, 7)) - 1) / 3) + 1;
  // This month's payslip, and two of last year: the Contributions tab filters them by period.
  for (const [payrollPeriod, competenceYear, competenceQuarter] of [
    [thisMonth, year, quarter],
    [`${year - 1}-01-01`, year - 1, 1],
    [`${year - 1}-02-01`, year - 1, 1],
  ] as const) {
    await getDb()
      .insert(pensionCompetences)
      .values(
        userScoped(ctx).stamp({
          fundId: pension.id,
          payslipId: randomUUID(),
          payrollPeriod,
          payslipType: "ordinary",
          year: competenceYear,
          quarter: competenceQuarter,
          workerCents: 12_000n,
          employerCents: 18_000n,
          tfrCents: 30_000n,
        }),
      );
  }
  // A payment by hand, so the tab has its "Remove" at both widths. Two years ago: last year's figures stay.
  await addVoluntaryContribution(ctx, pension.id, {
    on: `${year - 2}-05-10`,
    amountCents: 5_000n,
    feesCents: 0n,
    transactionId: null,
    note: null,
  });
}

/** The same funds, read in Italian (funds-ux §6): the words of the new pages are checked in both languages. */
export async function seedFundsCopy(): Promise<void> {
  await seedFundsDetail(USERS.fundsCopy.email);
  const ctx = await contextOf(USERS.fundsCopy.email);
  await updatePreferences(ctx, { ...(await getPreferences(ctx)), locale: "it" });
}

/** The form "Add pension fund" (release N6): an open account for the debit to name, and no fund. */
export async function seedFundsNew(): Promise<void> {
  const ctx = await contextOf(USERS.fundsNew.email);
  await syncedAccount(ctx, "e2e-new-1", "ING Conto Arancio");
}

/**
 * The funds the form, the sources and the fees are driven on (release N6,
 * docs/design/rewrite-plan/ux/n6-pension-fund.md §16.3). One fund per journey, so a journey that
 * adds or removes something changes nothing another one reads. Every amount is invented.
 */
export async function seedFundsSetup(): Promise<void> {
  const ctx = await contextOf(USERS.fundsSetup.email);
  const on = today(ctx.timeZone);
  const year = Number(on.slice(0, 4));
  // An open account, for "Paying account" to offer something besides "Any account".
  await syncedAccount(ctx, "e2e-setup-1", "ING Conto Arancio");

  // The one fund the payslip feeds: its three components are taken for every other fund. The three
  // payslips of last year's first quarter accrued 360,00 + 540,00 + 900,00 €, with no enrolment quota,
  // and the fund has said nothing yet: a contribution written by hand is what reconciles the quarter.
  const fed = await payrollFund(ctx, {
    name: "Fondo Busta",
    provider: "Esempio",
    startOn: `${year - 1}-01-01`,
    receivesPayroll: true,
  });
  for (const month of ["01", "02", "03"]) {
    await getDb()
      .insert(pensionCompetences)
      .values(
        userScoped(ctx).stamp({
          fundId: fed.id,
          payslipId: randomUUID(),
          payrollPeriod: `${year - 1}-${month}-01`,
          payslipType: "ordinary",
          year: year - 1,
          quarter: 1,
          workerCents: 12_000n,
          employerCents: 18_000n,
          tfrCents: 30_000n,
        }),
      );
  }

  // No source, no fee, no contribution and no value: every empty state of §10.4 and §10.5.
  await createFund(ctx, {
    fund: { name: "Fondo Vuoto", provider: "Esempio", startOn: `${year - 1}-03-01` },
    currency: "EUR",
    sources: [],
    fees: [],
  });

  // No source yet: the journey of Settings › Contributions adds them.
  await createFund(ctx, {
    fund: { name: "Fondo Sorgenti", provider: "Esempio", startOn: `${year - 1}-03-01` },
    currency: "EUR",
    sources: [],
    fees: [],
  });

  // The same, for the journey that pauses and removes a source.
  await createFund(ctx, {
    fund: { name: "Fondo Pausa", provider: "Esempio", startOn: `${year - 1}-03-01` },
    currency: "EUR",
    sources: [],
    fees: [],
  });

  // No fee yet, and a value: 0,45 % a year of 9.000,00 € is the 40,50 € of the estimate.
  await createFund(ctx, {
    fund: { name: "Fondo Costi", provider: "Esempio", startOn: `${year - 1}-03-01` },
    currency: "EUR",
    value: { on, cents: 900_000n },
    sources: [],
    fees: [],
  });

  // Paid in 5.000,00 €, worth 5.600,00 € yesterday: the journey takes money out and writes the
  // value of today, lower by as much.
  const exit = await createFund(ctx, {
    fund: { name: "Fondo Uscita", provider: "Esempio", startOn: `${year - 1}-03-01` },
    currency: "EUR",
    sources: [{ kind: "manual" }],
    fees: [],
  });
  await addDeposit(ctx, exit.id, {
    on: `${year - 1}-03-01`,
    chargedCents: 500_000n,
    feeCents: 0n,
    note: null,
  });
  await recordValuation(ctx, exit.id, { on: addDays(on, -1), cents: 560_000n, units: null, note: null });
}
