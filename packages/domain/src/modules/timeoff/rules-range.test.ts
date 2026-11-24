import { describe, expect, it } from "vitest";
import { italianHolidays } from "../../../../../test/fixtures/holidays";
import {
  type LeaveDayView,
  type LeaveType,
  type ResidualInput,
  otherHalfOf,
  previewLeaveRange,
  residual,
} from "./rules";

const MINUTES_PER_DAY = 420;
const HOLIDAYS = new Set(italianHolidays(2026, { month: 12, day: 7 }).map((one) => one.date));
const d = (count: number) => count * MINUTES_PER_DAY;

function day(on: string, typeId: string, fraction = 1): LeaveDayView {
  return { on, typeId, fraction, minutes: null };
}

function type(id: string, fields: Partial<LeaveType> = {}): LeaveType {
  return {
    id,
    name: id,
    color: "primary",
    unit: "half_day",
    hasAllowance: false,
    toCalendar: true,
    balanceKey: null,
    calendarKind: null,
    ...fields,
  };
}
/** The four types of a migrated person, in their order, by plain ids. */
const TYPES: LeaveType[] = [
  type("vacation", { hasAllowance: true, balanceKey: "vacation", calendarKind: "vacation" }),
  type("rol", { hasAllowance: true, balanceKey: "rol" }),
  type("comp", { calendarKind: "comp" }),
  type("other", { toCalendar: false }),
];
const YEAR_2026 = { from: "2026-01-01", to: "2026-12-31" };

/** An allowance and nothing else: no payslip, so every day is planned and the sum is plain. */
function allowance(days: number, booked: LeaveDayView[]): ResidualInput {
  return {
    snapshot: null,
    allowanceMinutes: d(days),
    carriedMinutes: 0,
    days: booked,
    countedThrough: null,
    minutesPerDay: MINUTES_PER_DAY,
  };
}

function context(booked: LeaveDayView[], grants: { vacation?: number; rol?: number } = {}) {
  return {
    days: booked,
    holidays: HOLIDAYS,
    types: TYPES,
    window: YEAR_2026,
    residuals: {
      ...(grants.vacation === undefined
        ? {}
        : {
            vacation: allowance(
              grants.vacation,
              booked.filter((one) => one.typeId === "vacation"),
            ),
          }),
      ...(grants.rol === undefined
        ? {}
        : {
            rol: allowance(
              grants.rol,
              booked.filter((one) => one.typeId === "rol"),
            ),
          }),
    },
  };
}

describe("the other half (AN1)", () => {
  it("proposes ROL beside half a day of vacation, and vacation beside anything else", () => {
    expect(otherHalfOf(TYPES, "vacation")).toBe("rol");
    expect(otherHalfOf(TYPES, "rol")).toBe("vacation");
    expect(otherHalfOf(TYPES, "comp")).toBe("vacation");
  });

  it("proposes no type counted in hours or in whole days, and nothing when there is no other", () => {
    const types = [
      TYPES[0],
      type("permit", { unit: "hours", hasAllowance: true }),
      type("trip", { unit: "day" }),
    ];
    expect(otherHalfOf(types, "vacation")).toBeNull();
    expect(otherHalfOf([TYPES[0]], "vacation")).toBeNull();
  });
});

describe("the days a range leaves out", () => {
  it("writes the working days and names the others with their reason", () => {
    // Monday 1 June to Sunday 7 June 2026: the 2nd is Republic Day, the 6th and 7th a weekend.
    const preview = previewLeaveRange(
      { from: "2026-06-01", to: "2026-06-07", typeId: "vacation", fraction: 1 },
      context([]),
    );
    expect(preview.written).toEqual(["2026-06-01", "2026-06-03", "2026-06-04", "2026-06-05"]);
    expect(preview.excluded).toEqual([
      { on: "2026-06-02", reason: "holiday" },
      { on: "2026-06-06", reason: "weekend" },
      { on: "2026-06-07", reason: "weekend" },
    ]);
    expect(preview.totalDays).toBe(4);
  });

  it("counts half days as halves", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-19", typeId: "rol", fraction: 0.5 },
      context([]),
    );
    expect(preview.written).toHaveLength(5);
    expect(preview.totalDays).toBe(2.5);
  });

  it("writes nothing when every day of the range is one nobody works", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-13", to: "2026-06-14", typeId: "vacation", fraction: 1 },
      context([]),
    );
    expect(preview.written).toEqual([]);
    expect(preview.excluded).toHaveLength(2);
    expect(preview.totalDays).toBe(0);
  });

  it("leaves out the patron saint the person keeps", () => {
    // 7 December 2026 is a Monday, and Milan's own holiday.
    const preview = previewLeaveRange(
      { from: "2026-12-07", to: "2026-12-07", typeId: "vacation", fraction: 1 },
      context([]),
    );
    expect(preview.excluded).toEqual([{ on: "2026-12-07", reason: "holiday" }]);
  });
});

describe("what a range replaces", () => {
  it("takes away a whole day of another kind it passes over", () => {
    const booked = [day("2026-06-17", "rol")];
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-19", typeId: "vacation", fraction: 1 },
      context(booked),
    );
    expect(preview.replaced).toEqual([
      { on: "2026-06-17", typeId: "rol", fraction: 1, minutes: null, change: "removed" },
    ]);
    expect(preview.removed).toEqual(booked);
    expect(preview.after.filter((one) => one.on === "2026-06-17")).toEqual([day("2026-06-17", "vacation")]);
  });

  it("keeps a half of another kind beside a new half: the two make one day", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "vacation", fraction: 0.5 },
      context([day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.removed).toEqual([]);
    expect(preview.after).toEqual([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]);
  });

  it("takes away a half of another kind under a new whole day", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "vacation", fraction: 1 },
      context([day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced).toEqual([
      { on: "2026-06-17", typeId: "rol", fraction: 0.5, minutes: null, change: "removed" },
    ]);
  });

  it("takes away both halves of a split day under a new half of a third kind", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "comp", fraction: 0.5 },
      context([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced.map((row) => row.typeId)).toEqual(["vacation", "rol"]);
    expect(preview.after).toEqual([day("2026-06-17", "comp", 0.5)]);
  });

  it("reports a row of the same kind only when its size changes", () => {
    const booked = [day("2026-06-16", "vacation"), day("2026-06-17", "vacation", 0.5)];
    const preview = previewLeaveRange(
      { from: "2026-06-16", to: "2026-06-17", typeId: "vacation", fraction: 1 },
      context(booked),
    );
    expect(preview.replaced).toEqual([
      { on: "2026-06-17", typeId: "vacation", fraction: 0.5, minutes: null, change: "resized" },
    ]);
    // Updated in place: nothing is taken away.
    expect(preview.removed).toEqual([]);
    expect(preview.after).toEqual([day("2026-06-16", "vacation"), day("2026-06-17", "vacation")]);
  });
});

describe("editing one row", () => {
  it("changes the kind of a whole day without reporting the row as replaced", () => {
    const booked = [day("2026-06-17", "vacation")];
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "rol", fraction: 1, editedTypeId: "vacation" },
      context(booked),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.removed).toEqual(booked);
    expect(preview.after).toEqual([day("2026-06-17", "rol")]);
  });

  it("changes one half of a split day and leaves the other half alone", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "comp", fraction: 0.5, editedTypeId: "vacation" },
      context([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.after).toEqual([day("2026-06-17", "rol", 0.5), day("2026-06-17", "comp", 0.5)]);
  });

  it("takes the other half away when the edited half becomes a whole day", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "vacation", fraction: 1, editedTypeId: "vacation" },
      context([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]),
    );
    // The edited row's own change of size is the edit, not a replacement.
    expect(preview.replaced).toEqual([
      { on: "2026-06-17", typeId: "rol", fraction: 0.5, minutes: null, change: "removed" },
    ]);
    expect(preview.after).toEqual([day("2026-06-17", "vacation")]);
  });
});

describe("half of one kind and half of another, in one step (decision of 17/11/2026)", () => {
  it("writes the two halves on a free day, and the residual of both kinds moves", () => {
    const preview = previewLeaveRange(
      { from: "2026-11-17", to: "2026-11-17", typeId: "vacation", fraction: 0.5, otherTypeId: "rol" },
      context([], { vacation: 10, rol: 4 }),
    );
    expect(preview.written).toEqual(["2026-11-17"]);
    expect(preview.replaced).toEqual([]);
    expect(preview.after).toEqual([day("2026-11-17", "vacation", 0.5), day("2026-11-17", "rol", 0.5)]);
    expect(preview.totalDays).toBe(1);
    expect(preview.balances).toEqual([
      { typeId: "vacation", beforeMinutes: d(10), afterMinutes: d(9.5) },
      { typeId: "rol", beforeMinutes: d(4), afterMinutes: d(3.5) },
    ]);
  });

  it("splits a whole day of vacation it edits: the row shrinks, nothing is reported as replaced", () => {
    const preview = previewLeaveRange(
      {
        from: "2026-11-17",
        to: "2026-11-17",
        typeId: "vacation",
        fraction: 0.5,
        otherTypeId: "rol",
        editedTypeId: "vacation",
      },
      context([day("2026-11-17", "vacation")], { vacation: 10, rol: 4 }),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.removed).toEqual([]);
    expect(preview.after).toEqual([day("2026-11-17", "vacation", 0.5), day("2026-11-17", "rol", 0.5)]);
  });

  it("adds the other half beside a half of the first kind, and resizes nothing", () => {
    const preview = previewLeaveRange(
      { from: "2026-11-17", to: "2026-11-17", typeId: "vacation", fraction: 0.5, otherTypeId: "rol" },
      context([day("2026-11-17", "vacation", 0.5)]),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.after).toEqual([day("2026-11-17", "vacation", 0.5), day("2026-11-17", "rol", 0.5)]);
  });

  it("takes away a third kind, and resizes a whole day of one of the two kinds, on every day of a range", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-16", to: "2026-06-17", typeId: "vacation", fraction: 0.5, otherTypeId: "rol" },
      context([day("2026-06-16", "comp"), day("2026-06-17", "rol")]),
    );
    expect(preview.replaced).toEqual([
      { on: "2026-06-16", typeId: "comp", fraction: 1, minutes: null, change: "removed" },
      { on: "2026-06-17", typeId: "rol", fraction: 1, minutes: null, change: "resized" },
    ]);
    expect(preview.removed).toEqual([day("2026-06-16", "comp")]);
    expect(preview.totalDays).toBe(2);
    expect(preview.after).toEqual([
      day("2026-06-16", "vacation", 0.5),
      day("2026-06-16", "rol", 0.5),
      day("2026-06-17", "vacation", 0.5),
      day("2026-06-17", "rol", 0.5),
    ]);
  });

  it("keeps the edited row when it becomes the second half, instead of taking it away", () => {
    const preview = previewLeaveRange(
      {
        from: "2026-11-17",
        to: "2026-11-17",
        typeId: "rol",
        fraction: 0.5,
        otherTypeId: "vacation",
        editedTypeId: "vacation",
      },
      context([day("2026-11-17", "vacation")]),
    );
    expect(preview.removed).toEqual([]);
    expect(preview.after).toEqual([day("2026-11-17", "vacation", 0.5), day("2026-11-17", "rol", 0.5)]);
  });
});

describe("the residual before and after", () => {
  it("is the same residual() the card uses, over the days as they will be", () => {
    const booked = [day("2026-03-10", "vacation"), day("2026-03-11", "vacation")];
    const ctx = context(booked, { vacation: 26, rol: 4 });
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-19", typeId: "vacation", fraction: 1 },
      ctx,
    );
    const card = residual(ctx.residuals.vacation as ResidualInput).remainingMinutes;
    expect(preview.balances).toEqual([{ typeId: "vacation", beforeMinutes: card, afterMinutes: d(19) }]);
    expect(card).toBe(d(24));
  });

  it("does not change when the same days are confirmed again", () => {
    const booked = [day("2026-06-15", "vacation"), day("2026-06-16", "vacation")];
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-16", typeId: "vacation", fraction: 1 },
      context(booked, { vacation: 26 }),
    );
    expect(preview.balances).toEqual([{ typeId: "vacation", beforeMinutes: d(24), afterMinutes: d(24) }]);
  });

  it("goes below zero, as a number and not as an error: the page is also where leave is planned", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-19", typeId: "vacation", fraction: 1 },
      context([], { vacation: 3 }),
    );
    expect(preview.balances).toEqual([{ typeId: "vacation", beforeMinutes: d(3), afterMinutes: d(-2) }]);
    expect(preview.written).toHaveLength(5);
  });

  it("adds a line for the kind a replacement frees", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "vacation", fraction: 1 },
      context([day("2026-06-17", "rol")], { vacation: 26, rol: 4 }),
    );
    expect(preview.balances).toEqual([
      { typeId: "vacation", beforeMinutes: d(26), afterMinutes: d(25) },
      { typeId: "rol", beforeMinutes: d(3), afterMinutes: d(4) },
    ]);
  });

  it("has no line for a kind that spends no allowance and frees none", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "comp", fraction: 1 },
      context([], { vacation: 26, rol: 4 }),
    );
    expect(preview.balances).toEqual([]);
  });

  it("says a residual nobody can compute is unknown before and after", () => {
    const unknown: ResidualInput = { ...allowance(0, []), allowanceMinutes: null };
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", typeId: "vacation", fraction: 1 },
      { days: [], holidays: HOLIDAYS, types: TYPES, window: YEAR_2026, residuals: { vacation: unknown } },
    );
    expect(preview.balances).toEqual([{ typeId: "vacation", beforeMinutes: null, afterMinutes: null }]);
  });

  it("counts only the days of the year shown, and says how many are in another year", () => {
    // Monday 28 December 2026 to Friday 8 January 2027; 1 and 6 January are holidays of 2027.
    const preview = previewLeaveRange(
      { from: "2026-12-28", to: "2027-01-08", typeId: "vacation", fraction: 1 },
      {
        ...context([], { vacation: 26 }),
        holidays: new Set([...HOLIDAYS, ...italianHolidays(2027).map((one) => one.date)]),
      },
    );
    expect(preview.written).toHaveLength(8);
    expect(preview.otherYearDays).toBe(4);
    expect(preview.balances).toEqual([{ typeId: "vacation", beforeMinutes: d(26), afterMinutes: d(22) }]);
  });
});
