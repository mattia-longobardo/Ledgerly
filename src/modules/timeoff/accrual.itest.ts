/**
 * What the Time off screen forecasts (release N5.1, `docs/design/timeoff-accrual.md`).
 *
 * The rate comes from the difference between two applied payslips, and the forecast starts from
 * the last of them whatever year is on the screen — so these need real payslips behind them. The
 * other half is the person with no payslip at all, and a year nobody has anything in yet: neither
 * may be an error.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyPayslip, processPayslip, uploadPayslip, verifyPayslip } from "@/modules/payroll/service";
import type { Ctx } from "@/platform/context";
import { deleteFolder, ensureBucket } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { APRIL, MARCH } from "../../../test/fixtures/payroll/samples";
import { type TwinPayslip, twinPdf } from "../../../test/fixtures/payroll/twin";
import { timeOffView } from "./queries";
import { saveAllowance, saveLeaveDay } from "./service";

/** The twin payslips' own year. Vacation: MAT. 40 h in March, 46.66 h in April, RES. 51.66 h. */
const YEAR = 2031;
const MONTH_MINUTES = (46.66 - 40) * 60;
/** RES. is held in whole minutes, as the residual of the card is. */
const APRIL_RES_MINUTES = Math.round(51.66 * 60);

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

async function withPayslip(name: string, twin: TwinPayslip): Promise<void> {
  const { document } = await uploadPayslip(ctx, { name, bytes: await twinPdf(twin) });
  await processPayslip(ctx, document.id);
  await verifyPayslip(ctx, document.id);
  await applyPayslip(ctx, document.id);
}

async function book(dates: readonly string[]): Promise<void> {
  for (const on of dates) await saveLeaveDay(ctx, { from: on, kind: "vacation", fraction: 1 });
}

describe("the rate of the payslips (D1)", () => {
  it("reads a month's accrual between two payslips, and forecasts the end of the year with it", async () => {
    await withPayslip("march.pdf", MARCH);
    await withPayslip("april.pdf", APRIL);

    const view = await timeOffView(ctx, YEAR);
    expect(view.accrual.vacation.rate?.source).toBe("payslip");
    expect(view.accrual.vacation.rate?.minutesPerMonth).toBeCloseTo(MONTH_MINUTES, 6);
    // April's RES. and the eight months from May to December.
    expect(view.accrual.vacation.yearEndMinutes).toBe(Math.round(APRIL_RES_MINUTES + MONTH_MINUTES * 8));
    expect(view.accrual.vacation.leads).toBe(false);
    // The residual of the card is the payslip's, as it was.
    expect(view.vacation.residual.basis).toBe("payslip");
    expect(view.vacation.residual.remainingMinutes).toBe(APRIL_RES_MINUTES);
  });

  it("falls back to the allowance over twelve with one payslip only, and says so", async () => {
    await withPayslip("march.pdf", MARCH);
    await saveAllowance(ctx, YEAR, { vacationDays: 24, rolDays: 4 });

    const view = await timeOffView(ctx, YEAR);
    expect(view.accrual.vacation.rate).toEqual({
      minutesPerMonth: 2 * view.minutesPerDay,
      source: "allowance",
    });
  });
});

describe("a year with no payslip of its own (D4, D6)", () => {
  it("is forecast from the last payslip of the year before, the days in between subtracted", async () => {
    await withPayslip("march.pdf", MARCH);
    await withPayslip("april.pdf", APRIL);
    await book(["2031-12-22", "2032-03-10"]);

    const view = await timeOffView(ctx, YEAR + 1);
    expect(view.vacation.residual.basis).toBe("unknown");
    expect(view.accrual.vacation.leads).toBe(true);
    expect(view.accrual.vacation.payslipPeriod).toBe("2031-04-01");
    // May 2031 to December 2032: twenty months, less the day of each year.
    expect(view.accrual.vacation.yearEndMinutes).toBe(
      Math.round(APRIL_RES_MINUTES + MONTH_MINUTES * 20 - 2 * view.minutesPerDay),
    );
    // The year's own rows are the year's own: the day of December 2031 is not one of them.
    expect(view.rows.map((row) => (row.source === "day" ? row.on : null))).toEqual(["2032-03-10"]);
    expect(view.overdrawn).toEqual([]);
  });

  it("has no forecast for a year that ended before the payslip", async () => {
    await withPayslip("march.pdf", MARCH);
    await withPayslip("april.pdf", APRIL);
    const view = await timeOffView(ctx, YEAR - 1);
    expect(view.accrual.vacation.yearEndMinutes).toBeNull();
    expect(view.accrual.vacation.leads).toBe(false);
  });
});

describe("a person with no payslip at all", () => {
  it("is forecast from the stated allowance, in a year to come as in this one", async () => {
    // A Tuesday of each year.
    for (const [year, tuesday] of [
      [YEAR, "2031-03-04"],
      [YEAR + 9, "2040-03-06"],
    ] as const) {
      await saveAllowance(ctx, year, { vacationDays: 24, rolDays: 6 });
      await book([tuesday]);

      const view = await timeOffView(ctx, year);
      expect(view.accrual.vacation.rate).toEqual({
        minutesPerMonth: 2 * view.minutesPerDay,
        source: "allowance",
      });
      expect(view.accrual.vacation.yearEndMinutes).toBe(23 * view.minutesPerDay);
      // The same figure as the residual of the card: one answer, not two.
      expect(view.accrual.vacation.yearEndMinutes).toBe(view.vacation.residual.remainingMinutes);
      expect(view.accrual.vacation.leads).toBe(false);
      expect(view.accrual.rol.rate).toEqual({ minutesPerMonth: view.minutesPerDay / 2, source: "allowance" });
    }
  });

  it("has no forecast and no error with no allowance either, in any year", async () => {
    for (const year of [YEAR, YEAR + 1, YEAR + 9]) {
      const view = await timeOffView(ctx, year);
      for (const kind of ["vacation", "rol"] as const) {
        expect(view.accrual[kind]).toEqual({
          rate: null,
          yearEndMinutes: null,
          payslipPeriod: null,
          leads: false,
        });
      }
      expect(view.overdrawn).toEqual([]);
    }
  });
});
