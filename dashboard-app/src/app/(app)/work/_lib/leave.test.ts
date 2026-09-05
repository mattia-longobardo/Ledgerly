/**
 * The leave calendar view model, with the repos mocked.
 *
 * The case worth pinning is the JANUARY BOUNDARY. `no_calendar` must mean
 * "before the mirror held anything at all", not "before the first booking of
 * the year on screen". Deriving it from the year's first booked day silenced
 * every month between January and that booking: a payslip charging ferie in
 * February against a February nobody entered — the exact discrepancy this
 * report exists to surface — came back `no_calendar`, `flagged: false`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaveDayRow } from "@/lib/repo/leave";

const repo = vi.hoisted(() => ({ daysInYear: vi.fn(), earliestDate: vi.fn() }));
const payslips = vi.hoisted(() => ({ verifiedPayslips: vi.fn(async () => []) }));
const trekState = vi.hoisted(() => ({ getCachedTrekStats: vi.fn(async () => null) }));
const payroll = vi.hoisted(() => ({ leaveTakenByMonth: vi.fn(() => []) }));
const vacation = vi.hoisted(() => ({ hoursPerDay: vi.fn(async () => 8) }));

const principal = vi.hoisted(() => ({ connected: true }));

vi.mock("@/modules/integrations/ui/principal-connection", () => ({
  openPrincipalConnection: vi.fn(async () =>
    principal.connected
      ? { connection: { id: "c1" }, credentials: { baseUrl: "https://trek.example", token: "trek_t" } }
      : null,
  ),
  isProviderConnectedForPrincipal: vi.fn(async () => principal.connected),
}));
vi.mock("@/lib/repo/leave", () => repo);
vi.mock("@/lib/repo/payslips", () => payslips);
vi.mock("@/lib/repo/trek-state", () => trekState);
vi.mock("@/lib/calc/payroll", () => payroll);
vi.mock("../../_lib/vacation", () => vacation);

// "Now" has to be fixed: every month at or after it is planned-only and can
// never be flagged, which would make the assertions below depend on the date
// the suite happens to run.
vi.mock("@/lib/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/time")>();
  return { ...actual, romeDate: () => "2027-09-01" };
});

const { loadLeaveCalendar } = await import("./leave");

function day(date: string): LeaveDayRow {
  return {
    date,
    fraction: 1,
    kind: "vacation",
    trekEntryId: 1,
    origin: "trek",
    note: null,
    pendingOp: "none",
    syncedAt: null,
  };
}

function monthOf(rows: { month: string }[], month: string) {
  return rows.find((r) => r.month === month);
}

beforeEach(() => {
  vi.clearAllMocks();
  principal.connected = true;
  repo.daysInYear.mockResolvedValue([]);
  repo.earliestDate.mockResolvedValue(null);
  payroll.leaveTakenByMonth.mockReturnValue([]);
  vacation.hoursPerDay.mockResolvedValue(8);
  // Latest verified payslip is September 2027 (= "today"), so the planned/actual
  // boundary P lets every earlier month be compared. Individual tests that care
  // about P override this. `leaveTakenByMonth` is mocked separately, so the
  // actuals a test injects are independent of this list.
  payslips.verifiedPayslips.mockResolvedValue([
    { month: "2027-09-01", isThirteenth: false } as never,
  ]);
});

describe("loadLeaveCalendar — calendar coverage", () => {
  beforeEach(() => {
    // The calendar has existed since May 2026. The year on screen is 2027, and
    // its first booking is 12 June — months and months after January.
    repo.earliestDate.mockResolvedValue("2026-05-10");
    repo.daysInYear.mockResolvedValue([day("2027-06-12"), day("2027-06-15")]);
  });

  it("flags a payslip month the calendar covered but nothing was booked in", async () => {
    payroll.leaveTakenByMonth.mockReturnValue([
      { month: "2027-02-01", totalHours: 16, totalDays: 2 },
    ] as never);

    const view = await loadLeaveCalendar(2027);

    const february = monthOf(view.variance, "2027-02-01");
    expect(february).toMatchObject({ plannedDays: 0, actualDays: 2, status: "over", flagged: true });
    expect(view.flagged.map((f) => f.month)).toContain("2027-02-01");
  });

  it("still reports no_calendar for a month older than the whole mirror", async () => {
    payroll.leaveTakenByMonth.mockReturnValue([
      { month: "2026-03-01", totalHours: 8, totalDays: 1 },
    ] as never);

    const view = await loadLeaveCalendar(2027);

    expect(monthOf(view.variance, "2026-03-01")).toMatchObject({
      status: "no_calendar",
      flagged: false,
    });
  });

  it("asks the repo for the oldest day of ALL years, not just the one displayed", async () => {
    await loadLeaveCalendar(2027);

    expect(repo.earliestDate).toHaveBeenCalledTimes(1);
    expect(repo.daysInYear).toHaveBeenCalledWith(2027);
  });

  it("leaves a covered month with neither plan nor payslip out of the flags", async () => {
    const view = await loadLeaveCalendar(2027);

    expect(view.flagged).toEqual([]);
  });
});

describe("loadLeaveCalendar — the payslip boundary (planned vs actual)", () => {
  // The owner's rule: an Italian payslip records the leave taken the month
  // BEFORE it, so August's vacation is only booked by the SEPTEMBER payslip.
  // Until September's payslip is verified, August must read "previsto".
  beforeEach(() => {
    repo.earliestDate.mockResolvedValue("2026-01-01");
    // The latest verified payslip is August 2026 (its OWN month). The boundary
    // must come from this month, not from the already-shifted actual months.
    payslips.verifiedPayslips.mockResolvedValue([
      { month: "2026-07-01", isThirteenth: false },
      { month: "2026-08-01", isThirteenth: false },
    ] as never);
    // The August payslip reports July's usage (shifted back one month).
    payroll.leaveTakenByMonth.mockReturnValue([
      { month: "2026-07-01", totalHours: 12, totalDays: 1.5 },
    ] as never);
    // Both July and August have days booked on the calendar.
    repo.daysInYear.mockResolvedValue([
      day("2026-07-10"),
      { ...day("2026-07-11"), fraction: 0.5 as const },
      day("2026-08-14"),
    ]);
  });

  it("keeps August planned — its covering September payslip has not arrived", async () => {
    const view = await loadLeaveCalendar(2026);

    expect(monthOf(view.variance, "2026-08-01")).toMatchObject({
      status: "planned",
      actualDays: null,
      flagged: false,
    });
    expect(view.flagged.map((f) => f.month)).not.toContain("2026-08-01");
  });

  it("compares July, whose covering August payslip IS verified", async () => {
    const view = await loadLeaveCalendar(2026);

    // 1.5 planned (a full + a half) against 12 h = 1.5 actual → an exact match.
    expect(monthOf(view.variance, "2026-07-01")).toMatchObject({
      status: "match",
      actualDays: 1.5,
      flagged: false,
    });
  });

  it("treats every month as planned when no payslip is verified yet", async () => {
    payslips.verifiedPayslips.mockResolvedValue([]);
    payroll.leaveTakenByMonth.mockReturnValue([]);

    const view = await loadLeaveCalendar(2026);

    expect(view.variance.every((r) => r.status === "planned")).toBe(true);
    expect(view.flagged).toEqual([]);
  });

  // The calendar TONE must follow the same payslip boundary as the variance
  // table, not the calendar date. These pin the owner's bug: "Work mostra
  // ancora agosto come taken invece di planned."
  it("draws August's day as planned on the calendar — its September payslip has not arrived", async () => {
    const view = await loadLeaveCalendar(2026);

    const august = view.months.find((m) => m.month === "2026-08");
    // P = August 2026, so August is at/after the boundary → still "previsto",
    // even though the day is in the past. The old `d.date > today` rule marked
    // it "taken"; this assertion fails against that rule.
    expect(august?.days).toEqual([
      expect.objectContaining({ date: "2026-08-14", tone: "planned" }),
    ]);
  });

  it("draws July's days as taken — its covering August payslip is verified", async () => {
    const view = await loadLeaveCalendar(2026);

    const july = view.months.find((m) => m.month === "2026-07");
    expect(july?.days.length).toBeGreaterThan(0);
    expect(july?.days.every((d) => d.tone === "taken")).toBe(true);
  });

  it("draws every booked day as planned when no payslip is verified", async () => {
    payslips.verifiedPayslips.mockResolvedValue([]);
    payroll.leaveTakenByMonth.mockReturnValue([]);

    const view = await loadLeaveCalendar(2026);

    const tones = view.months.flatMap((m) => m.days.map((d) => d.tone));
    expect(tones.length).toBeGreaterThan(0);
    expect(tones.every((t) => t === "planned")).toBe(true);
  });
});

describe("loadLeaveCalendar — the rest of the view", () => {
  it("hides a day staged for deletion, which is already gone to the owner", async () => {
    repo.earliestDate.mockResolvedValue("2027-06-12");
    repo.daysInYear.mockResolvedValue([
      day("2027-06-12"),
      { ...day("2027-06-15"), pendingOp: "delete" as const },
    ]);

    const view = await loadLeaveCalendar(2027);

    const june = view.months.find((m) => m.month === "2027-06");
    expect(june?.days.map((d) => d.date)).toEqual(["2027-06-12"]);
    expect(view.plannedDaysYtd).toBe(1);
    // Still counted as pending work, though: the removal has not reached Trek.
    expect(view.pendingCount).toBe(1);
  });
});
