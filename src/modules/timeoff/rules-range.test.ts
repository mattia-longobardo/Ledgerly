import { describe, expect, it } from "vitest";
import { italianHolidays } from "@/platform/holidays/rules";
import {
  LEAVE_TYPES,
  type LeaveDayKind,
  type LeaveDayView,
  type ResidualInput,
  otherHalfOf,
  previewLeaveRange,
  residual,
} from "./rules";

const MINUTES_PER_DAY = 420;
const HOLIDAYS = new Set(italianHolidays(2026, { month: 12, day: 7 }).map((one) => one.date));
const d = (count: number) => count * MINUTES_PER_DAY;

function day(on: string, kind: LeaveDayKind, fraction = 1): LeaveDayView {
  return { on, kind, fraction };
}

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
    year: 2026,
    residuals: {
      ...(grants.vacation === undefined
        ? {}
        : {
            vacation: allowance(
              grants.vacation,
              booked.filter((one) => one.kind === "vacation"),
            ),
          }),
      ...(grants.rol === undefined
        ? {}
        : {
            rol: allowance(
              grants.rol,
              booked.filter((one) => one.kind === "rol"),
            ),
          }),
    },
  };
}

describe("the kinds as a list (AN1)", () => {
  it("offers every kind of today but sickness, which is no longer a kind of leave (H20)", () => {
    expect(LEAVE_TYPES.filter((type) => type.selectable).map((type) => type.id)).toEqual([
      "vacation",
      "rol",
      "comp",
      "other",
    ]);
    // Still in the list: a row that carries it is still shown and still edited.
    expect(LEAVE_TYPES.map((type) => type.id)).toContain("sick");
  });

  it("says which kinds spend an allowance and which never leave here", () => {
    expect(LEAVE_TYPES.filter((type) => type.hasBalance).map((type) => type.id)).toEqual(["vacation", "rol"]);
    expect(LEAVE_TYPES.filter((type) => type.local).map((type) => type.id)).toEqual(["sick", "other"]);
  });

  it("proposes ROL beside half a day of vacation, and vacation beside anything else", () => {
    expect(otherHalfOf("vacation")).toBe("rol");
    expect(otherHalfOf("rol")).toBe("vacation");
    expect(otherHalfOf("comp")).toBe("vacation");
  });
});

describe("the days a range leaves out", () => {
  it("writes the working days and names the others with their reason", () => {
    // Monday 1 June to Sunday 7 June 2026: the 2nd is Republic Day, the 6th and 7th a weekend.
    const preview = previewLeaveRange(
      { from: "2026-06-01", to: "2026-06-07", kind: "vacation", fraction: 1 },
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
      { from: "2026-06-15", to: "2026-06-19", kind: "rol", fraction: 0.5 },
      context([]),
    );
    expect(preview.written).toHaveLength(5);
    expect(preview.totalDays).toBe(2.5);
  });

  it("writes nothing when every day of the range is one nobody works", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-13", to: "2026-06-14", kind: "vacation", fraction: 1 },
      context([]),
    );
    expect(preview.written).toEqual([]);
    expect(preview.excluded).toHaveLength(2);
    expect(preview.totalDays).toBe(0);
  });

  it("leaves out the patron saint the person keeps", () => {
    // 7 December 2026 is a Monday, and Milan's own holiday.
    const preview = previewLeaveRange(
      { from: "2026-12-07", to: "2026-12-07", kind: "vacation", fraction: 1 },
      context([]),
    );
    expect(preview.excluded).toEqual([{ on: "2026-12-07", reason: "holiday" }]);
  });
});

describe("what a range replaces", () => {
  it("takes away a whole day of another kind it passes over", () => {
    const booked = [day("2026-06-17", "rol")];
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-19", kind: "vacation", fraction: 1 },
      context(booked),
    );
    expect(preview.replaced).toEqual([{ on: "2026-06-17", kind: "rol", fraction: 1, change: "removed" }]);
    expect(preview.removed).toEqual(booked);
    expect(preview.after.filter((one) => one.on === "2026-06-17")).toEqual([day("2026-06-17", "vacation")]);
  });

  it("keeps a half of another kind beside a new half: the two make one day", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "vacation", fraction: 0.5 },
      context([day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.removed).toEqual([]);
    expect(preview.after).toEqual([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]);
  });

  it("takes away a half of another kind under a new whole day", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "vacation", fraction: 1 },
      context([day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced).toEqual([{ on: "2026-06-17", kind: "rol", fraction: 0.5, change: "removed" }]);
  });

  it("takes away both halves of a split day under a new half of a third kind", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "comp", fraction: 0.5 },
      context([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced.map((row) => row.kind)).toEqual(["vacation", "rol"]);
    expect(preview.after).toEqual([day("2026-06-17", "comp", 0.5)]);
  });

  it("reports a row of the same kind only when its size changes", () => {
    const booked = [day("2026-06-16", "vacation"), day("2026-06-17", "vacation", 0.5)];
    const preview = previewLeaveRange(
      { from: "2026-06-16", to: "2026-06-17", kind: "vacation", fraction: 1 },
      context(booked),
    );
    expect(preview.replaced).toEqual([
      { on: "2026-06-17", kind: "vacation", fraction: 0.5, change: "resized" },
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
      { from: "2026-06-17", to: "2026-06-17", kind: "rol", fraction: 1, editedKind: "vacation" },
      context(booked),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.removed).toEqual(booked);
    expect(preview.after).toEqual([day("2026-06-17", "rol")]);
  });

  it("changes one half of a split day and leaves the other half alone", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "comp", fraction: 0.5, editedKind: "vacation" },
      context([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]),
    );
    expect(preview.replaced).toEqual([]);
    expect(preview.after).toEqual([day("2026-06-17", "rol", 0.5), day("2026-06-17", "comp", 0.5)]);
  });

  it("takes the other half away when the edited half becomes a whole day", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "vacation", fraction: 1, editedKind: "vacation" },
      context([day("2026-06-17", "vacation", 0.5), day("2026-06-17", "rol", 0.5)]),
    );
    // The edited row's own change of size is the edit, not a replacement.
    expect(preview.replaced).toEqual([{ on: "2026-06-17", kind: "rol", fraction: 0.5, change: "removed" }]);
    expect(preview.after).toEqual([day("2026-06-17", "vacation")]);
  });
});

describe("the residual before and after", () => {
  it("is the same residual() the card uses, over the days as they will be", () => {
    const booked = [day("2026-03-10", "vacation"), day("2026-03-11", "vacation")];
    const ctx = context(booked, { vacation: 26, rol: 4 });
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-19", kind: "vacation", fraction: 1 },
      ctx,
    );
    const card = residual(ctx.residuals.vacation as ResidualInput).remainingMinutes;
    expect(preview.balances).toEqual([{ kind: "vacation", beforeMinutes: card, afterMinutes: d(19) }]);
    expect(card).toBe(d(24));
  });

  it("does not change when the same days are confirmed again", () => {
    const booked = [day("2026-06-15", "vacation"), day("2026-06-16", "vacation")];
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-16", kind: "vacation", fraction: 1 },
      context(booked, { vacation: 26 }),
    );
    expect(preview.balances).toEqual([{ kind: "vacation", beforeMinutes: d(24), afterMinutes: d(24) }]);
  });

  it("goes below zero, as a number and not as an error: the page is also where leave is planned", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-15", to: "2026-06-19", kind: "vacation", fraction: 1 },
      context([], { vacation: 3 }),
    );
    expect(preview.balances).toEqual([{ kind: "vacation", beforeMinutes: d(3), afterMinutes: d(-2) }]);
    expect(preview.written).toHaveLength(5);
  });

  it("adds a line for the kind a replacement frees", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "vacation", fraction: 1 },
      context([day("2026-06-17", "rol")], { vacation: 26, rol: 4 }),
    );
    expect(preview.balances).toEqual([
      { kind: "vacation", beforeMinutes: d(26), afterMinutes: d(25) },
      { kind: "rol", beforeMinutes: d(3), afterMinutes: d(4) },
    ]);
  });

  it("has no line for a kind that spends no allowance and frees none", () => {
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "comp", fraction: 1 },
      context([], { vacation: 26, rol: 4 }),
    );
    expect(preview.balances).toEqual([]);
  });

  it("says a residual nobody can compute is unknown before and after", () => {
    const unknown: ResidualInput = { ...allowance(0, []), allowanceMinutes: null };
    const preview = previewLeaveRange(
      { from: "2026-06-17", to: "2026-06-17", kind: "vacation", fraction: 1 },
      { days: [], holidays: HOLIDAYS, year: 2026, residuals: { vacation: unknown } },
    );
    expect(preview.balances).toEqual([{ kind: "vacation", beforeMinutes: null, afterMinutes: null }]);
  });

  it("counts only the days of the year shown, and says how many are in another year", () => {
    // Monday 28 December 2026 to Friday 8 January 2027; 1 and 6 January are holidays of 2027.
    const preview = previewLeaveRange(
      { from: "2026-12-28", to: "2027-01-08", kind: "vacation", fraction: 1 },
      {
        ...context([], { vacation: 26 }),
        holidays: new Set([...HOLIDAYS, ...italianHolidays(2027).map((one) => one.date)]),
      },
    );
    expect(preview.written).toHaveLength(8);
    expect(preview.otherYearDays).toBe(4);
    expect(preview.balances).toEqual([{ kind: "vacation", beforeMinutes: d(26), afterMinutes: d(22) }]);
  });
});
