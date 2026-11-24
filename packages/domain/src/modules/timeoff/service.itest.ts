/**
 * The time off service against a real database (plan F7 L1): allowances, days, ranges, and the
 * whole life of `pending` — saved, sent, synced, removed, gone.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../../platform/context";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { newContext } from "../../../../../test/fixtures";
import { type OldTypes, oldLeaveTypes } from "../../../../../test/leave-types";
import { holidayDays } from "../../platform/holidays/schema";
import { addCalendar } from "../../platform/holidays/service";
import { timeOffView } from "./queries";
import { leaveDays } from "./schema";
import {
  MAX_RANGE_DAYS,
  TimeOffError,
  allowanceOf,
  closePendingDeletes,
  deleteLeaveDay,
  listAllowances,
  listLeaveDays,
  markSynced,
  pendingForCalendar,
  recordFromCalendar,
  addRestDay,
  clearDay,
  deleteLeaveType,
  deleteRestDay,
  leaveYearWindow,
  listTypeAllowances,
  saveLeaveDay,
  saveLeaveType,
  saveTypeAllowance,
  saveYearNote,
  yearWindow,
} from "./service";

let ctx: Ctx;
let other: Ctx;
let types: OldTypes;
let otherTypes: OldTypes;
const YEAR = 2026;
const WINDOW = yearWindow(YEAR);

/** 2026-06-16 is a Tuesday; 06-13 a Saturday; 06-02 Republic Day, a Tuesday. */
const TUESDAY = "2026-06-16";
const SATURDAY = "2026-06-13";
const HOLIDAY = "2026-06-02";

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  other = await newContext();
  types = await oldLeaveTypes(ctx);
  otherTypes = await oldLeaveTypes(other);
});

afterAll(closeDatabase);

/** A calendar of holidays with the given days: the app computes no country's list since R5g. */
async function holidays(dates: readonly string[]): Promise<void> {
  const calendar = await addCalendar(ctx, {
    source: "nager",
    country: "IT",
    subdivision: null,
    label: "Italy",
  });
  await getDb()
    .insert(holidayDays)
    .values(
      dates.map((on) =>
        userScoped(ctx).stamp({ calendarId: calendar.id, on, year: Number(on.slice(0, 4)), name: "Holiday" }),
      ),
    );
}

/** A year's allowance of the two types that have one, in days. */
async function allowance(who: Ctx, year: number, vacationDays: number | null, rolDays: number | null) {
  const own = who === ctx ? types : otherTypes;
  await saveTypeAllowance(who, own.vacation, year, { days: vacationDays });
  await saveTypeAllowance(who, own.rol, year, { days: rolDays });
}

/** By date, then by type id: the order `listLeaveDays` keeps. */
const byDayThenType = (rows: [string, string][]) =>
  [...rows].sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

async function rowOf(id: string) {
  const [row] = await getDb()
    .select()
    .from(leaveDays)
    .where(and(eq(leaveDays.id, id), userScoped(ctx).owns(leaveDays)));
  return row;
}

describe("allowances", () => {
  it("states a year, replaces it, and keeps users apart", async () => {
    await allowance(ctx, YEAR, 26, 4);
    let row = await allowanceOf(ctx, YEAR);
    // The old row of the year is still written beside the allowances by type (R5g, until R5f).
    expect(row).toMatchObject({ vacationDays: "26.00", rolDays: "4.00" });

    // The same year again replaces the row rather than failing on the unique key.
    await allowance(ctx, YEAR, 28, null);
    row = await allowanceOf(ctx, YEAR);
    expect(row).toMatchObject({ vacationDays: "28.00", rolDays: null });
    expect(await listAllowances(ctx)).toHaveLength(1);
    expect(await listTypeAllowances(ctx)).toEqual([
      { typeId: types.vacation, year: YEAR, days: 28, carriedDays: null },
      { typeId: types.rol, year: YEAR, days: null, carriedDays: null },
    ]);

    expect(await allowanceOf(other, YEAR)).toBeNull();
    expect(await listTypeAllowances(other)).toEqual([]);
  });

  it("is null for a year nobody has stated, rather than a zero nobody meant", async () => {
    expect(await allowanceOf(ctx, YEAR)).toBeNull();
  });

  it("lists the years oldest first", async () => {
    await saveTypeAllowance(ctx, types.vacation, 2027, { days: 26 });
    await saveTypeAllowance(ctx, types.vacation, 2025, { days: 24 });
    expect((await listTypeAllowances(ctx)).map((one) => one.year)).toEqual([2025, 2027]);
    expect((await listAllowances(ctx)).map((one) => one.year)).toEqual([2025, 2027]);
  });

  it("records the contract's total beside the two parts it is made of (N7)", async () => {
    // Both parts in days since N9: ROL is no longer the one figure stated in another unit.
    await allowance(ctx, YEAR, 26, 4);
    await saveYearNote(ctx, YEAR, { totalDays: 30, note: "CCNL" });
    expect(await allowanceOf(ctx, YEAR)).toMatchObject({
      vacationDays: "26.00",
      rolDays: "4.00",
      totalDays: "30.00",
      note: "CCNL",
    });
  });

  it("clears the ROL days and the total when the year is stated again without them", async () => {
    // The upsert replaces the figure: a figure removed from the modal is a figure removed from
    // the allowance, not one that quietly survives from the version before.
    await allowance(ctx, YEAR, 26, 4);
    await saveYearNote(ctx, YEAR, { totalDays: 30, note: null });
    await allowance(ctx, YEAR, 26, null);
    await saveYearNote(ctx, YEAR, { totalDays: null, note: null });
    expect(await allowanceOf(ctx, YEAR)).toMatchObject({ rolDays: null, totalDays: null });
  });

  it("refuses an impossible year and a negative allowance", async () => {
    await expect(saveTypeAllowance(ctx, types.vacation, 1800, { days: 26 })).rejects.toThrow(TimeOffError);
    await expect(saveTypeAllowance(ctx, types.vacation, YEAR, { days: -1 })).rejects.toThrow(TimeOffError);
    await expect(saveTypeAllowance(ctx, types.rol, YEAR, { days: -1 })).rejects.toThrow(TimeOffError);
    await expect(saveTypeAllowance(ctx, types.rol, YEAR, { carriedDays: -401 })).rejects.toThrow(
      TimeOffError,
    );
    await expect(saveYearNote(ctx, 1800, { totalDays: 30, note: null })).rejects.toThrow(TimeOffError);
    await expect(saveYearNote(ctx, YEAR, { totalDays: 401, note: null })).rejects.toThrow(TimeOffError);
  });

  it("refuses a type that is not the person's", async () => {
    const error = await saveTypeAllowance(ctx, otherTypes.vacation, YEAR, { days: 26 }).catch(
      (e: unknown) => e,
    );
    expect((error as TimeOffError).code).toBe("not_found");
  });
});

describe("types of leave (R5g)", () => {
  it("counts a new type with an allowance in its own residual", async () => {
    const study = await saveLeaveType(ctx, null, {
      name: "Study leave",
      color: "pos",
      unit: "half_day",
      hasAllowance: true,
      toCalendar: false,
    });
    await saveTypeAllowance(ctx, study.id, YEAR, { days: 5 });
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: study.id, fraction: 1 });

    const view = await timeOffView(ctx, YEAR);
    const balance = view.balances.find((one) => one.typeId === study.id);
    expect(balance?.residual.basis).toBe("allowance");
    expect(balance?.residual.remainingMinutes).toBe(4 * view.minutesPerDay);
  });

  it("refuses to remove a type with days booked, and removes one without", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.comp, fraction: 1 });
    const error = await deleteLeaveType(ctx, types.comp).catch((e: unknown) => e);
    expect((error as TimeOffError).code).toBe("in_use");

    await deleteLeaveType(ctx, types.other);
    const view = await timeOffView(ctx, YEAR);
    expect(view.types.map((one) => one.id)).toEqual([types.vacation, types.rol, types.comp]);
  });

  it("starts the leave year in the month the person chose", () => {
    expect(leaveYearWindow(2026, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(leaveYearWindow(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("saving a day", () => {
  it("saves one working day, pending for Trek", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    expect(day).toMatchObject({ on: TUESDAY, typeId: types.vacation, fraction: "1.0", pending: "upsert" });
    expect(day.origin).toBe("manual");
    expect(day.syncedAt).toBeNull();
  });

  it("books ROL in half days and whole ones, like every other kind (N0)", async () => {
    // ROL used to be free-form minutes, which made it the one kind the calendar could not draw.
    const [half] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol, fraction: 0.5 });
    expect(half).toMatchObject({ on: TUESDAY, typeId: types.rol, fraction: "0.5" });
    const [whole] = await saveLeaveDay(ctx, { from: "2026-06-17", typeId: types.rol, fraction: 1 });
    expect(whole.fraction).toBe("1.0");
  });

  it("takes a whole day when the caller states no size", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol });
    expect(day.fraction).toBe("1.0");
  });

  it("refuses a single weekend day and a single holiday, and says which", async () => {
    await holidays([HOLIDAY]);
    const weekend = await saveLeaveDay(ctx, { from: SATURDAY, typeId: types.vacation, fraction: 1 }).catch(
      (error: unknown) => error,
    );
    expect(weekend).toBeInstanceOf(TimeOffError);
    expect((weekend as TimeOffError).code).toBe("not_bookable");
    expect((weekend as TimeOffError).refused).toEqual([{ on: SATURDAY, reason: "weekend" }]);

    const holiday = await saveLeaveDay(ctx, { from: HOLIDAY, typeId: types.vacation, fraction: 1 }).catch(
      (error: unknown) => error,
    );
    expect((holiday as TimeOffError).refused).toEqual([{ on: HOLIDAY, reason: "holiday" }]);
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(0);
  });

  it("refuses the patron saint the user has set, and accepts it once they have not", async () => {
    // 7 December 2026 is a Monday, so only the patron saint can refuse it: a day off of the year
    // since R5g, no longer a preference.
    const patron = await addRestDay(ctx, { month: 12, day: 7, name: "Sant'Ambrogio" });
    await expect(
      saveLeaveDay(ctx, { from: "2026-12-07", typeId: types.vacation, fraction: 1 }),
    ).rejects.toThrow(TimeOffError);
    await deleteRestDay(ctx, patron.id);
    const [day] = await saveLeaveDay(ctx, { from: "2026-12-07", typeId: types.vacation, fraction: 1 });
    expect(day.on).toBe("2026-12-07");
  });

  it("writes only the working days of a range, silently", async () => {
    // Friday 12 June to Tuesday 16 June: the Saturday and Sunday are not written, and not an error.
    const written = await saveLeaveDay(ctx, {
      from: "2026-06-12",
      to: TUESDAY,
      typeId: types.vacation,
      fraction: 1,
    });
    expect(written.map((one) => one.on)).toEqual(["2026-06-12", "2026-06-15", "2026-06-16"]);
  });

  it("refuses a range made only of days nobody can book", async () => {
    await expect(
      saveLeaveDay(ctx, { from: SATURDAY, to: "2026-06-14", typeId: types.vacation, fraction: 1 }),
    ).rejects.toThrow(TimeOffError);
  });

  it("refuses a range longer than anybody books in one go", async () => {
    const error = await saveLeaveDay(ctx, {
      from: "2026-01-01",
      to: "2026-12-31",
      typeId: types.vacation,
      fraction: 1,
    }).catch((e: unknown) => e);
    expect((error as TimeOffError).code).toBe("range_too_long");
    expect(365).toBeGreaterThan(MAX_RANGE_DAYS);
  });

  it("updates a day already saved for the same kind instead of failing", async () => {
    const [first] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    const [second] = await saveLeaveDay(ctx, {
      from: TUESDAY,
      typeId: types.vacation,
      fraction: 0.5,
      note: "afternoon",
    });
    expect(second.id).toBe(first.id);
    expect(second.fraction).toBe("0.5");
    expect(second.note).toBe("afternoon");
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(1);
  });

  it("lets two kinds share one day", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol, fraction: 0.5 });
    const days = await listLeaveDays(ctx, WINDOW);
    expect(days.map((one) => one.typeId).sort()).toEqual([types.vacation, types.rol].sort());
  });

  it("marks only the leave that reaches Trek as pending (N4)", async () => {
    const [rol] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol, fraction: 0.5 });
    const [comp] = await saveLeaveDay(ctx, { from: "2026-06-17", typeId: types.comp, fraction: 1 });
    const [other_] = await saveLeaveDay(ctx, { from: "2026-06-19", typeId: types.other, fraction: 1 });

    // ROL is leave that spends the year, so it goes across too: a day that is not on Trek reads
    // to a colleague as a day at work, whichever box it came out of here.
    expect([rol.pending, comp.pending]).toEqual(["upsert", "upsert"]);
    // "Other" is an absence of another kind, and never leaves this app.
    expect(other_.pending).toBe("none");

    // …and neither of those two is ever offered to a pass.
    // Both go across under the calendar's one word, the first type's that has one (N4).
    const pending = await pendingForCalendar(ctx, WINDOW);
    expect(pending.map((one) => one.id)).toEqual([rol.id, comp.id]);
    expect(pending.map((one) => one.kind)).toEqual(["vacation", "vacation"]);
  });

  it("refuses a size that is neither half a day nor a whole one", async () => {
    await expect(saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol, fraction: 0.25 })).rejects.toThrow(
      TimeOffError,
    );
    await expect(saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 2 })).rejects.toThrow(
      TimeOffError,
    );
  });

  it("keeps one user's days out of another's", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    await saveLeaveDay(other, { from: TUESDAY, typeId: otherTypes.vacation, fraction: 1 });
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(1);
    expect(await listLeaveDays(other, WINDOW)).toHaveLength(1);
  });
});

describe("the life of a pending state (plan §3.4.7)", () => {
  it("goes saved → upsert → synced → delete → gone", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    expect(day.pending).toBe("upsert");

    // The pass offered it, sent it, re-read the year and saw Trek holding a whole day.
    expect((await pendingForCalendar(ctx, WINDOW)).map((one) => one.id)).toEqual([day.id]);
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    const synced = await rowOf(day.id);
    expect(synced).toMatchObject({ pending: "none", observedFraction: "1.0", observedKind: "vacation" });
    expect(synced.syncedAt).not.toBeNull();
    expect(await pendingForCalendar(ctx, WINDOW)).toHaveLength(0);

    // Removing it does not remove it yet: Trek has to be told first.
    expect(await deleteLeaveDay(ctx, day.id)).toBe("pending");
    expect((await rowOf(day.id)).pending).toBe("delete");
    expect((await pendingForCalendar(ctx, WINDOW))[0]).toMatchObject({
      pending: "delete",
      observedFraction: 1,
      observedKind: "vacation",
    });

    // The pass re-read the year and Trek no longer has the day: now it really goes.
    await markSynced(ctx, [{ id: day.id, fraction: null, kind: null }]);
    expect(await rowOf(day.id)).toBeUndefined();
  });

  it("deletes a day Trek never heard of outright", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    expect(await deleteLeaveDay(ctx, day.id)).toBe("deleted");
    expect(await rowOf(day.id)).toBeUndefined();
  });

  it("deletes a kind Trek is never told about outright, because Trek is not involved", async () => {
    const [kept] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.other, fraction: 1 });
    expect(await deleteLeaveDay(ctx, kept.id)).toBe("deleted");
  });

  it("puts an edited day back in the queue without forgetting what Trek holds", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 0.5 });

    const edited = await rowOf(day.id);
    expect(edited.pending).toBe("upsert");
    expect(edited.fraction).toBe("0.5");
    // The observed pair is untouched: the pass still has to send the whole day to remove it.
    expect(edited.observedFraction).toBe("1.0");
    expect(edited.syncedAt).not.toBeNull();
  });

  it("refuses to remove somebody else's day", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    await expect(deleteLeaveDay(other, day.id)).rejects.toThrow(TimeOffError);
    expect(await rowOf(day.id)).toBeDefined();
  });
});

describe("what a pass brings back", () => {
  it("records a day Trek had and we did not, under the type of its word", async () => {
    expect(await recordFromCalendar(ctx, { on: TUESDAY, kind: "vacation", fraction: 0.5 })).toBe(true);
    const [recorded] = await listLeaveDays(ctx, WINDOW);
    expect(recorded).toMatchObject({
      typeId: types.vacation,
      origin: "external",
      pending: "none",
      fraction: "0.5",
      observedFraction: "0.5",
      observedKind: "vacation",
      externalKind: "vacation",
    });
    expect(recorded.syncedAt).not.toBeNull();
  });

  it("leaves upstream a day of a word no type of the person's has", async () => {
    expect(await recordFromCalendar(ctx, { on: TUESDAY, kind: "sick", fraction: 1 })).toBe(false);
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(0);
  });

  it("reconciles a day we already held, without duplicating it", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    await recordFromCalendar(ctx, { on: TUESDAY, kind: "vacation", fraction: 1 });
    const days = await listLeaveDays(ctx, WINDOW);
    expect(days).toHaveLength(1);
    expect(days[0].id).toBe(day.id);
    expect(days[0].pending).toBe("none");
  });

  it("leaves a day we classify differently alone", async () => {
    // We hold the day as ROL; Trek shows a `comp`. Two rows, and ours is untouched.
    const [rol] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol, fraction: 0.5 });
    await recordFromCalendar(ctx, { on: TUESDAY, kind: "comp", fraction: 0.5 });
    const days = await listLeaveDays(ctx, WINDOW);
    expect(days).toHaveLength(2);
    expect(await rowOf(rol.id)).toMatchObject({ typeId: types.rol, fraction: "0.5", origin: "manual" });
  });
});

describe("unlinking Trek (plan §3.4.10)", () => {
  it("closes every pending removal, because nobody is left to ask", async () => {
    const [first] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    const [second] = await saveLeaveDay(ctx, { from: "2026-06-17", typeId: types.vacation, fraction: 1 });
    await markSynced(ctx, [
      { id: first.id, fraction: 1, kind: "vacation" },
      { id: second.id, fraction: 1, kind: "vacation" },
    ]);
    await deleteLeaveDay(ctx, first.id);

    expect(await closePendingDeletes(ctx)).toBe(1);
    expect(await rowOf(first.id)).toBeUndefined();
    // A day that was merely synced is not a day anybody asked to remove: it stays.
    expect(await rowOf(second.id)).toBeDefined();
  });

  it("leaves another user's pending removals alone", async () => {
    const [mine] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    await markSynced(ctx, [{ id: mine.id, fraction: 1, kind: "vacation" }]);
    await deleteLeaveDay(ctx, mine.id);
    expect(await closePendingDeletes(other)).toBe(0);
    expect(await rowOf(mine.id)).toBeDefined();
  });
});

describe("listing", () => {
  it("keeps to the window and orders by date then kind", async () => {
    await saveLeaveDay(ctx, { from: "2025-12-31", typeId: types.vacation, fraction: 1 });
    await saveLeaveDay(ctx, { from: "2026-06-17", typeId: types.vacation, fraction: 1 });
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol, fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 0.5 });

    const days = await listLeaveDays(ctx, WINDOW);
    expect(days.map((one) => [one.on, one.typeId])).toEqual(
      byDayThenType([
        [TUESDAY, types.rol],
        [TUESDAY, types.vacation],
        ["2026-06-17", types.vacation],
      ]),
    );
  });
});

describe("what a click on the calendar does (N3)", () => {
  it("the right button takes everything off a day, whatever is on it", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.rol, fraction: 0.5 });
    expect(await clearDay(ctx, TUESDAY)).toEqual({ deleted: 2, pending: 0 });
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(0);
  });

  it("a day Trek holds is not taken away until Trek agrees", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, typeId: types.vacation, fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    expect(await clearDay(ctx, TUESDAY)).toEqual({ deleted: 0, pending: 1 });
    expect((await listLeaveDays(ctx, WINDOW))[0].pending).toBe("delete");
  });

  it("clearing a day with nothing on it removes nothing and says so", async () => {
    // The caller no longer guesses whether a day is empty from a stale prop: it asks.
    expect(await clearDay(ctx, TUESDAY)).toEqual({ deleted: 0, pending: 0 });
  });
});
