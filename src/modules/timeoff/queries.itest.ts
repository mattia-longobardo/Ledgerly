/**
 * What the Time off screen says once a payslip has spoken (N9).
 *
 * The three things this file guards are the ones a person can only get wrong in company: the
 * carry-over comes from the payslip and from nowhere else, it is never counted twice, and a
 * booking is judged against what the year will have granted by the day it falls on. Each of them
 * needs a real applied payslip behind it, which is why they are here and not in the unit tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyPayslip, processPayslip, uploadPayslip, verifyPayslip } from "@/modules/payroll/service";
import type { Ctx } from "@/platform/context";
import { deleteFolder, ensureBucket } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { MARCH } from "../../../tests/fixtures/payroll/samples";
import { twinPdf } from "../../../tests/fixtures/payroll/twin";
import { timeOffView } from "./queries";
import { saveAllowance, saveLeaveDay } from "./service";

/** The twin payslip's own year: March 2031, so everything from March on is still planned. */
const YEAR = 2031;
/** Vacation on it: A.P. 5 h, MAT. 40 h, RES. 45 h. ROL: A.P. 10 h, MAT. 20 h, RES. 30 h. */
const CARRIED_VACATION_HOURS = 5;
const CARRIED_ROL_HOURS = 10;

/** Working days, weekends and Italian holidays already out: ten in April, ten in December. */
const APRIL_DAYS = [
  "2031-04-01",
  "2031-04-02",
  "2031-04-03",
  "2031-04-04",
  "2031-04-07",
  "2031-04-08",
  "2031-04-09",
  "2031-04-10",
  "2031-04-11",
  "2031-04-15",
];
const DECEMBER_DAYS = [
  "2031-12-01",
  "2031-12-02",
  "2031-12-03",
  "2031-12-04",
  "2031-12-05",
  "2031-12-09",
  "2031-12-10",
  "2031-12-11",
  "2031-12-12",
  "2031-12-15",
];

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

async function withMarchPayslip(): Promise<void> {
  const { document } = await uploadPayslip(ctx, { name: "march.pdf", bytes: await twinPdf(MARCH) });
  await processPayslip(ctx, document.id);
  await verifyPayslip(ctx, document.id);
  await applyPayslip(ctx, document.id);
}

async function book(dates: readonly string[]): Promise<void> {
  for (const on of dates) await saveLeaveDay(ctx, { from: on, kind: "vacation", fraction: 1 });
}

describe("the carry-over comes from the payslip (N9)", () => {
  it("reads it off the A.P. column, with nobody having stated a thing", async () => {
    await withMarchPayslip();
    const view = await timeOffView(ctx, YEAR);
    expect(view.vacation.carriedMinutes).toBe(CARRIED_VACATION_HOURS * 60);
    expect(view.rol.carriedMinutes).toBe(CARRIED_ROL_HOURS * 60);
  });

  it("is nothing at all when no payslip has spoken, rather than a figure of our own", async () => {
    await saveAllowance(ctx, YEAR, { vacationDays: 26, rolDays: 4 });
    const view = await timeOffView(ctx, YEAR);
    expect(view.vacation.carriedMinutes).toBe(0);
    expect(view.rol.carriedMinutes).toBe(0);
    expect(view.vacation.residual.basis).toBe("allowance");
  });

  it("never counts it twice: a printed RES. already has it inside", async () => {
    await withMarchPayslip();
    await book([APRIL_DAYS[0]]);
    const view = await timeOffView(ctx, YEAR);

    // RES. 45 h less the one day booked after the month the payslip counted — the 5 h of A.P. are
    // part of the 45 and are not added again.
    expect(view.vacation.residual.basis).toBe("payslip");
    expect(view.vacation.residual.remainingMinutes).toBe(45 * 60 - view.minutesPerDay);
  });
});

describe("the alert waits for the days to be earned (N9)", () => {
  // 45 h of vacation is six days and a half on a seven-hour day: ten days is over it either way.
  const overBooked = 10;

  it("says nothing about days that will have accrued by the time they come", async () => {
    await withMarchPayslip();
    await saveAllowance(ctx, YEAR, { vacationDays: 26, rolDays: 4 });
    await book(DECEMBER_DAYS.slice(0, overBooked));

    const view = await timeOffView(ctx, YEAR);
    // Past the printed residual, and the card says so plainly…
    expect(view.vacation.residual.remainingMinutes).toBeLessThan(0);
    // …but nine months of work will have granted far more than ten days by December.
    expect(view.overdrawn).toEqual([]);
  });

  it("does warn about the same ten days taken in April, and names the day", async () => {
    await withMarchPayslip();
    await saveAllowance(ctx, YEAR, { vacationDays: 26, rolDays: 4 });
    await book(APRIL_DAYS.slice(0, overBooked));

    const view = await timeOffView(ctx, YEAR);
    const [over] = view.overdrawn;
    expect(over?.kind).toBe("vacation");
    expect(over?.basis).toBe("payslip");
    expect(over?.onDate).toBe(APRIL_DAYS[overBooked - 1]);
  });

  it("falls back to the plain figure when nobody has said what the year grants", async () => {
    // No allowance, so no rate to spread: the warning is the year-end one it always was, with no
    // day to name, and it still fires.
    await withMarchPayslip();
    await book(DECEMBER_DAYS.slice(0, overBooked));

    const view = await timeOffView(ctx, YEAR);
    expect(view.overdrawn.map((one) => one.onDate)).toEqual([null]);
  });
});
