// The fund fed by the payslip: where its value lives, the payroll sink and the reviewer's decisions
// (plan F6 L0–L1; release N6), on the synthetic payslip twins, against the real test database and
// bucket.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccount, listAccounts } from "../../accounts/queries";
import { DOCUMENT_KINDS } from "../../imports/rules";
import { listDocuments } from "../../imports/service";
import { appliedCompetences } from "../../payroll/pension";
import { applyPayslip, codeMapOf, processPayslip, uploadPayslip, verifyPayslip } from "../../payroll/service";
import { chargeCandidates } from "../../transactions/queries";
import { upsertFromProvider } from "../../transactions/service";
import type { Ctx } from "../../../platform/context";
import { civilDateIn } from "../../../platform/dates";
import { getDb } from "../../../platform/db/client";
import { deleteFolder, ensureBucket } from "../../../platform/storage";
import { closeDatabase, resetDatabase } from "../../../../../../test/db";
import { anAccount, movement, newContext } from "../../../../../../test/fixtures";
import { addVoluntaryContribution, payrollFund as fundFedByPayslip } from "../../../../../../test/funds";
import { APRIL, MARCH, MARCH_REPRINT, THIRTEENTH } from "../../../../../../test/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../../../../test/fixtures/payroll/twin";
import { fundDetail } from "../queries";
import { funds, pensionCompetences } from "../schema";
import {
  addContribution,
  addSource,
  createFund,
  feesOf,
  requireFund,
  setFundState,
  setSourceState,
  sourcesOf,
  updateContribution,
} from "../service";
import {
  competencesOf as competencesByFund,
  decideDifference,
  decisionsOf as decisionsByFund,
  payrollFund,
  replaceCompetences,
} from "./service";

let ctx: Ctx;

/** The payslip twins are of 2031: the clock is stopped there, so that nothing of theirs is in the future. */
const NOW = new Date("2031-10-15T10:00:00Z");
const stopClock = () => {
  // Only `Date` is faked: the pool's own timers must keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
};

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  stopClock();
});
afterEach(() => {
  vi.useRealTimers();
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

/** A fund fed by the payslip, as one was made before release N6 (`test/funds.ts`). */
const createPensionFund = fundFedByPayslip;

/**
 * A payslip read, verified and applied. The payslips go through the bucket, and S3 refuses a
 * request signed five years from now: they are read with the real clock. None of their numbers
 * comes from the clock.
 */
async function applied(twin: TwinPayslip, who: Ctx = ctx) {
  vi.useRealTimers();
  try {
    const { document } = await uploadPayslip(who, { name: `${twin.period}.pdf`, bytes: await twinPdf(twin) });
    await processPayslip(who, document.id);
    await verifyPayslip(who, document.id);
    return await applyPayslip(who, document.id);
  } finally {
    stopClock();
  }
}

/** One fund's competences and decisions: the reads take every fund at once since release N6. */
const competencesOf = async (who: Pick<Ctx, "userId">, fundId: string) =>
  (await competencesByFund(who, [fundId])).get(fundId)!;
const decisionsOf = async (who: Pick<Ctx, "userId">, fundId: string) =>
  (await decisionsByFund(who, [fundId])).get(fundId)!;

/** The fund's payslip source. */
const payslipSourceOf = async (fundId: string) =>
  (await sourcesOf(ctx, [fundId])).find((source) => source.kind === "payroll")!;

describe("a pension fund (plan F6 L0)", () => {
  it("lives on a pension account outside cash", async () => {
    const fund = await createPensionFund(ctx, cometa());
    expect(fund).toMatchObject({ compartment: "Crescita" });
    const account = await getAccount(ctx, fund.valuationAccountId);
    expect(account).toMatchObject({ type: "pension", countsAsLiquid: false, inNetWorth: true });
  });

  it("gives payroll to the first pension fund only, and moves it on request", async () => {
    const first = await createPensionFund(ctx, cometa());
    const second = await createPensionFund(ctx, cometa({ name: "Other fund", receivesPayroll: false }));
    expect((await payrollFund(ctx))?.id).toBe(first.id);
    // Moving the payslip is two steps since release N6: the first fund lets it go, the second takes it.
    await setSourceState(ctx, (await payslipSourceOf(first.id)).id, "paused");
    await setSourceState(ctx, (await payslipSourceOf(second.id)).id, "active");
    expect((await payrollFund(ctx))?.id).toBe(second.id);
  });

  it("is invisible to another user", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const other = await newContext();
    await expect(requireFund(other, fund.id)).rejects.toMatchObject({ code: "not_found" });
    // Its payment schedule and its fees are its sources and its fees since release N6.
    expect(await sourcesOf(other, [fund.id])).toEqual([]);
    expect(await feesOf(other, [fund.id])).toEqual([]);
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
    const other = await createPensionFund(ctx, cometa({ name: "Other", receivesPayroll: false }));
    await expect(replaceCompetences(ctx, other.id, [])).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("a voluntary contribution tied to a movement", () => {
  const paid = (transactionId: string) => ({ on: "2031-02-01", amountCents: 100_00n, transactionId });
  async function aMovement(who: Ctx): Promise<string> {
    const accountId = await anAccount(who);
    await upsertFromProvider(who, accountId, [movement()]);
    const [found] = await chargeCandidates(who, { accountId, from: "2026-03-01", to: "2026-03-31" });
    return found.id;
  }

  it("ties the user's own movement", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const paying = await aMovement(ctx);
    const row = await addVoluntaryContribution(ctx, fund.id, paid(paying));
    expect(row.transactionId).toBe(paying);
  });

  it("refuses a movement of another user, and leaves it free for its owner", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const other = await newContext();
    const theirs = await aMovement(other);
    await expect(addVoluntaryContribution(ctx, fund.id, paid(theirs))).rejects.toMatchObject({
      code: "not_found",
    });
    const theirFund = await createPensionFund(other, cometa());
    const row = await addVoluntaryContribution(other, theirFund.id, paid(theirs));
    expect(row.transactionId).toBe(theirs);
  });

  it("answers the same for a movement that does not exist", async () => {
    const fund = await createPensionFund(ctx, cometa());
    await expect(
      addVoluntaryContribution(ctx, fund.id, paid("00000000-0000-4000-8000-000000000000")),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("answers with a form error for a movement another operation holds", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const paying = await aMovement(ctx);
    await addVoluntaryContribution(ctx, fund.id, paid(paying));
    await expect(addVoluntaryContribution(ctx, fund.id, paid(paying))).rejects.toMatchObject({
      code: "movement_taken",
    });
  });
});

describe("the lines a decision names", () => {
  const decision = {
    year: 2031,
    quarter: 1,
    component: "worker" as const,
    decision: "accepted_difference" as const,
    note: "Rounded by the fund",
    differenceCents: 100n,
    accruedCents: 7_500n,
    creditedCents: 7_400n,
  };

  it("takes the fund's own lines", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const operation = await addVoluntaryContribution(ctx, fund.id, { on: "2031-02-01", amountCents: 100n });
    await decideDifference(ctx, fund.id, { ...decision, competenceIds: [], operationIds: [operation.id] });
    const [saved] = await decisionsOf(ctx, fund.id);
    expect(saved.operationIds).toEqual([operation.id]);
  });

  it("refuses a line of another user's and saves nothing", async () => {
    const other = await newContext();
    const theirs = await createPensionFund(other, cometa());
    const operation = await addVoluntaryContribution(other, theirs.id, {
      on: "2031-02-01",
      amountCents: 100n,
    });
    const fund = await createPensionFund(ctx, cometa());
    await expect(
      decideDifference(ctx, fund.id, { ...decision, competenceIds: [], operationIds: [operation.id] }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await decisionsOf(ctx, fund.id)).toEqual([]);
  });

  it("refuses a line of another fund of the same user", async () => {
    const fund = await createPensionFund(ctx, cometa());
    const second = await createPensionFund(ctx, cometa({ name: "Second", receivesPayroll: false }));
    const operation = await addVoluntaryContribution(ctx, second.id, { on: "2031-02-01", amountCents: 100n });
    await expect(
      decideDifference(ctx, fund.id, { ...decision, competenceIds: [], operationIds: [operation.id] }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses what is not an id", async () => {
    const fund = await createPensionFund(ctx, cometa());
    await expect(
      decideDifference(ctx, fund.id, { ...decision, competenceIds: ["nope"], operationIds: [] }),
    ).rejects.toThrow();
    expect(await decisionsOf(ctx, fund.id)).toEqual([]);
  });
});

describe("a line of a payslip goes to one fund only (release N6)", () => {
  const payslip = {
    kind: "payroll" as const,
    components: ["worker", "employer", "tfr"] as ("worker" | "employer" | "tfr")[],
    accrualPeriod: "quarter" as const,
  };
  const aFund = (name: string, sources: (typeof payslip)[] = [payslip]) =>
    createFund(ctx, {
      fund: { name, provider: "Esempio Previdenza", startOn: "2031-01-01" },
      sources,
      fees: [],
    });
  const heldBy = (name: string) => ({ code: "component_taken", detail: name });
  const pause = async (fundId: string) => setSourceState(ctx, (await payslipSourceOf(fundId)).id, "paused");
  const resume = async (fundId: string) => setSourceState(ctx, (await payslipSourceOf(fundId)).id, "active");

  it("refuses a second fund fed by the payslip, at creation and on a source added later", async () => {
    const alfa = await aFund("Fondo Alfa");
    await expect(aFund("Fondo Beta")).rejects.toMatchObject(heldBy("Fondo Alfa"));
    // Nothing of the refused fund was written: neither the fund nor an account for it.
    expect((await getDb().select().from(funds)).map((fund) => fund.name)).toEqual(["Fondo Alfa"]);
    expect((await listAccounts(ctx, { includeArchived: true })).map((account) => account.name)).toEqual([
      "Fondo Alfa",
    ]);

    const beta = await aFund("Fondo Beta", []);
    await expect(addSource(ctx, beta.id, payslip)).rejects.toMatchObject(heldBy("Fondo Alfa"));
    expect(await sourcesOf(ctx, [beta.id])).toEqual([]);
    // And one active payslip source per fund: a second one waits for the first to be paused.
    await expect(addSource(ctx, alfa.id, payslip)).rejects.toMatchObject({ code: "payroll_active" });
    expect((await payrollFund(ctx))?.id).toBe(alfa.id);
  });

  it("lets another fund take the payslip once the first has paused its source", async () => {
    const alfa = await aFund("Fondo Alfa");
    const beta = await aFund("Fondo Beta", []);
    await pause(alfa.id);
    expect(await payrollFund(ctx)).toBeNull();
    await addSource(ctx, beta.id, payslip);
    expect((await payrollFund(ctx))?.id).toBe(beta.id);
    // The payslip is Beta's now: Alfa does not take it back while Beta holds it.
    await expect(resume(alfa.id)).rejects.toMatchObject(heldBy("Fondo Beta"));
    expect((await payslipSourceOf(alfa.id)).state).toBe("paused");
  });

  it("refuses to bring back a paused source, or an archived fund with one, while another fund holds the payslip", async () => {
    const alfa = await aFund("Fondo Alfa");
    await pause(alfa.id);
    const beta = await aFund("Fondo Beta");
    await pause(beta.id);
    await resume(alfa.id);

    await expect(resume(beta.id)).rejects.toMatchObject(heldBy("Fondo Alfa"));
    expect((await payslipSourceOf(beta.id)).state).toBe("paused");

    // Beta is archived while it holds the payslip, and Alfa takes the payslip meanwhile.
    await pause(alfa.id);
    await resume(beta.id);
    await setFundState(ctx, beta.id, "archived");
    await resume(alfa.id);
    await expect(setFundState(ctx, beta.id, "active")).rejects.toMatchObject(heldBy("Fondo Alfa"));
    expect((await requireFund(ctx, beta.id)).state).toBe("archived");
    expect((await payrollFund(ctx))?.id).toBe(alfa.id);

    // Once Alfa lets it go, Beta comes back with it.
    await pause(alfa.id);
    await setFundState(ctx, beta.id, "active");
    expect((await payrollFund(ctx))?.id).toBe(beta.id);
  });

  it("sends an applied payslip's competence to the fund that holds the payslip, and to no other", async () => {
    const alfa = await aFund("Fondo Alfa");
    await pause(alfa.id);
    const beta = await aFund("Fondo Beta");
    await pause(beta.id);
    await resume(alfa.id);

    await applied(MARCH);
    expect((await competencesOf(ctx, alfa.id)).map((row) => row.payrollPeriod)).toEqual(["2031-03-01"]);
    expect(await competencesOf(ctx, beta.id)).toEqual([]);

    await pause(alfa.id);
    await resume(beta.id);
    await applied(APRIL);
    expect((await competencesOf(ctx, beta.id)).map((row) => row.payrollPeriod)).toEqual(["2031-04-01"]);
    expect((await competencesOf(ctx, alfa.id)).map((row) => row.payrollPeriod)).toEqual(["2031-03-01"]);
    expect(await getDb().select().from(pensionCompetences)).toHaveLength(2);
  });
});

describe("reconciliation on the recorded operations, with no document (release N6)", () => {
  const fromPayslip = (workerCents: bigint) => ({
    kind: "payroll" as const,
    on: "2031-04-18",
    workerCents,
    employerCents: 4_500n,
    tfrCents: 15_000n,
    period: { year: 2031, index: 1 },
    feeCents: 300n,
  });
  const components = async (fundId: string) =>
    (await fundDetail(ctx, fundId)).quarters[0].components.map((one) => [
      one.component,
      one.accruedCents,
      one.creditedCents,
      one.differenceCents,
      one.status,
    ]);

  it("reconciles a quarter with the contribution from the payslip written by hand, and dates the register by it", async () => {
    const fund = await createPensionFund(ctx, cometa());
    await applied(MARCH);
    const before = await fundDetail(ctx, fund.id);
    expect(before.freshness).toBeNull();
    expect(before.quarters.map((one) => [one.year, one.quarter, one.status])).toEqual([
      [2031, 1, "transferred"],
    ]);

    const operation = await addContribution(ctx, fund.id, fromPayslip(2_500n));
    expect(operation).toMatchObject({
      classification: "contribution",
      source: "manual",
      documentId: null,
      sourceId: (await payslipSourceOf(fund.id)).id,
      competenceYear: 2031,
      competenceQuarter: 1,
      netCents: 21_700n,
    });
    const detail = await fundDetail(ctx, fund.id);
    expect(detail.quarters).toHaveLength(1);
    expect(detail.quarters[0]).toMatchObject({
      year: 2031,
      quarter: 1,
      status: "reconciled",
      operationDates: ["2031-04-18"],
      feesCents: 300n,
      netCents: 21_700n,
    });
    expect(await components(fund.id)).toEqual([
      ["worker", 2_500n, 2_500n, 0n, "reconciled"],
      ["employer", 4_500n, 4_500n, 0n, "reconciled"],
      ["tfr", 15_000n, 15_000n, 0n, "reconciled"],
    ]);
    // The day the operation was written, not the day it is dated.
    expect(detail.freshness).toBe(civilDateIn(operation.createdAt, ctx.timeZone));
    expect(detail.freshness).not.toBe("2031-04-18");
    // The only document there is, is the payslip.
    expect((await listDocuments(ctx, DOCUMENT_KINDS)).map((document) => document.kind)).toEqual(["payslip"]);
  });

  it("says a discrepancy when what was written differs from what the payslips accrued", async () => {
    const fund = await createPensionFund(ctx, cometa());
    await applied(MARCH);
    const operation = await addContribution(ctx, fund.id, fromPayslip(2_400n));
    expect((await fundDetail(ctx, fund.id)).quarters[0].status).toBe("discrepancy");
    expect(await components(fund.id)).toEqual([
      ["worker", 2_500n, 2_400n, -100n, "discrepancy"],
      ["employer", 4_500n, 4_500n, 0n, "reconciled"],
      ["tfr", 15_000n, 15_000n, 0n, "reconciled"],
    ]);
    // Corrected by hand, the quarter reconciles.
    await updateContribution(ctx, operation.id, fromPayslip(2_500n));
    expect((await fundDetail(ctx, fund.id)).quarters[0].status).toBe("reconciled");
  });
});
