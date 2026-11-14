import { describe, expect, it } from "vitest";
import { italianHolidays } from "@/platform/holidays/rules";
import {
  type AccrualRate,
  type AccruedReading,
  type ForecastInput,
  accrualView,
  forecastAt,
  forecastAtYearEnd,
  forecastChange,
  forecastOpening,
  monthlyRate,
  overdrawn,
} from "./accrual";
import { type LeaveDayView, type ResidualView, bookable, datesBetween } from "./rules";

/** Seven hours a day: nothing here assumes eight. */
const MINUTES_PER_DAY = 420;
const d = (count: number) => count * MINUTES_PER_DAY;

function vacation(on: string, fraction = 1): LeaveDayView {
  return { on, kind: "vacation", fraction };
}

/** A payslip's MAT. for a month: the year's running total, in hours. */
const reading = (period: string, accruedHours: number | null): AccruedReading => ({ period, accruedHours });

/** Two days a month, at seven hours a day. */
const TWO_DAYS: AccrualRate = { minutesPerMonth: d(2), source: "payslip" };

/** A May payslip that printed five days, and whatever is booked after it. */
function fromMay(days: LeaveDayView[] = [], rate: AccrualRate | null = TWO_DAYS): ForecastInput {
  return {
    rate,
    opening: forecastOpening({ period: "2026-05-01", remainingHours: 35 }, 2026),
    days,
    minutesPerDay: MINUTES_PER_DAY,
  };
}

describe("monthlyRate (D1)", () => {
  it("reads a month's accrual as the difference between one payslip's MAT. and the next", () => {
    const rate = monthlyRate(
      [reading("2026-03-01", 42), reading("2026-04-01", 56), reading("2026-05-01", 70)],
      null,
    );
    expect(rate).toEqual({ minutesPerMonth: 14 * 60, source: "payslip" });
  });

  it("takes January's MAT. as January's accrual: the total starts again with the year", () => {
    const rate = monthlyRate([reading("2025-12-01", 168), reading("2026-01-01", 14)], null);
    // December has no payslip before it and gives nothing; January gives its own 14 hours, not −154.
    expect(rate).toEqual({ minutesPerMonth: 14 * 60, source: "payslip" });
  });

  it("is the mean of the differences, because the employer rounds them", () => {
    const rate = monthlyRate(
      [reading("2026-01-01", 14.66), reading("2026-02-01", 29.33), reading("2026-03-01", 44)],
      null,
    );
    expect(rate?.source).toBe("payslip");
    expect(rate?.minutesPerMonth).toBeCloseTo((44 / 3) * 60, 6);
  });

  it("keeps the last twelve differences, so an old rate does not weigh on a new one", () => {
    const old = Array.from({ length: 12 }, (_, index) =>
      reading(`2024-${String(index + 1).padStart(2, "0")}-01`, 10 * (index + 1)),
    );
    const recent = Array.from({ length: 12 }, (_, index) =>
      reading(`2025-${String(index + 1).padStart(2, "0")}-01`, 14 * (index + 1)),
    );
    expect(monthlyRate([...old, ...recent], null)?.minutesPerMonth).toBeCloseTo(14 * 60, 6);
  });

  it("leaves out a month with no payslip before it, and a correction that goes down", () => {
    const rate = monthlyRate(
      [
        reading("2026-02-01", 28),
        reading("2026-03-01", 42),
        // No April payslip: May has nothing to be the difference from.
        reading("2026-05-01", 70),
        // A rectification that lowered the total is not a month that granted less than nothing.
        reading("2026-06-01", 60),
        reading("2026-07-01", 74),
      ],
      null,
    );
    expect(rate?.minutesPerMonth).toBeCloseTo(14 * 60, 6);
  });

  it("lets the last payslip of a month restate it", () => {
    const rate = monthlyRate(
      [reading("2026-01-01", 10), reading("2026-01-01", 14), reading("2026-02-01", 28)],
      null,
    );
    expect(rate?.minutesPerMonth).toBeCloseTo(14 * 60, 6);
  });

  it("falls back to the stated allowance over twelve months, and says so", () => {
    expect(monthlyRate([], d(24))).toEqual({ minutesPerMonth: d(2), source: "allowance" });
    // One payslip that is not January's has no difference to give.
    expect(monthlyRate([reading("2026-03-01", 42)], d(24))?.source).toBe("allowance");
    // A column the payslip leaves empty is not a rate of zero.
    expect(monthlyRate([reading("2026-01-01", null), reading("2026-02-01", null)], d(24))?.source).toBe(
      "allowance",
    );
  });

  it("has no rate with neither a payslip nor an allowance, rather than one of its own invention", () => {
    expect(monthlyRate([], null)).toBeNull();
    expect(monthlyRate([reading("2026-03-01", 42)], null)).toBeNull();
    expect(monthlyRate([], 0)).toBeNull();
  });
});

describe("forecastOpening (D1, D4)", () => {
  it("starts from the last payslip's RES., at the month it was printed for", () => {
    expect(forecastOpening({ period: "2026-05-01", remainingHours: 35 }, 2026)).toEqual({
      source: "payslip",
      minutes: d(5),
      accruedThrough: "2026-05-01",
      spentFrom: "2026-05-01",
    });
  });

  it("starts from the payslip of the year before as it is: nothing resets at the turn of the year", () => {
    const opening = forecastOpening({ period: "2026-10-01", remainingHours: 70 }, 2027);
    expect(opening.source).toBe("payslip");
    expect(opening.spentFrom).toBe("2026-10-01");
  });

  it("starts an empty first of January when there is no payslip at all", () => {
    expect(forecastOpening(null, 2027)).toEqual({
      source: "year",
      minutes: 0,
      accruedThrough: "2026-12-01",
      spentFrom: "2027-01-01",
    });
  });
});

describe("forecastAt (D3)", () => {
  const on = (date: string) => ({ accruedBefore: date, spentThrough: date });

  it("counts a month's accrual once the month has ended", () => {
    // A May payslip of five days. On 15 August June and July have ended: two months, four days.
    expect(forecastAt(fromMay(), on("2026-08-15"))).toBe(d(9));
    // The last day of August is still August: the month is not over.
    expect(forecastAt(fromMay(), on("2026-08-31"))).toBe(d(9));
    expect(forecastAt(fromMay(), on("2026-09-01"))).toBe(d(11));
  });

  it("never counts the payslip's own month twice", () => {
    // May's accrual is inside the May RES. already, and June has not ended on any day of June.
    expect(forecastAt(fromMay(), on("2026-05-20"))).toBe(d(5));
    expect(forecastAt(fromMay(), on("2026-06-30"))).toBe(d(5));
  });

  it("subtracts the days booked from the payslip's month to the day asked", () => {
    const days = [vacation("2026-06-10"), vacation("2026-07-10", 0.5), vacation("2026-09-10")];
    expect(forecastAt(fromMay(days), on("2026-08-15"))).toBe(d(9) - d(1.5));
    // The day asked is spent too.
    expect(forecastAt(fromMay(days), on("2026-09-10"))).toBe(d(11) - d(2.5));
  });

  it("reads the accrual on the first day of an absence and the days through its last", () => {
    const days = datesBetween("2026-07-27", "2026-08-07").map((date) => vacation(date));
    // July has not ended on 27 July, so only June counts — whatever August would have added.
    expect(forecastAt(fromMay(days), { accruedBefore: "2026-07-27", spentThrough: "2026-08-07" })).toBe(
      d(7) - d(days.length),
    );
  });

  it("goes below zero without complaint: this is also where leave is planned", () => {
    const days = datesBetween("2026-06-01", "2026-06-12").map((date) => vacation(date));
    expect(forecastAt(fromMay(days), on("2026-06-12"))).toBe(d(5) - d(12));
  });

  it("has nothing to say without a rate, or about a day before the payslip", () => {
    expect(forecastAt(fromMay([], null), on("2026-08-15"))).toBeNull();
    expect(forecastAt(fromMay(), on("2026-04-30"))).toBeNull();
  });

  it("goes on into the year after: the whole balance is carried (D4)", () => {
    // October's payslip: ten days. Seen from 2027, with two days booked in December 2026.
    const input: ForecastInput = {
      rate: TWO_DAYS,
      opening: forecastOpening({ period: "2026-10-01", remainingHours: 70 }, 2027),
      days: [vacation("2026-12-28"), vacation("2026-12-29"), vacation("2027-03-10")],
      minutesPerDay: MINUTES_PER_DAY,
    };
    // November to February have ended by 10 March: four months.
    expect(forecastAt(input, on("2027-03-10"))).toBe(d(10) + d(8) - d(3));
    // November 2026 to December 2027: fourteen months.
    expect(forecastAtYearEnd(input, 2027)).toBe(d(10) + d(28) - d(3));
  });
});

describe("forecastAtYearEnd", () => {
  it("counts December too: it is what the year hands on", () => {
    // June to December: seven months of two days on top of the five of May.
    expect(forecastAtYearEnd(fromMay(), 2026)).toBe(d(19));
  });

  it("comes to the plain allowance residual for a year with no payslip", () => {
    // Twenty-four days a year, none carried, three booked: the allowance formula says 21.
    const input: ForecastInput = {
      rate: monthlyRate([], d(24)),
      opening: forecastOpening(null, 2026),
      days: [vacation("2026-02-02"), vacation("2026-07-06"), vacation("2026-12-21")],
      minutesPerDay: MINUTES_PER_DAY,
    };
    expect(forecastAtYearEnd(input, 2026)).toBe(d(21));
  });

  it("has nothing to say about a year that ended before the payslip", () => {
    expect(forecastAtYearEnd(fromMay(), 2025)).toBeNull();
  });
});

describe("accrualView (D6)", () => {
  it("stays beside the residual when the year has a payslip of its own", () => {
    expect(accrualView(fromMay(), 2026, "payslip")).toEqual({
      rate: TWO_DAYS,
      yearEndMinutes: d(19),
      payslipPeriod: "2026-05-01",
      leads: false,
    });
  });

  it("leads the card in a year with no payslip yet, read from the last one there is", () => {
    const view = accrualView(fromMay(), 2027, "allowance");
    expect(view.leads).toBe(true);
    expect(view.payslipPeriod).toBe("2026-05-01");
    // June 2026 to December 2027: nineteen months.
    expect(view.yearEndMinutes).toBe(d(5) + d(38));
    expect(accrualView(fromMay(), 2027, "unknown").leads).toBe(true);
  });

  it("does not lead without a payslip to start from, and names none", () => {
    const input: ForecastInput = {
      rate: monthlyRate([], d(24)),
      opening: forecastOpening(null, 2027),
      days: [],
      minutesPerDay: MINUTES_PER_DAY,
    };
    expect(accrualView(input, 2027, "allowance")).toEqual({
      rate: { minutesPerMonth: d(2), source: "allowance" },
      yearEndMinutes: d(24),
      payslipPeriod: null,
      leads: false,
    });
  });

  it("gives no forecast, and no error, with neither a payslip nor an allowance — in any year", () => {
    for (const year of [2026, 2027, 2040]) {
      const input: ForecastInput = {
        rate: monthlyRate([], null),
        opening: forecastOpening(null, year),
        days: [vacation(`${year}-03-02`)],
        minutesPerDay: MINUTES_PER_DAY,
      };
      expect(accrualView(input, year, "unknown")).toEqual({
        rate: null,
        yearEndMinutes: null,
        payslipPeriod: null,
        leads: false,
      });
    }
  });
});

describe("forecastChange (U2)", () => {
  const range = { from: "2026-08-10", to: "2026-08-14" };
  const week = datesBetween(range.from, range.to).map((date) => vacation(date));

  it("says what the absence does to the balance on the day it starts", () => {
    const booked = [vacation("2026-06-10")];
    expect(
      forecastChange(fromMay(booked), range, 2026, { before: booked, after: [...booked, ...week] }),
    ).toEqual({ beforeMinutes: d(8), afterMinutes: d(3) });
  });

  it("shows a balance that goes below zero as the number it is", () => {
    const june = { from: "2026-06-08", to: "2026-06-19" };
    const fortnight = datesBetween(june.from, june.to)
      .filter((date) => bookable(date, new Set()).ok)
      .map((date) => vacation(date));
    expect(forecastChange(fromMay(), june, 2026, { before: [], after: fortnight })).toEqual({
      beforeMinutes: d(5),
      afterMinutes: d(5) - d(10),
    });
  });

  it("keeps the days of the year before, which are not the panel's to change", () => {
    const input: ForecastInput = {
      rate: TWO_DAYS,
      opening: forecastOpening({ period: "2026-10-01", remainingHours: 70 }, 2027),
      days: [vacation("2026-12-28")],
      minutesPerDay: MINUTES_PER_DAY,
    };
    const march = { from: "2027-03-10", to: "2027-03-10" };
    expect(forecastChange(input, march, 2027, { before: [], after: [vacation("2027-03-10")] })).toEqual({
      beforeMinutes: d(10) + d(8) - d(1),
      afterMinutes: d(10) + d(8) - d(2),
    });
  });

  it("has nothing to say without a forecast, or for a range that starts in another year", () => {
    expect(forecastChange(undefined, range, 2026, { before: [], after: week })).toBeNull();
    expect(forecastChange(fromMay([], null), range, 2026, { before: [], after: week })).toBeNull();
    expect(forecastChange(fromMay(), range, 2027, { before: [], after: week })).toBeNull();
  });
});

describe("overdrawn (N5b, N9, D5)", () => {
  const HOLIDAYS = new Set(italianHolidays(2026, null).map((one) => one.date));
  const COUNTED_THROUGH = "2026-04-01";
  /** The allowance of 26 days a year, as the page's one rate: no payslip to read another from. */
  const RATE = monthlyRate([], d(26));

  const view = (over: Partial<ResidualView>): ResidualView => ({
    basis: "allowance",
    remainingMinutes: 0,
    takenMinutes: 0,
    plannedMinutes: 0,
    snapshotPeriod: null,
    countedThrough: COUNTED_THROUGH,
    ...over,
  });

  /** The forecast of the same card: the May payslip's balance, or an empty January. */
  const forecast = (
    residualView: ResidualView,
    rate: AccrualRate | null,
    days: LeaveDayView[],
  ): ForecastInput => ({
    rate,
    opening: forecastOpening(
      residualView.basis === "payslip"
        ? {
            period: residualView.snapshotPeriod as string,
            remainingHours: ((residualView.remainingMinutes ?? 0) + residualView.plannedMinutes) / 60,
          }
        : null,
      2026,
    ),
    days,
    minutesPerDay: MINUTES_PER_DAY,
  });

  const check = (
    residualView: ResidualView,
    planned: LeaveDayView[],
    options: { rate?: AccrualRate | null; carriedMinutes?: number } = {},
  ) =>
    overdrawn("vacation", {
      view: residualView,
      forecast: forecast(residualView, options.rate === undefined ? RATE : options.rate, planned),
      carriedMinutes: options.carriedMinutes ?? 0,
      year: 2026,
      planned,
    });

  /** No allowance stated and no payslip rate: the plain year-end figure is all there is to go on. */
  const flat = (residualView: ResidualView) => check(residualView, [], { rate: null });

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
      check(
        view({
          basis: "payslip",
          remainingMinutes: d(5) - plannedMinutes,
          plannedMinutes,
          snapshotPeriod: "2026-05-01",
        }),
        planned,
      ),
    ).toBeNull();
  });

  it("still warns about days taken before they are earned, and names the day (N9)", () => {
    // The same two weeks, but in June: five days of balance and no month ended since the payslip
    // cannot cover ten, whatever December would have.
    const planned = datesBetween("2026-06-08", "2026-06-19")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    const over = check(
      view({
        basis: "payslip",
        remainingMinutes: d(5) - plannedMinutes,
        plannedMinutes,
        snapshotPeriod: "2026-05-01",
      }),
      planned,
    );

    expect(over).not.toBeNull();
    expect(over?.basis).toBe("payslip");
    // The day the shortfall is at its worst, which is the day to move — not a bare "you are over".
    expect(over?.onDate).toBe(planned.at(-1)?.on);
    expect(over?.byMinutes).toBeGreaterThan(0);
    // June's accrual counts when June has ended (D3): on 19 June the balance is still May's.
    expect(over?.byMinutes).toBe(plannedMinutes - d(5));
  });

  it("counts a month that has ended before the day, and only then (D3, D5)", () => {
    // The same ten days in July: June has ended, so its share of the year is there to spend.
    const planned = datesBetween("2026-07-06", "2026-07-17")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    const over = check(
      view({
        basis: "payslip",
        remainingMinutes: d(5) - plannedMinutes,
        plannedMinutes,
        snapshotPeriod: "2026-05-01",
      }),
      planned,
    );
    expect(over?.byMinutes).toBe(Math.round(plannedMinutes - d(5) - d(26) / 12));
    expect(over?.onDate).toBe(planned.at(-1)?.on);
  });

  it("uses the payslips' own rate where there is one, not the allowance's (D5)", () => {
    const planned = datesBetween("2026-07-06", "2026-07-17")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    const over = check(
      view({
        basis: "payslip",
        remainingMinutes: d(5) - plannedMinutes,
        plannedMinutes,
        snapshotPeriod: "2026-05-01",
      }),
      planned,
      { rate: { minutesPerMonth: d(3), source: "payslip" } },
    );
    expect(over?.byMinutes).toBe(plannedMinutes - d(5) - d(3));
  });

  it("never counts the payslip's own month twice", () => {
    // A May payslip's RES. already has May's accrual inside it (A.P. + MAT. − GOD. = RES.), so a
    // day in May is spent against the balance as printed and accrues nothing further.
    const planned = [vacation("2026-05-20"), vacation("2026-05-21")];
    const over = check(
      view({
        basis: "payslip",
        remainingMinutes: d(1) - d(2),
        plannedMinutes: d(2),
        snapshotPeriod: "2026-05-01",
      }),
      planned,
    );
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
      check(
        view({ remainingMinutes: d(26) - plannedMinutes, plannedMinutes, countedThrough: null }),
        planned,
      ),
    ).toBeNull();
  });

  it("spreads a stated allowance over the year rather than granting it in January", () => {
    // Forty days off in the first quarter against a 26-day year: over on any reading, but the
    // figure reported is measured against what the year had actually granted by then.
    const planned = datesBetween("2026-01-05", "2026-03-31")
      .filter((date) => bookable(date, HOLIDAYS).ok)
      .map((date) => vacation(date));
    const plannedMinutes = planned.length * MINUTES_PER_DAY;

    const over = check(
      view({ remainingMinutes: d(26) - plannedMinutes, plannedMinutes, countedThrough: null }),
      planned,
    );

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
    const withCarry = check(
      view({
        remainingMinutes: d(26) + d(10) - plannedMinutes,
        plannedMinutes,
        countedThrough: null,
      }),
      planned,
      { carriedMinutes: d(10) },
    );
    const without = check(
      view({ remainingMinutes: d(26) - plannedMinutes, plannedMinutes, countedThrough: null }),
      planned,
    );
    expect(without?.byMinutes).toBe((withCarry?.byMinutes as number) + d(10));
  });

  it("measures a year with no payslip of its own against the forecast the card shows (D6)", () => {
    // October's payslip: three days. Seen from 2027, whose allowance alone would say all is well.
    const days = datesBetween("2027-01-11", "2027-01-22").map((date) => vacation(date));
    const input: ForecastInput = {
      rate: TWO_DAYS,
      opening: forecastOpening({ period: "2026-10-01", remainingHours: 21 }, 2027),
      days,
      minutesPerDay: MINUTES_PER_DAY,
    };
    const residualView = view({ remainingMinutes: d(26) - d(days.length), plannedMinutes: d(days.length) });

    // Fourteen months of two days on top of three: the year adds up, so nothing is said.
    expect(
      overdrawn("vacation", {
        view: residualView,
        forecast: input,
        carriedMinutes: 0,
        year: 2027,
        planned: days,
      }),
    ).toBeNull();

    // With a rate that cannot cover them the warning names the payslip and the worst day.
    const thin: ForecastInput = { ...input, rate: { minutesPerMonth: d(0.25), source: "payslip" } };
    expect(
      overdrawn("vacation", {
        view: residualView,
        forecast: thin,
        carriedMinutes: 0,
        year: 2027,
        planned: days,
      }),
    ).toEqual({
      kind: "vacation",
      basis: "payslip",
      snapshotPeriod: "2026-10-01",
      // November and December have ended by January: half a day on top of the three.
      byMinutes: d(days.length) - d(3) - d(0.5),
      onDate: "2027-01-22",
    });
  });
});
