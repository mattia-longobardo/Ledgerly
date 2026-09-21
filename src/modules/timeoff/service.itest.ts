/**
 * The time off service against a real database (plan F7 L1): allowances, days, ranges, and the
 * whole life of `pending` — saved, sent, synced, removed, gone.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPreferences, updatePreferences } from "@/modules/users/service";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
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
  pendingForTrek,
  recordFromTrek,
  saveAllowance,
  clearDay,
  cycleDay,
  halveDay,
  saveLeaveDay,
  splitDay,
  yearWindow,
} from "./service";

let ctx: Ctx;
let other: Ctx;
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
});

afterAll(closeDatabase);

/** The whole preferences object round-tripped, because `updatePreferences` validates all of it. */
async function setPatron(patronSaint: { month: number; day: number } | null): Promise<void> {
  await updatePreferences(ctx, { ...(await getPreferences(ctx)), patronSaint });
}

async function rowOf(id: string) {
  const [row] = await getDb()
    .select()
    .from(leaveDays)
    .where(and(eq(leaveDays.id, id), userScoped(ctx).owns(leaveDays)));
  return row;
}

describe("allowances", () => {
  it("states a year, replaces it, and keeps users apart", async () => {
    await saveAllowance(ctx, YEAR, { vacationDays: 26, rolDays: 4, note: "CCNL" });
    let allowance = await allowanceOf(ctx, YEAR);
    expect(allowance).toMatchObject({ vacationDays: "26.00", rolDays: "4.00" });

    // The same year again replaces the row rather than failing on the unique key.
    await saveAllowance(ctx, YEAR, { vacationDays: 28, rolDays: null });
    allowance = await allowanceOf(ctx, YEAR);
    expect(allowance).toMatchObject({ vacationDays: "28.00", rolDays: null });
    expect(await listAllowances(ctx)).toHaveLength(1);

    expect(await allowanceOf(other, YEAR)).toBeNull();
  });

  it("is null for a year nobody has stated, rather than a zero nobody meant", async () => {
    expect(await allowanceOf(ctx, YEAR)).toBeNull();
  });

  it("lists the years oldest first", async () => {
    await saveAllowance(ctx, 2027, { vacationDays: 26, rolDays: null });
    await saveAllowance(ctx, 2025, { vacationDays: 24, rolDays: null });
    expect((await listAllowances(ctx)).map((one) => one.year)).toEqual([2025, 2027]);
  });

  it("records the contract's total beside the two parts it is made of (N7)", async () => {
    // Both parts in days since N9: ROL is no longer the one figure stated in another unit.
    await saveAllowance(ctx, YEAR, { vacationDays: 26, rolDays: 4, totalDays: 30 });
    expect(await allowanceOf(ctx, YEAR)).toMatchObject({
      vacationDays: "26.00",
      rolDays: "4.00",
      totalDays: "30.00",
    });
  });

  it("clears the ROL days and the total when the year is stated again without them", async () => {
    // The upsert replaces the whole row: a figure removed from the modal is a figure removed from
    // the allowance, not one that quietly survives from the version before.
    await saveAllowance(ctx, YEAR, { vacationDays: 26, rolDays: 4, totalDays: 30 });
    await saveAllowance(ctx, YEAR, { vacationDays: 26 });
    expect(await allowanceOf(ctx, YEAR)).toMatchObject({ rolDays: null, totalDays: null });
  });

  it("refuses an impossible year and a negative allowance", async () => {
    await expect(saveAllowance(ctx, 1800, { vacationDays: 26, rolDays: null })).rejects.toThrow(TimeOffError);
    await expect(saveAllowance(ctx, YEAR, { vacationDays: -1, rolDays: null })).rejects.toThrow(TimeOffError);
    await expect(saveAllowance(ctx, YEAR, { rolDays: -1 })).rejects.toThrow(TimeOffError);
    await expect(saveAllowance(ctx, YEAR, { totalDays: 401 })).rejects.toThrow(TimeOffError);
  });
});

describe("saving a day", () => {
  it("saves one working day, pending for Trek", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    expect(day).toMatchObject({ on: TUESDAY, kind: "vacation", fraction: "1.0", pending: "upsert" });
    expect(day.origin).toBe("manual");
    expect(day.syncedAt).toBeNull();
  });

  it("books ROL in half days and whole ones, like every other kind (N0)", async () => {
    // ROL used to be free-form minutes, which made it the one kind the calendar could not draw.
    const [half] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.5 });
    expect(half).toMatchObject({ on: TUESDAY, kind: "rol", fraction: "0.5" });
    const [whole] = await saveLeaveDay(ctx, { from: "2026-06-17", kind: "rol", fraction: 1 });
    expect(whole.fraction).toBe("1.0");
  });

  it("takes a whole day when the caller states no size", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol" });
    expect(day.fraction).toBe("1.0");
  });

  it("refuses a single weekend day and a single holiday, and says which", async () => {
    const weekend = await saveLeaveDay(ctx, { from: SATURDAY, kind: "vacation", fraction: 1 }).catch(
      (error: unknown) => error,
    );
    expect(weekend).toBeInstanceOf(TimeOffError);
    expect((weekend as TimeOffError).code).toBe("not_bookable");
    expect((weekend as TimeOffError).refused).toEqual([{ on: SATURDAY, reason: "weekend" }]);

    const holiday = await saveLeaveDay(ctx, { from: HOLIDAY, kind: "vacation", fraction: 1 }).catch(
      (error: unknown) => error,
    );
    expect((holiday as TimeOffError).refused).toEqual([{ on: HOLIDAY, reason: "holiday" }]);
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(0);
  });

  it("refuses the patron saint the user has set, and accepts it once they have not", async () => {
    // 7 December 2026 is a Monday, so only the patron saint can refuse it.
    await setPatron({ month: 12, day: 7 });
    await expect(saveLeaveDay(ctx, { from: "2026-12-07", kind: "vacation", fraction: 1 })).rejects.toThrow(
      TimeOffError,
    );
    await setPatron(null);
    const [day] = await saveLeaveDay(ctx, { from: "2026-12-07", kind: "vacation", fraction: 1 });
    expect(day.on).toBe("2026-12-07");
  });

  it("writes only the working days of a range, silently", async () => {
    // Friday 12 June to Tuesday 16 June: the Saturday and Sunday are not written, and not an error.
    const written = await saveLeaveDay(ctx, {
      from: "2026-06-12",
      to: TUESDAY,
      kind: "vacation",
      fraction: 1,
    });
    expect(written.map((one) => one.on)).toEqual(["2026-06-12", "2026-06-15", "2026-06-16"]);
  });

  it("refuses a range made only of days nobody can book", async () => {
    await expect(
      saveLeaveDay(ctx, { from: SATURDAY, to: "2026-06-14", kind: "vacation", fraction: 1 }),
    ).rejects.toThrow(TimeOffError);
  });

  it("refuses a range longer than anybody books in one go", async () => {
    const error = await saveLeaveDay(ctx, {
      from: "2026-01-01",
      to: "2026-12-31",
      kind: "vacation",
      fraction: 1,
    }).catch((e: unknown) => e);
    expect((error as TimeOffError).code).toBe("range_too_long");
    expect(365).toBeGreaterThan(MAX_RANGE_DAYS);
  });

  it("updates a day already saved for the same kind instead of failing", async () => {
    const [first] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    const [second] = await saveLeaveDay(ctx, {
      from: TUESDAY,
      kind: "vacation",
      fraction: 0.5,
      note: "afternoon",
    });
    expect(second.id).toBe(first.id);
    expect(second.fraction).toBe("0.5");
    expect(second.note).toBe("afternoon");
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(1);
  });

  it("lets two kinds share one day", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.5 });
    const days = await listLeaveDays(ctx, WINDOW);
    expect(days.map((one) => one.kind)).toEqual(["rol", "vacation"]);
  });

  it("marks only the leave that reaches Trek as pending (N4)", async () => {
    const [rol] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.5 });
    const [comp] = await saveLeaveDay(ctx, { from: "2026-06-17", kind: "comp", fraction: 1 });
    const [sick] = await saveLeaveDay(ctx, { from: "2026-06-18", kind: "sick", fraction: 1 });
    const [other_] = await saveLeaveDay(ctx, { from: "2026-06-19", kind: "other", fraction: 1 });

    // ROL is leave that spends the year, so it goes across too: a day that is not on Trek reads
    // to a colleague as a day at work, whichever box it came out of here.
    expect([rol.pending, comp.pending]).toEqual(["upsert", "upsert"]);
    // Sickness and "other" are absences of another kind, and never leave this app.
    expect([sick.pending, other_.pending]).toEqual(["none", "none"]);

    // …and neither of those two is ever offered to a pass.
    expect((await pendingForTrek(ctx, WINDOW)).map((one) => one.kind)).toEqual(["rol", "comp"]);
  });

  it("refuses a size that is neither half a day nor a whole one", async () => {
    await expect(saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.25 })).rejects.toThrow(
      TimeOffError,
    );
    await expect(saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 2 })).rejects.toThrow(
      TimeOffError,
    );
  });

  it("keeps one user's days out of another's", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    await saveLeaveDay(other, { from: TUESDAY, kind: "vacation", fraction: 1 });
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(1);
    expect(await listLeaveDays(other, WINDOW)).toHaveLength(1);
  });
});

describe("the life of a pending state (plan §3.4.7)", () => {
  it("goes saved → upsert → synced → delete → gone", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    expect(day.pending).toBe("upsert");

    // The pass offered it, sent it, re-read the year and saw Trek holding a whole day.
    expect((await pendingForTrek(ctx, WINDOW)).map((one) => one.id)).toEqual([day.id]);
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    const synced = await rowOf(day.id);
    expect(synced).toMatchObject({ pending: "none", trekFraction: "1.0", trekKind: "vacation" });
    expect(synced.syncedAt).not.toBeNull();
    expect(await pendingForTrek(ctx, WINDOW)).toHaveLength(0);

    // Removing it does not remove it yet: Trek has to be told first.
    expect(await deleteLeaveDay(ctx, day.id)).toBe("pending");
    expect((await rowOf(day.id)).pending).toBe("delete");
    expect((await pendingForTrek(ctx, WINDOW))[0]).toMatchObject({
      pending: "delete",
      trekFraction: 1,
      trekKind: "vacation",
    });

    // The pass re-read the year and Trek no longer has the day: now it really goes.
    await markSynced(ctx, [{ id: day.id, fraction: null, kind: null }]);
    expect(await rowOf(day.id)).toBeUndefined();
  });

  it("deletes a day Trek never heard of outright", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    expect(await deleteLeaveDay(ctx, day.id)).toBe("deleted");
    expect(await rowOf(day.id)).toBeUndefined();
  });

  it("deletes a kind Trek is never told about outright, because Trek is not involved", async () => {
    const [sick] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "sick", fraction: 1 });
    expect(await deleteLeaveDay(ctx, sick.id)).toBe("deleted");
  });

  it("puts an edited day back in the queue without forgetting what Trek holds", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 0.5 });

    const edited = await rowOf(day.id);
    expect(edited.pending).toBe("upsert");
    expect(edited.fraction).toBe("0.5");
    // The observed pair is untouched: the pass still has to send the whole day to remove it.
    expect(edited.trekFraction).toBe("1.0");
    expect(edited.syncedAt).not.toBeNull();
  });

  it("refuses to remove somebody else's day", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    await expect(deleteLeaveDay(other, day.id)).rejects.toThrow(TimeOffError);
    expect(await rowOf(day.id)).toBeDefined();
  });
});

describe("what a pass brings back", () => {
  it("records a day Trek had and we did not", async () => {
    const recorded = await recordFromTrek(ctx, { on: TUESDAY, kind: "vacation", fraction: 0.5 });
    expect(recorded).toMatchObject({
      origin: "trek",
      pending: "none",
      fraction: "0.5",
      trekFraction: "0.5",
      trekKind: "vacation",
    });
    expect(recorded?.syncedAt).not.toBeNull();
  });

  it("reconciles a day we already held, without duplicating it", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    const recorded = await recordFromTrek(ctx, { on: TUESDAY, kind: "vacation", fraction: 1 });
    expect(recorded?.id).toBe(day.id);
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(1);
    expect(recorded?.pending).toBe("none");
  });

  it("leaves a day we classify differently alone", async () => {
    // We hold the day as ROL; Trek shows a `comp`. Two rows, and ours is untouched.
    const [rol] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.5 });
    await recordFromTrek(ctx, { on: TUESDAY, kind: "comp", fraction: 0.5 });
    const days = await listLeaveDays(ctx, WINDOW);
    expect(days).toHaveLength(2);
    expect(await rowOf(rol.id)).toMatchObject({ kind: "rol", fraction: "0.5", origin: "manual" });
  });
});

describe("unlinking Trek (plan §3.4.10)", () => {
  it("closes every pending removal, because nobody is left to ask", async () => {
    const [first] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    const [second] = await saveLeaveDay(ctx, { from: "2026-06-17", kind: "vacation", fraction: 1 });
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
    const [mine] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: mine.id, fraction: 1, kind: "vacation" }]);
    await deleteLeaveDay(ctx, mine.id);
    expect(await closePendingDeletes(other)).toBe(0);
    expect(await rowOf(mine.id)).toBeDefined();
  });
});

describe("listing", () => {
  it("keeps to the window and orders by date then kind", async () => {
    await saveLeaveDay(ctx, { from: "2025-12-31", kind: "vacation", fraction: 1 });
    await saveLeaveDay(ctx, { from: "2026-06-17", kind: "vacation", fraction: 1 });
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 0.5 });

    const days = await listLeaveDays(ctx, WINDOW);
    expect(days.map((one) => [one.on, one.kind])).toEqual([
      [TUESDAY, "rol"],
      [TUESDAY, "vacation"],
      ["2026-06-17", "vacation"],
    ]);
  });
});

describe("what a click on the calendar does (N3)", () => {
  it("walks a day round: nothing, vacation, ROL, vacation again", async () => {
    expect(await cycleDay(ctx, TUESDAY)).toEqual({ kind: "vacation" });
    expect((await listLeaveDays(ctx, WINDOW))[0]).toMatchObject({
      kind: "vacation",
      fraction: "1.0",
      pending: "upsert",
    });

    expect(await cycleDay(ctx, TUESDAY)).toEqual({ kind: "rol" });
    let rows = await listLeaveDays(ctx, WINDOW);
    // One row, not two: the day changed kind, it did not gain one.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "rol", fraction: "1.0" });

    expect(await cycleDay(ctx, TUESDAY)).toEqual({ kind: "vacation" });
    rows = await listLeaveDays(ctx, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("vacation");
  });

  it("keeps the size when the kind changes: a half day stays a half day", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 0.5 });
    await cycleDay(ctx, TUESDAY);
    expect((await listLeaveDays(ctx, WINDOW))[0]).toMatchObject({ kind: "rol", fraction: "0.5" });
  });

  it("refuses a day nobody can work, and says which reason", async () => {
    const error = await cycleDay(ctx, SATURDAY).catch((e: unknown) => e);
    expect((error as TimeOffError).code).toBe("not_bookable");
    expect((error as TimeOffError).refused).toEqual([{ on: SATURDAY, reason: "weekend" }]);
  });

  it("will not speak for a day that carries something a dialog stated", async () => {
    // Sickness is not part of the cycle, and a click must never overwrite it.
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "sick", fraction: 1 });
    await expect(cycleDay(ctx, TUESDAY)).rejects.toThrow(TimeOffError);
    expect((await listLeaveDays(ctx, WINDOW))[0].kind).toBe("sick");
  });

  it("will not speak for a day already split between two kinds", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.5 });
    await expect(cycleDay(ctx, TUESDAY)).rejects.toThrow(TimeOffError);
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(2);
  });

  it("holding turns a whole day into a half, and back again", async () => {
    await cycleDay(ctx, TUESDAY);
    expect(await halveDay(ctx, TUESDAY)).toEqual({ fraction: 0.5 });
    expect((await listLeaveDays(ctx, WINDOW))[0]).toMatchObject({
      fraction: "0.5",
      // The size changed, so Trek has something to hear about again.
      pending: "upsert",
    });

    expect(await halveDay(ctx, TUESDAY)).toEqual({ fraction: 1 });
    expect((await listLeaveDays(ctx, WINDOW))[0].fraction).toBe("1.0");
  });

  it("holding keeps what Trek was observed holding, which a removal still needs", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    await halveDay(ctx, TUESDAY);

    const [after] = await listLeaveDays(ctx, WINDOW);
    expect(after).toMatchObject({ fraction: "0.5", trekFraction: "1.0", trekKind: "vacation" });
    expect(after.syncedAt).not.toBeNull();
  });

  it("holding refuses what a click refuses", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "sick", fraction: 1 });
    await expect(halveDay(ctx, TUESDAY)).rejects.toThrow(TimeOffError);
    await expect(halveDay(ctx, "2026-06-17")).rejects.toThrow(TimeOffError);
  });

  it("the right button takes everything off a day, whatever is on it", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 0.5 });
    expect(await clearDay(ctx, TUESDAY)).toEqual({ deleted: 2, pending: 0 });
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(0);
  });

  it("a day Trek holds is not taken away until Trek agrees", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    expect(await clearDay(ctx, TUESDAY)).toEqual({ deleted: 0, pending: 1 });
    expect((await listLeaveDays(ctx, WINDOW))[0].pending).toBe("delete");
  });

  it("clearing a day with nothing on it removes nothing and says so", async () => {
    // The caller no longer guesses whether a day is empty from a stale prop: it asks.
    expect(await clearDay(ctx, TUESDAY)).toEqual({ deleted: 0, pending: 0 });
  });
});

describe("the right button held down (N10)", () => {
  it("makes a day half vacation and half ROL, and holding again puts it back together", async () => {
    expect(await splitDay(ctx, TUESDAY)).toEqual({ split: true });
    const halves = await listLeaveDays(ctx, WINDOW);
    expect(halves.map((row) => [row.kind, row.fraction])).toEqual([
      ["rol", "0.5"],
      ["vacation", "0.5"],
    ]);
    // Both halves go to Trek, which has no ROL and takes them as vacation.
    expect(halves.every((row) => row.pending === "upsert")).toBe(true);

    expect(await splitDay(ctx, TUESDAY)).toEqual({ split: false });
    expect((await listLeaveDays(ctx, WINDOW)).map((row) => [row.kind, row.fraction])).toEqual([
      ["vacation", "1.0"],
    ]);
  });

  it("splits a day that already carries one of the two kinds, whole or half", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "rol", fraction: 1 });
    await splitDay(ctx, TUESDAY);
    expect((await listLeaveDays(ctx, WINDOW)).map((row) => row.fraction)).toEqual(["0.5", "0.5"]);
  });

  it("keeps the note somebody wrote on the day", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1, note: "dentist" });
    await splitDay(ctx, TUESDAY);
    expect((await listLeaveDays(ctx, WINDOW)).every((row) => row.note === "dentist")).toBe(true);
  });

  it("keeps what Trek was observed holding, which a removal still needs", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    await splitDay(ctx, TUESDAY);

    const vacation = (await listLeaveDays(ctx, WINDOW)).find((row) => row.kind === "vacation");
    expect(vacation).toMatchObject({ fraction: "0.5", trekFraction: "1.0", trekKind: "vacation" });
    // The ROL half is new: Trek never held it, and a toggle sent for it would create, not remove.
    const rol = (await listLeaveDays(ctx, WINDOW)).find((row) => row.kind === "rol");
    expect(rol).toMatchObject({ trekFraction: null, trekKind: null, syncedAt: null });
  });

  it("refuses what every other shortcut refuses", async () => {
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "sick", fraction: 1 });
    await expect(splitDay(ctx, TUESDAY)).rejects.toThrow(TimeOffError);
    // A day nobody works is refused with its reason, as a click on one is.
    const error = await splitDay(ctx, SATURDAY).catch((e: unknown) => e);
    expect((error as TimeOffError).code).toBe("not_bookable");
  });

  it("will not speak for a day split some other way", async () => {
    // Half vacation and half sickness is somebody's statement, not this gesture's doing.
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "vacation", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUESDAY, kind: "sick", fraction: 0.5 });
    await expect(splitDay(ctx, TUESDAY)).rejects.toThrow(TimeOffError);
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(2);
  });
});
