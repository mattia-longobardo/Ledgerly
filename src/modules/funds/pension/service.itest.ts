// The pension fund's schema, creation and payroll sink (plan F6 L0–L1), on the synthetic payslip
// twins, against the real test database and bucket.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccount } from "@/modules/accounts/queries";
import { appliedCompetences } from "@/modules/payroll/pension";
import {
  applyPayslip,
  codeMapOf,
  processPayslip,
  uploadPayslip,
  verifyPayslip,
} from "@/modules/payroll/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { hasPgError } from "@/platform/db/errors";
import { deleteFolder, ensureBucket } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { newContext } from "../../../../test/fixtures";
import { MARCH, MARCH_REPRINT, THIRTEENTH } from "../../../../tests/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../../tests/fixtures/payroll/twin";
import { fundFeeTariffs, funds, pensionCompetences } from "../schema";
import { createFund, FundError } from "../service";
import { COMETA_SCHEDULE } from "./rules";
import {
  addContributionRule,
  competencesOf,
  createPensionFund,
  feeTariffs,
  payrollFund,
  pensionRulesOf,
  replaceCompetences,
  requirePensionFund,
  saveTolerance,
  setReceivesPayroll,
} from "./service";

let ctx: Ctx;

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
});
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

const cometa = (overrides: Record<string, unknown> = {}) => ({
  name: "Cometa",
  provider: "Cometa",
  compartment: "Crescita",
  startOn: "2031-01-01",
  ...overrides,
});

async function applied(twin: TwinPayslip, who: Ctx = ctx) {
  const { document } = await uploadPayslip(who, { name: `${twin.period}.pdf`, bytes: await twinPdf(twin) });
  await processPayslip(who, document.id);
  await verifyPayslip(who, document.id);
  return applyPayslip(who, document.id);
}

describe("a pension fund (plan F6 L0)", () => {
  it("lives on a pension account outside cash, with the Cometa schedule and the tariff seeded", async () => {
    const fund = await createPensionFund(ctx, cometa());
    expect(fund).toMatchObject({ type: "pension", receivesPayroll: true, compartment: "Crescita" });
    const account = await getAccount(ctx, fund.valuationAccountId);
    expect(account).toMatchObject({ type: "pension", countsAsLiquid: false, inNetWorth: true });
    const [rule] = await pensionRulesOf(ctx, fund.id);
    expect(rule).toMatchObject({ kind: "payment_schedule", toleranceDays: 15, schedule: COMETA_SCHEDULE });
    const tariffs = await feeTariffs();
    expect(tariffs.find((row) => row.item === "association")).toMatchObject({ amountCents: 1200n });
    expect(tariffs.find((row) => row.item === "management_crescita")?.rate).toBe("0.000800");
  });

  it("gives payroll to the first pension fund only, and moves it on request", async () => {
    const first = await createPensionFund(ctx, cometa());
    const second = await createPensionFund(ctx, cometa({ name: "Other fund" }));
    expect(second.receivesPayroll).toBe(false);
    expect((await payrollFund(ctx))?.id).toBe(first.id);
    await setReceivesPayroll(ctx, second.id);
    expect((await payrollFund(ctx))?.id).toBe(second.id);
  });

  it("refuses payroll on a PAC and two funds taking payroll (CHECK, partial unique index)", async () => {
    const pac = await createFund(ctx, {
      name: "PAC",
      provider: null,
      isin: null,
      compartment: null,
      debitAccountId: null,
      debitDay: null,
      ter: null,
      startOn: "2031-01-01",
      valuationAccountId: null,
    });
    await expect(getDb().update(funds).set({ receivesPayroll: true }).where(eqId(pac.id))).rejects.toSatisfy(
      (error) => hasPgError(error, "23514", "funds_receives_payroll_ck"),
    );
    await createPensionFund(ctx, cometa());
    const other = await createPensionFund(ctx, cometa({ name: "Other" }));
    await expect(
      getDb().update(funds).set({ receivesPayroll: true }).where(eqId(other.id)),
    ).rejects.toSatisfy((error) => hasPgError(error, "23505", "funds_receives_payroll_uq"));
  });

  it("keeps the tariff once, however many funds seed it", async () => {
    await createPensionFund(ctx, cometa());
    await createPensionFund(ctx, cometa({ name: "Again" }));
    const rows = await getDb().select().from(fundFeeTariffs);
    expect(rows).toHaveLength(13);
  });

  it("stores contribution rules and the tolerance, validated", async () => {
    const fund = await createPensionFund(ctx, cometa());
    await addContributionRule(ctx, fund.id, {
      validFrom: "2031-01-01",
      ccnl: "Metalmeccanici",
      base: "Minimi contrattuali",
      workerPct: "1,2",
      employerPct: "2.2",
      tfrPct: "100",
      source: "scheda",
    });
    await saveTolerance(ctx, fund.id, 20);
    const rules = await pensionRulesOf(ctx, fund.id);
    expect(rules.find((rule) => rule.kind === "contribution")).toMatchObject({
      workerPct: "1.2000",
      employerPct: "2.2000",
      tfrPct: "100.0000",
    });
    expect(rules.find((rule) => rule.kind === "payment_schedule")?.toleranceDays).toBe(20);
    await expect(saveTolerance(ctx, fund.id, 500)).rejects.toBeInstanceOf(FundError);
    await expect(
      addContributionRule(ctx, fund.id, { validFrom: "2031-02-01", validTo: "2031-01-01" }),
    ).rejects.toBeInstanceOf(FundError);
  });

  it("is invisible to another user", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const other = await newContext();
    await expect(requirePensionFund(other, fund.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await pensionRulesOf(other, fund.id)).toEqual([]);
    expect(await competencesOf(other, fund.id)).toEqual([]);
    expect(await payrollFund(other)).toBeNull();
  });
});

describe("competences from applied payslips (plan F6 L1)", () => {
  it("writes worker, employer and TFR from the lines, in the month's quarter", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const payslip = await applied(MARCH);
    const [competence] = await competencesOf(ctx, fund.id);
    expect(competence).toMatchObject({
      payslipId: payslip.id,
      payrollPeriod: "2031-03-01",
      year: 2031,
      quarter: 1,
      workerCents: 2_500n,
      employerCents: 4_500n,
      tfrCents: 15_000n,
      workerEnrollmentCents: null,
      employerAdjustmentCents: null,
    });
    // 7101, 8003, 9109 — never the statistical 9110.
    expect(competence.sourceLineIds).toHaveLength(3);
  });

  it("gives a 13th its net worker quota, no employer quota, and keeps its adjustment apart", async () => {
    const fund = await createPensionFund(ctx, cometa());
    await applied(THIRTEENTH);
    const [competence] = await competencesOf(ctx, fund.id);
    expect(competence).toMatchObject({
      payrollPeriod: null,
      payslipType: "thirteenth",
      quarter: 4,
      workerCents: 500n,
      workerAdjustmentCents: -2_000n,
      employerCents: null,
      employerAdjustmentCents: -3_000n,
      tfrCents: null,
    });
  });

  it("replaces a superseded payslip's competence rather than adding one", async () => {
    const fund = await createPensionFund(ctx, cometa());
    await applied(MARCH);
    const reprint = await applied(MARCH_REPRINT);
    const rows = await competencesOf(ctx, fund.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payslipId).toBe(reprint.id);
  });

  it("writes nothing without a pension fund, and publishes it all when one is created", async () => {
    await applied(MARCH);
    await applied(THIRTEENTH);
    expect(await getDb().select().from(pensionCompetences)).toHaveLength(0);
    const fund = await createPensionFund(ctx, cometa());
    const published = await replaceCompetences(
      ctx,
      fund.id,
      await appliedCompetences(ctx, await codeMapOf(ctx)),
    );
    expect(published).toBe(2);
    expect((await competencesOf(ctx, fund.id)).map((row) => row.quarter)).toEqual([1, 4]);
    // Twice is the same.
    await replaceCompetences(ctx, fund.id, await appliedCompetences(ctx, await codeMapOf(ctx)));
    expect(await competencesOf(ctx, fund.id)).toHaveLength(2);
  });

  it("does not publish to a fund that does not take payroll", async () => {
    await createPensionFund(ctx, cometa());
    const other = await createPensionFund(ctx, cometa({ name: "Other" }));
    await expect(replaceCompetences(ctx, other.id, [])).rejects.toMatchObject({ code: "invalid" });
  });
});

function eqId(id: string) {
  return eq(funds.id, id);
}
