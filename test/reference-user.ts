// test/reference-user.ts — the reference user of the rewrite plan's "same behaviour" proofs
// (docs/design/rewrite-plan/06-data.md §6.4, 10-modularity.md §10.10 B2 and B4).
//
// One person with something in every section, every date written out and none taken from the
// clock, so that what the read services, the REST API and the MCP tools answer about them at
// `REFERENCE_NOW` is the same on every run. `src/baselines.itest.ts` holds those answers to the files
// in `baselines/`. The year is 2031 because the payslip twins are of 2031.
//
// Adding data here changes the reference files on purpose: do it in a commit of its own, never in
// the commit of a refactor.
import { createAccount, saveBalanceEntry } from "@/modules/accounts/service";
import { setLimit } from "@/modules/budgets/service";
import { addDeposit, createFund, recordValuation } from "@/modules/funds/service";
import { createRule } from "@/modules/interests/service";
import { updateServiceValue } from "@/modules/investments/service";
import { applyPayslip, processPayslip, uploadPayslip, verifyPayslip } from "@/modules/payroll/service";
import { addToPocket, createPocket } from "@/modules/pockets/service";
import { createSubscription } from "@/modules/subscriptions/service";
import { saveAllowance, saveLeaveDay } from "@/modules/timeoff/service";
import type { IncomingTransaction } from "@/modules/transactions/rules";
import { upsertFromProvider } from "@/modules/transactions/service";
import { listCategories } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { APRIL, MARCH } from "../tests/fixtures/payroll/samples";
import { twinPdf } from "../tests/fixtures/payroll/twin";
import { anAccount, movement } from "./fixtures";
import { accountMovement, manualService } from "./investments";

export const REFERENCE_NOW = new Date("2031-10-15T10:00:00Z");

export interface ReferenceUser {
  checkingId: string;
  savingsId: string;
  brokerId: string;
}

const MONTHS = ["06", "07", "08", "09", "10"];

/** A month of ordinary life on the current account; October stops at the 14th. */
function monthOf(month: string): IncomingTransaction[] {
  const at = (day: string) => new Date(`2031-${month}-${day}T09:00:00Z`);
  const one = (id: string, overrides: Partial<IncomingTransaction>) =>
    movement({ externalId: `ref-${month}-${id}`, ...overrides });
  const rows = [
    one("netflix", {
      occurredAt: at("03"),
      amountCents: -1_299n,
      payee: "Netflix",
      categoryName: "Streaming",
    }),
    one("spesa-1", { occurredAt: at("05"), amountCents: -8_420n }),
    one("treno", {
      occurredAt: at("08"),
      amountCents: -3_650n,
      payee: "Trenitalia",
      categoryName: "Transport",
    }),
    one("spesa-2", { occurredAt: at("12"), amountCents: -6_175n }),
    one("cena", {
      occurredAt: at("13"),
      amountCents: -4_800n,
      payee: "Trattoria",
      categoryName: "Restaurants",
    }),
  ];
  if (month === "10") return rows;
  return [
    ...rows,
    one("spesa-3", { occurredAt: at("21"), amountCents: -9_310n }),
    one("stipendio", {
      occurredAt: at("27"),
      amountCents: 245_000n,
      type: "income",
      payee: "ACME S.p.A.",
      categoryName: "Salary",
    }),
  ];
}

/**
 * `setClock` moves the stopped clock: a manual investment service counts the money that went in
 * from the day it was created, so the broker is created in March and read in October.
 */
export async function seedReferenceUser(ctx: Ctx, setClock: (instant: Date) => void): Promise<ReferenceUser> {
  const checkingId = await anAccount(ctx);
  const savings = await createAccount(ctx, {
    name: "Revolut Saving",
    type: "savings",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });

  const balances: [string, bigint, bigint][] = [
    ["2031-05-31", 310_000n, 1_000_000n],
    ["2031-06-30", 521_146n, 1_050_000n],
    ["2031-07-31", 732_292n, 1_100_000n],
    ["2031-08-31", 943_438n, 1_150_000n],
    ["2031-09-30", 1_154_584n, 1_200_000n],
    ["2031-10-14", 1_130_240n, 1_200_000n],
  ];
  for (const [on, checking, saved] of balances) {
    await saveBalanceEntry(ctx, checkingId, { on, cents: checking });
    await saveBalanceEntry(ctx, savings.id, { on, cents: saved });
  }

  await upsertFromProvider(ctx, checkingId, MONTHS.flatMap(monthOf), { now: REFERENCE_NOW });
  const categoryId = async (name: string) =>
    (await listCategories(ctx)).find((category) => category.name === name)!.id;
  for (const month of ["2031-09-01", "2031-10-01"]) {
    await setLimit(ctx, {
      categoryId: await categoryId("Groceries"),
      accountId: null,
      month,
      cents: 30_000n,
    });
    await setLimit(ctx, {
      categoryId: await categoryId("Restaurants"),
      accountId: null,
      month,
      cents: 4_000n,
    });
  }

  await createSubscription(ctx, {
    name: "Netflix",
    categoryId: null,
    utility: 7,
    priceCents: 1_299n,
    cycle: "monthly",
    nextChargeOn: "2031-11-03",
    paymentAccountId: checkingId,
    payeeMatch: "netflix",
    tolerance: "0.05",
  });

  const pocket = await createPocket(ctx, {
    name: "Holidays",
    color: null,
    backingAccountId: savings.id,
    targetCents: 400_000n,
    monthlyCents: 25_000n,
    startMonth: "2031-07-01",
  });
  await addToPocket(ctx, pocket.id, { cents: 50_000n, on: "2031-08-10" });

  await createRule(ctx, {
    accountId: savings.id,
    taxRate: "0.26",
    dayBasis: "365",
    settlement: "monthly",
    validFrom: "2031-01-01",
    validTo: null,
    payeeMatch: "interessi",
    tiers: [{ upToCents: null, annualRate: "0.0365" }],
  });

  setClock(new Date("2031-03-01T10:00:00Z"));
  const { accountId: brokerId } = await manualService(ctx, {
    name: "Directa",
    category: "broker",
    currency: "EUR",
  });
  setClock(REFERENCE_NOW);
  await accountMovement(ctx, brokerId, "2031-03-03", 1_000_000n);
  await accountMovement(ctx, brokerId, "2031-07-01", 200_000n);
  await updateServiceValue(ctx, brokerId, { on: "2031-06-30", cents: 1_030_000n });
  await updateServiceValue(ctx, brokerId, { on: "2031-10-14", cents: 1_265_000n });

  const fund = await createFund(ctx, {
    name: "Fideuram Piano Accumulo",
    provider: "Fideuram",
    isin: "LU0987654321",
    compartment: "Bilanciato",
    debitAccountId: null,
    debitDay: 5,
    ter: "0.012",
    startOn: "2030-11-01",
    monthlyCents: 25_100n,
    depositFeeCents: 100n,
    valuationAccountId: null,
    initialCents: 500_000n,
  });
  for (const on of [
    "2030-12-05",
    ...["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((m) => `2031-${m}-05`),
  ]) {
    await addDeposit(ctx, fund.id, { on, chargedCents: 25_100n, feeCents: 100n, note: null });
  }
  for (const [on, cents] of [
    ["2030-12-31", 528_000n],
    ["2031-03-31", 611_500n],
    ["2031-06-30", 702_300n],
    ["2031-09-30", 771_900n],
  ] as const) {
    await recordValuation(ctx, fund.id, { on, cents });
  }

  await saveAllowance(ctx, 2031, { vacationDays: 26, rolDays: 4 });
  for (const from of ["2031-08-11", "2031-08-12", "2031-08-13"]) {
    await saveLeaveDay(ctx, { from, kind: "vacation", fraction: 1 });
  }
  await saveLeaveDay(ctx, { from: "2031-09-19", kind: "rol", fraction: 0.5 });

  return { checkingId, savingsId: savings.id, brokerId };
}

/** Two payslips through the whole pipeline. Needs the bucket, so it runs with the real clock. */
export async function seedReferencePayslips(ctx: Ctx): Promise<void> {
  for (const twin of [MARCH, APRIL]) {
    const { document } = await uploadPayslip(ctx, { name: `${twin.period}.pdf`, bytes: await twinPdf(twin) });
    await processPayslip(ctx, document.id);
    await verifyPayslip(ctx, document.id);
    await applyPayslip(ctx, document.id);
  }
}
