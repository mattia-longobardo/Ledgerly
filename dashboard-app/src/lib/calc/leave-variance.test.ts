import { describe, expect, it } from "vitest";
import type { LeaveTakenMonth } from "./payroll";
import { VARIANCE_TOLERANCE_DAYS, flaggedMonths, leaveVariance } from "./leave-variance";

/** `leaveTakenByMonth()` rows, trimmed to what the variance actually reads. */
function actual(month: string, totalDays: number): LeaveTakenMonth {
  return {
    month,
    ferieHours: totalDays * 8,
    rolHours: 0,
    totalHours: totalDays * 8,
    ferieDays: totalDays,
    rolDays: 0,
    totalDays,
  };
}

const FIRST_PLANNED = "2026-06-01";

describe("leaveVariance", () => {
  it("flags a month where MORE was taken than planned", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 2 }],
      actual: [actual("2026-03-01", 4)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "over", deltaDays: 2, flagged: true });
  });

  it("flags a month where FEWER were taken than planned", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 5 }],
      actual: [actual("2026-03-01", 3)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "under", deltaDays: -2, flagged: true });
  });

  it("does not flag an exact match", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 3 }],
      actual: [actual("2026-03-01", 3)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "match", deltaDays: 0, flagged: false });
  });

  it("reconciles half days: 2 full + 1 half = 2.5 planned", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 2.5 }],
      actual: [actual("2026-03-01", 2.5)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "match", flagged: false });
  });

  it("FLAGS a half-day difference — the smallest thing the calendar can express", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 2 }],
      actual: [actual("2026-03-01", 2.5)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "over", flagged: true });
    expect(Math.abs(row?.deltaDays ?? 0)).toBeGreaterThan(VARIANCE_TOLERANCE_DAYS);
  });

  it("absorbs the payslip's odd-minutes reporting (12,01 h against 12,00 h)", () => {
    // The real August payslip: 12,01 h at 8 h/day = 1,50125 d against 1,5 planned.
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 1.5 }],
      actual: [actual("2026-03-01", 12.01 / 8)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "match", flagged: false });
  });

  it("never flags a FUTURE month — a booked day there is 'previsto', not a variance", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-09-01", days: 5 }],
      actual: [],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "planned", actualDays: null, flagged: false });
  });

  it("treats the boundary month P itself as planned-only — its covering payslip is next month's", () => {
    const [row] = leaveVariance({
      planned: [{ month: FIRST_PLANNED, days: 2 }],
      actual: [],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "planned", flagged: false });
  });

  it("waits rather than flagging when a past month has no payslip yet", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 2 }],
      actual: [],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "awaiting_payslip", actualDays: null, flagged: false });
  });

  it("reports no_calendar for a month predating the calendar, instead of a false 'over'", () => {
    const [row] = leaveVariance({
      planned: [],
      actual: [actual("2026-01-01", 3)],
      firstPlannedMonth: FIRST_PLANNED,
      earliestCalendarMonth: "2026-03-01",
    });
    expect(row).toMatchObject({ status: "no_calendar", plannedDays: 0, flagged: false });
  });

  it("DOES flag a payslip month the calendar covered but left empty", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-04-01", days: 1 }],
      actual: [actual("2026-03-01", 3), actual("2026-04-01", 1)],
      firstPlannedMonth: FIRST_PLANNED,
      earliestCalendarMonth: "2026-03-01",
    });
    // March is inside the covered window with nothing planned but 3 days taken.
    expect(row).toMatchObject({ month: "2026-03-01", status: "over", flagged: true });
  });

  it("returns nothing at all when neither side has data", () => {
    expect(leaveVariance({ planned: [], actual: [], firstPlannedMonth: FIRST_PLANNED })).toEqual([]);
  });

  it("sits exactly on the tolerance without flagging", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 2 }],
      actual: [actual("2026-03-01", 2.25)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(row).toMatchObject({ status: "match", flagged: false });
  });

  it("orders every month ascending and merges both sides", () => {
    const rows = leaveVariance({
      planned: [{ month: "2026-04-01", days: 1 }],
      actual: [actual("2026-02-01", 1), actual("2026-03-01", 1)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(rows.map((r) => r.month)).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  // The owner's case: "Agosto è ancora planned perché è il payslip di settembre
  // che segnerà le vacanze di agosto." Latest verified payslip is August, so the
  // boundary P is 2026-08; September's payslip (which would record August's
  // usage) does not exist yet.
  it("keeps a month covered only by a not-yet-arrived payslip as planned, not flagged", () => {
    const rows = leaveVariance({
      // Boundary P = August: the August payslip is the latest verified one.
      firstPlannedMonth: "2026-08-01",
      // August is booked (5 days) but its actual would only come from the
      // September payslip; July's actual (12,00 h) came from the August payslip.
      planned: [
        { month: "2026-07-01", days: 1.5 },
        { month: "2026-08-01", days: 5 },
      ],
      actual: [actual("2026-07-01", 1.5)],
      earliestCalendarMonth: "2026-01-01",
    });

    // August is at/after P → planned, no actual, never flagged.
    const august = rows.find((r) => r.month === "2026-08-01");
    expect(august).toMatchObject({ status: "planned", actualDays: null, flagged: false });

    // July is before P and its covering payslip (August's) is in hand → comparable.
    const july = rows.find((r) => r.month === "2026-07-01");
    expect(july).toMatchObject({ status: "match", flagged: false });
  });

  it("would have flagged August under the OLD current-month boundary — regression guard", () => {
    // With "today" = September, August is strictly in the past, so the old
    // `month >= currentMonth` rule made August comparable: 5 planned, 0 actual =
    // a bogus "under". The payslip-derived boundary keeps it planned instead.
    const [august] = leaveVariance({
      firstPlannedMonth: "2026-08-01",
      planned: [{ month: "2026-08-01", days: 5 }],
      actual: [],
      earliestCalendarMonth: "2026-01-01",
    });
    expect(august).toMatchObject({ status: "planned", flagged: false });
    expect(august?.status).not.toBe("under");
  });

  it("still reports awaiting_payslip for a genuine mid-series gap (a month < P with no actual)", () => {
    // May is well before P (August) yet its payslip is simply missing — a real
    // hole, distinct from "the covering payslip has not come yet".
    const rows = leaveVariance({
      firstPlannedMonth: "2026-08-01",
      planned: [
        { month: "2026-05-01", days: 2 },
        { month: "2026-07-01", days: 1 },
      ],
      actual: [actual("2026-07-01", 1)],
      earliestCalendarMonth: "2026-01-01",
    });
    expect(rows.find((r) => r.month === "2026-05-01")).toMatchObject({
      status: "awaiting_payslip",
      actualDays: null,
      flagged: false,
    });
  });

  it("treats every month as planned when there is no verified payslip at all", () => {
    const rows = leaveVariance({
      planned: [
        { month: "2026-03-01", days: 2 },
        { month: "2026-07-01", days: 3 },
      ],
      actual: [],
      // firstPlannedMonth omitted: nothing verified, nothing comparable.
    });
    expect(rows.every((r) => r.status === "planned" && !r.flagged)).toBe(true);
  });

  it("honours an overridden tolerance", () => {
    const [row] = leaveVariance({
      planned: [{ month: "2026-03-01", days: 2 }],
      actual: [actual("2026-03-01", 3)],
      firstPlannedMonth: FIRST_PLANNED,
      tolerance: 1,
    });
    expect(row).toMatchObject({ status: "match", flagged: false });
  });
});

describe("flaggedMonths", () => {
  it("keeps only what the UI should warn about", () => {
    const rows = leaveVariance({
      planned: [
        { month: "2026-03-01", days: 2 },
        { month: "2026-04-01", days: 2 },
        { month: "2026-09-01", days: 4 },
      ],
      actual: [actual("2026-03-01", 2), actual("2026-04-01", 5)],
      firstPlannedMonth: FIRST_PLANNED,
    });
    expect(flaggedMonths(rows).map((r) => r.month)).toEqual(["2026-04-01"]);
  });
});
