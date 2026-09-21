import { describe, expect, it } from "vitest";
import { italianHolidays } from "@/platform/holidays/rules";
import {
  LEAVE_DAY_KINDS,
  type LeaveDayKind,
  type LeaveDayView,
  type ResidualView,
  allowanceMismatchDays,
  bookable,
  calendar,
  datesBetween,
  dayStatus,
  dayWeight,
  daysToMinutes,
  goesToTrek,
  leaveInputSchema,
  minuteWeight,
  minutesToDays,
  accrualPerWorkingDay,
  monthBars,
  overdrawn,
  workingDaysOf,
  residual,
  unrecordedLeave,
  yearTotals,
} from "./rules";

/** Seven hours a day, as the owner's contract has it: nothing here assumes eight. */
const MINUTES_PER_DAY = 420;

/**
 * Through April, which is what a May payslip accounts for. Everything on this screen is split by
 * the payslips rather than by the calendar (N2), so the tests state a month and never "today".
 */
const COUNTED_THROUGH = "2026-04-01";

function day(on: string, kind: LeaveDayKind, fraction = 1): LeaveDayView {
  return { on, kind, fraction };
}
function vacation(on: string, fraction = 1): LeaveDayView {
  return day(on, "vacation", fraction);
}
function rol(on: string, fraction = 1): LeaveDayView {
  return day(on, "rol", fraction);
}

/** A day's worth of minutes, and an hour's, so a test can state "26 days" without the arithmetic. */
const d = (count: number) => count * MINUTES_PER_DAY;
const h = (count: number) => count * 60;

describe("conversions (plan §3.4.4)", () => {
  it("converts minutes to days at the user's own day length", () => {
    expect(minutesToDays(420, MINUTES_PER_DAY)).toBe(1);
    expect(minutesToDays(210, MINUTES_PER_DAY)).toBe(0.5);
    expect(minutesToDays(840, MINUTES_PER_DAY)).toBe(2);
    // A different contract gives a different answer for the same minutes: no "8 hours" anywhere.
    expect(minutesToDays(480, 480)).toBe(1);
    expect(minutesToDays(480, MINUTES_PER_DAY)).toBe(1);
  });

  it("rounds to the half day, which is the only granularity a day has", () => {
    expect(minutesToDays(100, MINUTES_PER_DAY)).toBe(0);
    expect(minutesToDays(160, MINUTES_PER_DAY)).toBe(0.5);
  });

  it("converts days back to minutes", () => {
    expect(daysToMinutes(1, MINUTES_PER_DAY)).toBe(420);
    expect(daysToMinutes(0.5, MINUTES_PER_DAY)).toBe(210);
    expect(daysToMinutes(0.5, 435)).toBe(218);
  });

  it("refuses a day length that is not a length", () => {
    expect(() => minutesToDays(60, 0)).toThrow(RangeError);
    expect(() => daysToMinutes(1, -1)).toThrow(RangeError);
  });
});

describe("bookable (spec §7.9)", () => {
  /** The days this person does not work, as their calendars resolved them (M3). */
  const MILAN = new Set(italianHolidays(2026, { month: 12, day: 7 }).map((holiday) => holiday.date));

  it("accepts an ordinary working day", () => {
    expect(bookable("2026-06-16", MILAN)).toEqual({ ok: true });
  });

  it("refuses a weekend, and says it is a weekend", () => {
    expect(bookable("2026-06-13", MILAN)).toEqual({ ok: false, reason: "weekend" });
    expect(bookable("2026-06-14", MILAN)).toEqual({ ok: false, reason: "weekend" });
  });

  it("refuses a public holiday, computed ones included", () => {
    expect(bookable("2026-01-01", MILAN)).toEqual({ ok: false, reason: "holiday" });
    expect(bookable("2026-06-02", MILAN)).toEqual({ ok: false, reason: "holiday" });
    // Easter Monday 2026 is 6 April: a Monday nobody works, and not on any fixed list.
    expect(bookable("2026-04-06", MILAN)).toEqual({ ok: false, reason: "holiday" });
  });

  it("calls a holiday that lands on a weekend a weekend: the earlier reason wins", () => {
    // 15 August 2026 is a Saturday. Either reason is true; the one the form shows is the one the
    // user can do something about, and "it is a Saturday" is the plainer of the two.
    expect(bookable("2026-08-15", MILAN)).toEqual({ ok: false, reason: "weekend" });
  });

  it("refuses the patron saint of the user's own town, and only theirs", () => {
    // 7 December 2026 is a Monday, so the weekend is not what is refusing it.
    expect(bookable("2026-12-07", MILAN)).toEqual({ ok: false, reason: "holiday" });
    expect(bookable("2026-12-07", new Set(["2026-06-24"]))).toEqual({ ok: true });
    expect(bookable("2026-12-07", new Set())).toEqual({ ok: true });
  });
});

describe("dayStatus (N2)", () => {
  it("takes nothing for granted until a payslip has counted something", () => {
    // No payslip at all: the employer's numbers have never been seen, so nothing is "taken" —
    // not even a day ten years old. It used to be "the past is taken", which said the wrong thing.
    expect(dayStatus("2016-01-04", null)).toBe("planned");
    expect(dayStatus("2026-06-15", null)).toBe("planned");
  });

  it("counts a day taken once a payslip accounts for its month", () => {
    expect(dayStatus("2026-04-01", COUNTED_THROUGH)).toBe("taken");
    // The whole month counts, ends included: a payslip accounts for months, never for days.
    expect(dayStatus("2026-04-30", COUNTED_THROUGH)).toBe("taken");
    expect(dayStatus("2026-01-05", COUNTED_THROUGH)).toBe("taken");
    // A year the payslips have long passed is counted too.
    expect(dayStatus("2025-12-31", COUNTED_THROUGH)).toBe("taken");
  });

  it("leaves a month no payslip has reached planned, however far in the past it is", () => {
    expect(dayStatus("2026-05-01", COUNTED_THROUGH)).toBe("planned");
    // The leave taken last week is not leave anybody has counted: the RES. the payslip printed
    // knows nothing about it, and calling it "taken" would subtract it twice.
    expect(dayStatus("2026-06-15", COUNTED_THROUGH)).toBe("planned");
    expect(dayStatus("2026-12-31", COUNTED_THROUGH)).toBe("planned");
  });
});

describe("what a day is worth (N0)", () => {
  it("is its fraction in days, and that fraction of this person's day in minutes", () => {
    expect(dayWeight(vacation("2026-02-10"))).toBe(1);
    expect(dayWeight(rol("2026-02-10", 0.5))).toBe(0.5);
    expect(minuteWeight(vacation("2026-02-10"), MINUTES_PER_DAY)).toBe(420);
    // A half day of ROL is half of *this* contract's day, not half of eight hours.
    expect(minuteWeight(rol("2026-02-10", 0.5), MINUTES_PER_DAY)).toBe(210);
    expect(minuteWeight(rol("2026-02-10", 0.5), 480)).toBe(240);
  });
});

describe("goesToTrek (N4)", () => {
  it("is true for the leave that spends the allowance, ROL included", () => {
    expect(goesToTrek("vacation")).toBe(true);
    expect(goesToTrek("comp")).toBe(true);
    expect(goesToTrek("rol")).toBe(true);
  });

  it("is false for the absences that are not leave anybody books", () => {
    expect(goesToTrek("sick")).toBe(false);
    expect(goesToTrek("other")).toBe(false);
  });
});

describe("residual (spec §7.9, the binding rule)", () => {
  const days = [vacation("2026-02-10"), vacation("2026-05-04"), vacation("2026-07-20", 0.5)];
  // Against `COUNTED_THROUGH`: February is counted, May and the half day in July are not.
  const TAKEN = d(1);
  const PLANNED = d(1.5);

  it("without a snapshot, is allowance + carried − taken − planned, and says so", () => {
    expect(
      residual({
        snapshot: null,
        allowanceMinutes: d(26),
        carriedMinutes: d(3),
        days,
        countedThrough: COUNTED_THROUGH,
        minutesPerDay: MINUTES_PER_DAY,
      }),
    ).toEqual({
      basis: "allowance",
      remainingMinutes: d(26 + 3 - 1 - 1.5),
      takenMinutes: TAKEN,
      plannedMinutes: PLANNED,
      snapshotPeriod: null,
      countedThrough: COUNTED_THROUGH,
    });
  });

  it("with no payslip at all, has taken nothing and planned everything", () => {
    const view = residual({
      snapshot: null,
      allowanceMinutes: d(26),
      carriedMinutes: 0,
      days,
      countedThrough: null,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(view.takenMinutes).toBe(0);
    expect(view.plannedMinutes).toBe(d(2.5));
    // The residual is the same either way: both halves are subtracted.
    expect(view.remainingMinutes).toBe(d(26 - 2.5));
    expect(view.countedThrough).toBeNull();
  });

  it("with a snapshot, takes the payslip's RES. and subtracts only the days it has not counted", () => {
    // A May payslip accounts for use through April, so the February day is already inside its
    // RES. and must not be subtracted again; the May and July days are not, and are.
    const view = residual({
      snapshot: { period: "2026-05-01", remainingHours: 84 },
      allowanceMinutes: d(26),
      carriedMinutes: d(3),
      days,
      countedThrough: COUNTED_THROUGH,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(view.basis).toBe("payslip");
    expect(view.snapshotPeriod).toBe("2026-05-01");
    expect(view.countedThrough).toBe(COUNTED_THROUGH);
    expect(view.remainingMinutes).toBe(h(84) - PLANNED);
    expect(view.takenMinutes).toBe(TAKEN);
    expect(view.plannedMinutes).toBe(PLANNED);
  });

  it("with a snapshot, ignores the allowance and the carry-over alike", () => {
    // A.P. + MAT. − GOD. = RES.: the previous years are already inside the printed figure, so
    // adding the carry-over on top of it would count them twice.
    const stated = residual({
      snapshot: { period: "2026-05-01", remainingHours: 84 },
      allowanceMinutes: d(26),
      carriedMinutes: d(3),
      days,
      countedThrough: COUNTED_THROUGH,
      minutesPerDay: MINUTES_PER_DAY,
    });
    const unstated = residual({
      snapshot: { period: "2026-05-01", remainingHours: 84 },
      allowanceMinutes: null,
      carriedMinutes: 0,
      days,
      countedThrough: COUNTED_THROUGH,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(unstated.remainingMinutes).toBe(stated.remainingMinutes);
    expect(unstated.basis).toBe("payslip");
  });

  it("subtracts a day the payslip has not reached, whichever month it is in", () => {
    // A January payslip accounts for the December before it: everything of 2026 is still planned.
    const view = residual({
      snapshot: { period: "2026-01-01", remainingHours: 70 },
      allowanceMinutes: null,
      carriedMinutes: 0,
      days: [vacation("2026-03-02")],
      countedThrough: "2025-12-01",
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(view.countedThrough).toBe("2025-12-01");
    expect(view.takenMinutes).toBe(0);
    expect(view.remainingMinutes).toBe(h(70) - d(1));
  });

  it("is unknown, not zero, with neither a snapshot nor an allowance", () => {
    const view = residual({
      snapshot: null,
      allowanceMinutes: null,
      carriedMinutes: 0,
      days,
      countedThrough: COUNTED_THROUGH,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(view.basis).toBe("unknown");
    expect(view.remainingMinutes).toBeNull();
    // What is known is still reported: only the residual is unknown.
    expect(view.takenMinutes).toBe(TAKEN);
    expect(view.plannedMinutes).toBe(PLANNED);
  });

  it("counts a ROL carry-over into the residual, exactly as a vacation one (N1)", () => {
    const rolDays = [rol("2026-02-10", 0.5)];
    const carried = residual({
      snapshot: null,
      allowanceMinutes: h(32),
      carriedMinutes: h(6),
      days: rolDays,
      countedThrough: COUNTED_THROUGH,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(carried.remainingMinutes).toBe(h(32) + h(6) - 210);

    // The bug this guards: the ROL carry-over used to be left at zero, which simply made the
    // residual six hours too small for anybody who had hours left from last year.
    const dropped = residual({
      snapshot: null,
      allowanceMinutes: h(32),
      carriedMinutes: 0,
      days: rolDays,
      countedThrough: COUNTED_THROUGH,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect((carried.remainingMinutes as number) - (dropped.remainingMinutes as number)).toBe(h(6));
  });

  it("weighs ROL in half and whole days like every other kind, against a ROL allowance in minutes", () => {
    const view = residual({
      snapshot: null,
      allowanceMinutes: h(32),
      carriedMinutes: 0,
      days: [rol("2026-02-10", 0.5), rol("2026-09-10")],
      countedThrough: COUNTED_THROUGH,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(view.takenMinutes).toBe(210);
    expect(view.plannedMinutes).toBe(420);
    expect(view.remainingMinutes).toBe(h(32) - 210 - 420);
    // Still to the minute on the way out: 21½ hours is a number a payslip could have printed.
    expect((view.remainingMinutes as number) / 60).toBe(21.5);
  });
});

describe("monthBars", () => {
  it("gives twelve bars, taken and planned apart, and drops other years", () => {
    const bars = monthBars(
      [vacation("2026-02-10"), vacation("2026-02-11"), vacation("2026-08-03"), vacation("2025-02-10")],
      2026,
      MINUTES_PER_DAY,
      COUNTED_THROUGH,
    );
    expect(bars).toHaveLength(12);
    expect(bars[1]).toEqual({ month: 2, takenMinutes: 2 * MINUTES_PER_DAY, plannedMinutes: 0 });
    expect(bars[7]).toEqual({ month: 8, takenMinutes: 0, plannedMinutes: MINUTES_PER_DAY });
    expect(bars[0]).toEqual({ month: 1, takenMinutes: 0, plannedMinutes: 0 });
  });

  it("keeps a half day of ROL to half a day's minutes, so the bars stay comparable", () => {
    const bars = monthBars([rol("2026-03-04", 0.5)], 2026, MINUTES_PER_DAY, COUNTED_THROUGH);
    expect(bars[2]).toEqual({ month: 3, takenMinutes: 210, plannedMinutes: 0 });
  });

  it("plans the whole year for somebody whose payslips this app has never seen", () => {
    const bars = monthBars([vacation("2026-02-10")], 2026, MINUTES_PER_DAY, null);
    expect(bars[1]).toEqual({ month: 2, takenMinutes: 0, plannedMinutes: MINUTES_PER_DAY });
  });
});

describe("calendar", () => {
  const MILAN = new Set(italianHolidays(2026, { month: 12, day: 7 }).map((holiday) => holiday.date));

  it("gives twelve months of whole weeks", () => {
    const months = calendar(2026, [], MILAN, 1, COUNTED_THROUGH, MINUTES_PER_DAY);
    expect(months).toHaveLength(12);
    for (const month of months) {
      for (const week of month.weeks) expect(week).toHaveLength(7);
    }
  });

  it("starts the week where the user's preferences say", () => {
    // 1 January 2026 is a Thursday.
    const monday = calendar(2026, [], MILAN, 1, COUNTED_THROUGH, MINUTES_PER_DAY)[0];
    expect(monday.weeks[0].slice(0, 3).every((cell) => cell.date === null)).toBe(true);
    expect(monday.weeks[0][3].date).toBe("2026-01-01");

    const sunday = calendar(2026, [], MILAN, 0, COUNTED_THROUGH, MINUTES_PER_DAY)[0];
    expect(sunday.weeks[0][4].date).toBe("2026-01-01");
  });

  it("holds every day of the month exactly once", () => {
    const february = calendar(2026, [], MILAN, 1, COUNTED_THROUGH, MINUTES_PER_DAY)[1];
    const dates = february.weeks.flat().filter((cell) => cell.date !== null);
    expect(dates).toHaveLength(28);
    expect(new Set(dates.map((cell) => cell.date)).size).toBe(28);
  });

  it("marks weekends and holidays, and carries the kinds of a day", () => {
    const months = calendar(
      2026,
      [vacation("2026-01-02"), rol("2026-01-02", 0.5)],
      MILAN,
      1,
      COUNTED_THROUGH,
      MINUTES_PER_DAY,
    );
    const cells = months[0].weeks.flat();
    const second = cells.find((cell) => cell.date === "2026-01-02");
    expect(second).toMatchObject({ kinds: ["vacation", "rol"], status: "taken", weekend: false });
    expect(cells.find((cell) => cell.date === "2026-01-01")).toMatchObject({ holiday: true, kinds: [] });
    expect(cells.find((cell) => cell.date === "2026-01-03")).toMatchObject({ weekend: true });
  });

  it("marks a day that is not a whole day as partial", () => {
    const months = calendar(
      2026,
      [vacation("2026-01-02", 0.5), vacation("2026-01-05", 1)],
      MILAN,
      1,
      COUNTED_THROUGH,
      MINUTES_PER_DAY,
    );
    const cells = months[0].weeks.flat();
    expect(cells.find((cell) => cell.date === "2026-01-02")?.partial).toBe(true);
    expect(cells.find((cell) => cell.date === "2026-01-05")?.partial).toBe(false);
  });

  it("adds two halves of the same day into a whole one", () => {
    // Half a day of vacation and half a day of ROL is a whole day off, not two partial ones.
    const months = calendar(
      2026,
      [vacation("2026-01-02", 0.5), rol("2026-01-02", 0.5)],
      MILAN,
      1,
      COUNTED_THROUGH,
      MINUTES_PER_DAY,
    );
    const cell = months[0].weeks.flat().find((c) => c.date === "2026-01-02");
    expect(cell?.partial).toBe(false);
    expect(cell?.kinds).toEqual(["vacation", "rol"]);
  });

  it("marks a day no payslip has counted planned, whether it is to come or already past", () => {
    const months = calendar(
      2026,
      [vacation("2026-08-03"), vacation("2026-05-04")],
      MILAN,
      1,
      COUNTED_THROUGH,
      MINUTES_PER_DAY,
    );
    expect(months[7].weeks.flat().find((c) => c.date === "2026-08-03")?.status).toBe("planned");
    expect(months[4].weeks.flat().find((c) => c.date === "2026-05-04")?.status).toBe("planned");

    // And with no payslip at all, even January is still only planned.
    const none = calendar(2026, [vacation("2026-01-02")], MILAN, 1, null, MINUTES_PER_DAY);
    expect(none[0].weeks.flat().find((c) => c.date === "2026-01-02")?.status).toBe("planned");
  });
});

describe("datesBetween", () => {
  it("includes both ends, and a single day is one day", () => {
    expect(datesBetween("2026-06-15", "2026-06-18")).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
    ]);
    expect(datesBetween("2026-06-15", "2026-06-15")).toEqual(["2026-06-15"]);
  });

  it("crosses a month and a year", () => {
    expect(datesBetween("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
  });
});

describe("leaveInputSchema", () => {
  const base = { from: "2026-06-16", kind: "vacation" as const, fraction: 1 };

  it("accepts a day and a range", () => {
    expect(leaveInputSchema.safeParse(base).success).toBe(true);
    expect(leaveInputSchema.safeParse({ ...base, to: "2026-06-18" }).success).toBe(true);
  });

  it("refuses a range that ends before it begins", () => {
    expect(leaveInputSchema.safeParse({ ...base, to: "2026-06-15" }).success).toBe(false);
  });

  it("books every kind in the same unit, ROL included (N0)", () => {
    // ROL used to be the exception, stated in free-form minutes. Nobody books leave by the minute,
    // and a form with two units in it was a form nobody could read.
    for (const kind of LEAVE_DAY_KINDS) {
      expect(leaveInputSchema.safeParse({ from: base.from, kind, fraction: 1 }).success).toBe(true);
      expect(leaveInputSchema.safeParse({ from: base.from, kind, fraction: 0.5 }).success).toBe(true);
    }
  });

  it("allows only a whole or a half day", () => {
    expect(leaveInputSchema.safeParse({ ...base, fraction: 0.5 }).success).toBe(true);
    expect(leaveInputSchema.safeParse({ ...base, fraction: 0.25 }).success).toBe(false);
    expect(leaveInputSchema.safeParse({ ...base, fraction: 2 }).success).toBe(false);
    expect(leaveInputSchema.safeParse({ from: base.from, kind: "rol", fraction: 0.25 }).success).toBe(false);
  });

  it("takes a whole day when no fraction is stated", () => {
    const parsed = leaveInputSchema.safeParse({ from: base.from, kind: "rol" });
    expect(parsed.success).toBe(true);
  });

  it("refuses something that is not a date", () => {
    expect(leaveInputSchema.safeParse({ ...base, from: "2026-02-30" }).success).toBe(false);
    expect(leaveInputSchema.safeParse({ ...base, from: "16/06/2026" }).success).toBe(false);
  });
});

describe("unrecordedLeave (M2)", () => {
  it("reports a month where the payslip counted more than the calendar holds", () => {
    // April: the payslip says 16 h of vacation; only one seven-hour day is written down.
    expect(
      unrecordedLeave(
        [{ kind: "vacation", hours: 16, usagePeriod: "2026-04-01" }],
        [vacation("2026-04-07")],
        MINUTES_PER_DAY,
      ),
    ).toEqual([
      {
        month: "2026-04-01",
        kind: "vacation",
        payrollMinutes: h(16),
        recordedMinutes: MINUTES_PER_DAY,
        missingMinutes: h(16) - MINUTES_PER_DAY,
      },
    ]);
  });

  it("says nothing when the two agree", () => {
    expect(
      unrecordedLeave(
        [{ kind: "vacation", hours: 14, usagePeriod: "2026-04-01" }],
        [vacation("2026-04-07"), vacation("2026-04-08")],
        MINUTES_PER_DAY,
      ),
    ).toEqual([]);
  });

  it("says nothing when the calendar holds MORE than the payslip counted", () => {
    // The ordinary state of a month whose payslip has not arrived yet: not news.
    expect(
      unrecordedLeave(
        [{ kind: "vacation", hours: 7, usagePeriod: "2026-04-01" }],
        [vacation("2026-04-07"), vacation("2026-04-08")],
        MINUTES_PER_DAY,
      ),
    ).toEqual([]);
  });

  it("counts a payroll permit against ROL, which is the kind it is confirmed as", () => {
    const gaps = unrecordedLeave(
      [
        { kind: "permit", hours: 4, usagePeriod: "2026-04-01" },
        { kind: "rol", hours: 3, usagePeriod: "2026-04-01" },
      ],
      [rol("2026-04-07", 0.5)],
      MINUTES_PER_DAY,
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ kind: "rol", payrollMinutes: h(7), recordedMinutes: 210 });
  });

  it("keeps the months and the kinds apart, oldest first", () => {
    const gaps = unrecordedLeave(
      [
        { kind: "vacation", hours: 7, usagePeriod: "2026-05-01" },
        { kind: "rol", hours: 2, usagePeriod: "2026-04-01" },
        { kind: "vacation", hours: 7, usagePeriod: "2026-04-01" },
      ],
      [],
      MINUTES_PER_DAY,
    );
    expect(gaps.map((gap) => [gap.month, gap.kind])).toEqual([
      ["2026-04-01", "rol"],
      ["2026-04-01", "vacation"],
      ["2026-05-01", "vacation"],
    ]);
  });

  it("does not count a day of another kind towards the gap", () => {
    // A sick day in April is not a vacation day: it must not paper over the missing one.
    const gaps = unrecordedLeave(
      [{ kind: "vacation", hours: 7, usagePeriod: "2026-04-01" }],
      [day("2026-04-07", "sick")],
      MINUTES_PER_DAY,
    );
    expect(gaps[0]).toMatchObject({ recordedMinutes: 0, missingMinutes: MINUTES_PER_DAY });
  });

  it("forgives a minute of rounding between the two units", () => {
    // 7.0166 h ≈ 421 minutes against a 420-minute day: not a missing day.
    expect(
      unrecordedLeave(
        [{ kind: "vacation", hours: 7.0166, usagePeriod: "2026-04-01" }],
        [vacation("2026-04-07")],
        MINUTES_PER_DAY,
      ),
    ).toEqual([]);
  });
});

describe("yearTotals (N5)", () => {
  const days = [
    vacation("2026-02-10"),
    vacation("2026-07-20", 0.5),
    rol("2026-03-04", 0.5),
    day("2026-02-12", "sick"),
  ];

  it("splits the year by what the payslips have counted, not by the calendar", () => {
    const totals = yearTotals(days, COUNTED_THROUGH, MINUTES_PER_DAY);
    // February's day and sick day, and March's half day of ROL.
    expect(totals.takenMinutes).toBe(d(2) + 210);
    // July, which no payslip has reached.
    expect(totals.plannedMinutes).toBe(d(0.5));
    expect(totals.totalMinutes).toBe(d(2.5) + 210);
  });

  it("counts every kind, because a week of sickness is still a week away", () => {
    const totals = yearTotals(days, COUNTED_THROUGH, MINUTES_PER_DAY);
    // In the order `LEAVE_DAY_KINDS` declares, and only the kinds with something in them: no
    // `comp` and no `other` row for a year that has neither.
    expect(totals.byKind).toEqual([
      { kind: "vacation", minutes: d(1.5) },
      { kind: "rol", minutes: 210 },
      { kind: "sick", minutes: d(1) },
    ]);
  });

  it("plans everything, and takes nothing, when no payslip has counted a month", () => {
    const totals = yearTotals(days, null, MINUTES_PER_DAY);
    expect(totals.takenMinutes).toBe(0);
    expect(totals.plannedMinutes).toBe(d(2.5) + 210);
    // The breakdown does not care which side a day fell on: the year is the year.
    expect(totals.byKind).toEqual(yearTotals(days, COUNTED_THROUGH, MINUTES_PER_DAY).byKind);
  });

  it("is all zeroes for a year with nothing in it", () => {
    expect(yearTotals([], COUNTED_THROUGH, MINUTES_PER_DAY)).toEqual({
      takenMinutes: 0,
      plannedMinutes: 0,
      totalMinutes: 0,
      byKind: [],
    });
  });
});

describe("workingDaysOf and the accrual (N9)", () => {
  const HOLIDAYS = new Set(italianHolidays(2026, null).map((one) => one.date));

  it("counts the days actually worked: no weekends, none of this person's holidays", () => {
    const working = workingDaysOf(2026, HOLIDAYS);
    expect(working).not.toContain("2026-06-13"); // a Saturday
    expect(working).not.toContain("2026-06-02"); // Republic Day, a Tuesday
    expect(working).toContain("2026-06-16");
    // Ascending, because the accrual walks it once alongside the days off.
    expect([...working].sort()).toEqual(working);
  });

  it("spreads a grant over the days worked, and has no rate without a grant", () => {
    const working = workingDaysOf(2026, HOLIDAYS).length;
    expect(accrualPerWorkingDay(d(26), working)).toBeCloseTo(d(26) / working, 8);
    // Nobody stated an allowance: the honest rate is none, not one of our own invention.
    expect(accrualPerWorkingDay(null, working)).toBe(0);
    expect(accrualPerWorkingDay(d(26), 0)).toBe(0);
  });
});

describe("overdrawn (N5b, N9)", () => {
  const HOLIDAYS = new Set(italianHolidays(2026, null).map((one) => one.date));
  const WORKING = workingDaysOf(2026, HOLIDAYS);

  const view = (over: Partial<ResidualView>): ResidualView => ({
    basis: "allowance",
    remainingMinutes: 0,
    takenMinutes: 0,
    plannedMinutes: 0,
    snapshotPeriod: null,
    countedThrough: COUNTED_THROUGH,
    ...over,
  });

  /** No allowance stated, so no rate: the plain year-end figure is all there is to go on. */
  const flat = (residualView: ResidualView) =>
    overdrawn("vacation", {
      view: residualView,
      allowanceMinutes: null,
      carriedMinutes: 0,
      workingDays: WORKING,
      planned: [],
      minutesPerDay: MINUTES_PER_DAY,
    });

  it("says nothing about a residual nobody can compute", () => {
    // There is no number to go past, and inventing one to complain about would be worse than
    // saying nothing at all.
    expect(flat(view({ basis: "unknown", remainingMinutes: null }))).toBeNull();
  });

  it("says nothing while there is something left, nothing left included", () => {
    expect(flat(view({ remainingMinutes: d(3) }))).toBeNull();
    expect(flat(view({ remainingMinutes: 0 }))).toBeNull();
  });

  it("measures how far past zero it went, always as a positive number", () => {
    expect(flat(view({ remainingMinutes: -d(1.5) }))).toEqual({
      kind: "vacation",
      byMinutes: d(1.5),
      basis: "allowance",
      snapshotPeriod: null,
      // No rate, so no day to name: the warning says only that the year does not add up.
      onDate: null,
    });
  });

  it("reports the number it went past, so the warning and the card cannot disagree", () => {
    expect(flat(view({ basis: "payslip", remainingMinutes: -210, snapshotPeriod: "2026-05-01" }))).toEqual({
      kind: "vacation",
      byMinutes: 210,
      basis: "payslip",
      snapshotPeriod: "2026-05-01",
      onDate: null,
    });
  });

  it("stays quiet when the year will have granted the days by the time they are taken (N9)", () => {
    // Two weeks in December against a May balance of five days. The plain arithmetic says four
    // days over; the year says seven more months of work will have granted far more than that,
    // and a warning in May about December is a warning people learn to ignore.
    const planned = datesBetween("2026-12-07", "2026-12-18")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    expect(
      overdrawn("vacation", {
        view: view({
          basis: "payslip",
          remainingMinutes: d(5) - plannedMinutes,
          plannedMinutes,
          snapshotPeriod: "2026-05-01",
        }),
        allowanceMinutes: d(26),
        carriedMinutes: 0,
        workingDays: WORKING,
        planned,
        minutesPerDay: MINUTES_PER_DAY,
      }),
    ).toBeNull();
  });

  it("still warns about days taken before they are earned, and names the day (N9)", () => {
    // The same two weeks, but in June: five days of balance and barely a month of accrual behind
    // them cannot cover ten, whatever December would have.
    const planned = datesBetween("2026-06-08", "2026-06-19")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    const over = overdrawn("vacation", {
      view: view({
        basis: "payslip",
        remainingMinutes: d(5) - plannedMinutes,
        plannedMinutes,
        snapshotPeriod: "2026-05-01",
      }),
      allowanceMinutes: d(26),
      carriedMinutes: 0,
      workingDays: WORKING,
      planned,
      minutesPerDay: MINUTES_PER_DAY,
    });

    expect(over).not.toBeNull();
    expect(over?.basis).toBe("payslip");
    // The day the shortfall is at its worst, which is the day to move — not a bare "you are over".
    expect(over?.onDate).toBe(planned.at(-1)?.on);
    expect(over?.byMinutes).toBeGreaterThan(0);
    expect(over?.byMinutes).toBeLessThan(plannedMinutes - d(5));
  });

  it("never counts the payslip's own month twice", () => {
    // A May payslip's RES. already has May's accrual inside it (A.P. + MAT. − GOD. = RES.), so a
    // day in May is spent against the balance as printed and accrues nothing further.
    const planned = [vacation("2026-05-20"), vacation("2026-05-21")];
    const over = overdrawn("vacation", {
      view: view({
        basis: "payslip",
        remainingMinutes: d(1) - d(2),
        plannedMinutes: d(2),
        snapshotPeriod: "2026-05-01",
      }),
      allowanceMinutes: d(26),
      carriedMinutes: 0,
      workingDays: WORKING,
      planned,
      minutesPerDay: MINUTES_PER_DAY,
    });
    expect(over?.byMinutes).toBe(d(1));
    expect(over?.onDate).toBe("2026-05-21");
  });

  it("only ever excuses a warning, it never raises one (N9)", () => {
    // The accrual answers "had these days been earned by then?", and that can only let a booking
    // off. A year that adds up is not a problem whatever order the days come in — anticipating
    // leave is something employers allow, and a screen that complained about it would be wrong.
    const planned = datesBetween("2026-01-05", "2026-01-30")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    expect(
      overdrawn("vacation", {
        view: view({ remainingMinutes: d(26) - plannedMinutes, plannedMinutes, countedThrough: null }),
        allowanceMinutes: d(26),
        carriedMinutes: 0,
        workingDays: WORKING,
        planned,
        minutesPerDay: MINUTES_PER_DAY,
      }),
    ).toBeNull();
  });

  it("spreads a stated allowance over the year rather than granting it in January", () => {
    // Forty days off in the first quarter against a 26-day year: over on any reading, but the
    // figure reported is measured against what the year had actually granted by then.
    const planned = datesBetween("2026-01-05", "2026-03-31")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    const over = overdrawn("vacation", {
      view: view({ remainingMinutes: d(26) - plannedMinutes, plannedMinutes, countedThrough: null }),
      allowanceMinutes: d(26),
      carriedMinutes: 0,
      workingDays: WORKING,
      planned,
      minutesPerDay: MINUTES_PER_DAY,
    });

    expect(over?.basis).toBe("allowance");
    expect(over?.onDate).toBe(planned.at(-1)?.on);
    // Worse than the plain arithmetic, because a quarter of the year has granted a quarter of it.
    expect(over?.byMinutes).toBeGreaterThan(plannedMinutes - d(26));
  });

  it("counts the payslip's carry-over as available from the first day of the year", () => {
    // What last year left over was earned last year: it is there in January, not accrued again.
    const planned = datesBetween("2026-01-05", "2026-03-31")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;
    const input = {
      allowanceMinutes: d(26),
      workingDays: WORKING,
      planned,
      minutesPerDay: MINUTES_PER_DAY,
    };
    const withCarry = overdrawn("vacation", {
      ...input,
      view: view({
        remainingMinutes: d(26) + d(10) - plannedMinutes,
        plannedMinutes,
        countedThrough: null,
      }),
      carriedMinutes: d(10),
    });
    const without = overdrawn("vacation", {
      ...input,
      view: view({ remainingMinutes: d(26) - plannedMinutes, plannedMinutes, countedThrough: null }),
      carriedMinutes: 0,
    });
    expect(without?.byMinutes).toBe((withCarry?.byMinutes as number) + d(10));
  });
});

describe("allowanceMismatchDays (N7, N9)", () => {
  it("says nothing when there is nothing to compare", () => {
    const parts = { vacationDays: 26, rolDays: 4 };
    expect(allowanceMismatchDays({ ...parts, totalDays: null })).toBeNull();
    expect(allowanceMismatchDays({ ...parts, totalDays: 30, vacationDays: null })).toBeNull();
    expect(allowanceMismatchDays({ ...parts, totalDays: 30, rolDays: null })).toBeNull();
  });

  it("says nothing within a tenth of a day, which is rounding between two units", () => {
    expect(allowanceMismatchDays({ totalDays: 30, vacationDays: 26, rolDays: 4 })).toBeNull();
    // 26 days and 4.05 of ROL against a stated 30: a contract's arithmetic, not a mistake.
    expect(allowanceMismatchDays({ totalDays: 30, vacationDays: 26, rolDays: 4.05 })).toBeNull();
  });

  it("is positive when the parts come to more than the total", () => {
    expect(allowanceMismatchDays({ totalDays: 30, vacationDays: 26, rolDays: 5 })).toBeCloseTo(1, 10);
  });

  it("is negative when they come to less", () => {
    expect(allowanceMismatchDays({ totalDays: 32, vacationDays: 26, rolDays: 4 })).toBeCloseTo(-2, 10);
  });

  it("needs no working day at all, now that both parts are stated in days (N9)", () => {
    // ROL used to be minutes, so the comparison went through this person's contract to get back
    // to days. Both sides are days now: the same three figures mean the same thing to everybody.
    expect(allowanceMismatchDays({ totalDays: 31, vacationDays: 26, rolDays: 5 })).toBeNull();
  });
});
