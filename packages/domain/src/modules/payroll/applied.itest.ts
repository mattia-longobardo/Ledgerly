// Parity of applying a payslip (rewrite plan R2, payroll; audit PAY-5, PAY-6): the pension fund's
// rows and the Time off residual a payslip gives, apply, reopen, apply again and a rectification.
// The values below were taken from the code before `PayslipApplied` and `LeaveBalanceSource`, with
// this same file: the event and the port change who writes and who reads, never a number.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { competencesOf } from "../funds/pension/service";
import { timeOffView } from "../timeoff/queries";
import type { Ctx } from "../../platform/context";
import { deleteFolder, ensureBucket } from "../../platform/storage";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { newContext } from "../../../../../test/fixtures";
import { payrollFund } from "../../../../../test/funds";
import { APRIL, MARCH, MARCH_REPRINT, THIRTEENTH } from "../../../../../test/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../../../test/fixtures/payroll/twin";
import { applyPayslip, processPayslip, reopenPayslip, uploadPayslip, verifyPayslip } from "./service";

let ctx: Ctx;
const NOW = new Date("2031-10-15T10:00:00Z");
const stopClock = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
};

beforeAll(ensureBucket);
beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  stopClock();
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await deleteFolder("payslips/");
  await closeDatabase();
});

/** A payslip read, verified and applied; the bucket wants the real clock. Its document id. */
async function applied(twin: TwinPayslip): Promise<string> {
  vi.useRealTimers();
  try {
    const { document } = await uploadPayslip(ctx, { name: `${twin.period}-${twin.printedOn}.pdf`, bytes: await twinPdf(twin) });
    await processPayslip(ctx, document.id);
    await verifyPayslip(ctx, document.id);
    await applyPayslip(ctx, document.id);
    return document.id;
  } finally {
    stopClock();
  }
}

/** What the fund holds, without the ids of the run. */
async function fundRows(fundId: string) {
  const rows = (await competencesOf(ctx, [fundId])).get(fundId) ?? [];
  return rows
    .map((row) => ({
      period: row.payrollPeriod,
      type: row.payslipType,
      year: row.year,
      quarter: row.quarter,
      worker: row.workerCents,
      employer: row.employerCents,
      tfr: row.tfrCents,
      workerEnrollment: row.workerEnrollmentCents,
      employerEnrollment: row.employerEnrollmentCents,
      workerAdjustment: row.workerAdjustmentCents,
      employerAdjustment: row.employerAdjustmentCents,
      lines: row.sourceLineIds.length,
    }))
    .toSorted((a, b) => `${a.period}${a.type}`.localeCompare(`${b.period}${b.type}`));
}

/** The Time off residuals and the payslip's months of 2031. */
async function timeOff() {
  const view = await timeOffView(ctx, 2031);
  return {
    vacation: view.vacation.residual,
    rol: view.rol.residual,
    payroll: view.rows.filter((row) => row.source === "payroll").map(({ id: _id, ...row }) => row),
    unrecorded: view.unrecorded,
  };
}

describe("an applied payslip gives the fund and Time off the same numbers as before", () => {
  it("applies, reopens, applies again and takes a rectification", async () => {
    const fund = await payrollFund(ctx, { name: "Fund", startOn: "2031-01-01" });
    const march = await applied(MARCH);
    await applied(APRIL);
    await applied(THIRTEENTH);
    const first = { fund: await fundRows(fund.id), timeOff: await timeOff() };
    expect(first).toMatchInlineSnapshot(`
      {
        "fund": [
          {
            "employer": 4500n,
            "employerAdjustment": null,
            "employerEnrollment": null,
            "lines": 3,
            "period": "2031-03-01",
            "quarter": 1,
            "tfr": 15000n,
            "type": "ordinary",
            "worker": 2500n,
            "workerAdjustment": null,
            "workerEnrollment": null,
            "year": 2031,
          },
          {
            "employer": 4500n,
            "employerAdjustment": null,
            "employerEnrollment": null,
            "lines": 3,
            "period": "2031-04-01",
            "quarter": 2,
            "tfr": 15000n,
            "type": "ordinary",
            "worker": 2500n,
            "workerAdjustment": null,
            "workerEnrollment": null,
            "year": 2031,
          },
          {
            "employer": null,
            "employerAdjustment": -3000n,
            "employerEnrollment": null,
            "lines": 3,
            "period": null,
            "quarter": 4,
            "tfr": null,
            "type": "thirteenth",
            "worker": 500n,
            "workerAdjustment": -2000n,
            "workerEnrollment": null,
            "year": 2031,
          },
        ],
        "timeOff": {
          "payroll": [
            {
              "hours": 8,
              "kind": "vacation",
              "payrollPeriod": "2031-03-01",
              "source": "payroll",
              "usagePeriod": "2031-02-01",
            },
            {
              "hours": 4,
              "kind": "rol",
              "payrollPeriod": "2031-04-01",
              "source": "payroll",
              "usagePeriod": "2031-03-01",
            },
          ],
          "rol": {
            "basis": "payslip",
            "countedThrough": "2031-03-01",
            "plannedMinutes": 0,
            "remainingMinutes": 1960,
            "snapshotPeriod": "2031-04-01",
            "takenMinutes": 0,
          },
          "unrecorded": [
            {
              "kind": "vacation",
              "missingMinutes": 480,
              "month": "2031-02-01",
              "payrollMinutes": 480,
              "recordedMinutes": 0,
            },
            {
              "kind": "rol",
              "missingMinutes": 240,
              "month": "2031-03-01",
              "payrollMinutes": 240,
              "recordedMinutes": 0,
            },
          ],
          "vacation": {
            "basis": "payslip",
            "countedThrough": "2031-03-01",
            "plannedMinutes": 0,
            "remainingMinutes": 3100,
            "snapshotPeriod": "2031-04-01",
            "takenMinutes": 0,
          },
        },
      }
    `);

    await reopenPayslip(ctx, march);
    expect({ fund: await fundRows(fund.id), timeOff: await timeOff() }).toMatchInlineSnapshot(`
      {
        "fund": [
          {
            "employer": 4500n,
            "employerAdjustment": null,
            "employerEnrollment": null,
            "lines": 3,
            "period": "2031-04-01",
            "quarter": 2,
            "tfr": 15000n,
            "type": "ordinary",
            "worker": 2500n,
            "workerAdjustment": null,
            "workerEnrollment": null,
            "year": 2031,
          },
          {
            "employer": null,
            "employerAdjustment": -3000n,
            "employerEnrollment": null,
            "lines": 3,
            "period": null,
            "quarter": 4,
            "tfr": null,
            "type": "thirteenth",
            "worker": 500n,
            "workerAdjustment": -2000n,
            "workerEnrollment": null,
            "year": 2031,
          },
        ],
        "timeOff": {
          "payroll": [
            {
              "hours": 4,
              "kind": "rol",
              "payrollPeriod": "2031-04-01",
              "source": "payroll",
              "usagePeriod": "2031-03-01",
            },
          ],
          "rol": {
            "basis": "payslip",
            "countedThrough": "2031-03-01",
            "plannedMinutes": 0,
            "remainingMinutes": 1960,
            "snapshotPeriod": "2031-04-01",
            "takenMinutes": 0,
          },
          "unrecorded": [
            {
              "kind": "rol",
              "missingMinutes": 240,
              "month": "2031-03-01",
              "payrollMinutes": 240,
              "recordedMinutes": 0,
            },
          ],
          "vacation": {
            "basis": "payslip",
            "countedThrough": "2031-03-01",
            "plannedMinutes": 0,
            "remainingMinutes": 3100,
            "snapshotPeriod": "2031-04-01",
            "takenMinutes": 0,
          },
        },
      }
    `);

    await verifyPayslip(ctx, march);
    await applyPayslip(ctx, march);
    expect({ fund: await fundRows(fund.id), timeOff: await timeOff() }).toEqual(first);

    await applied(MARCH_REPRINT);
    expect({ fund: await fundRows(fund.id), timeOff: await timeOff() }).toEqual(first);
  });
});
