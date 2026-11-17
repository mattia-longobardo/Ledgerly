/**
 * A range of leave against a real database (rewrite plan N5): one transaction for the whole range,
 * what it replaces, the state it hands back for "Undo", and the undo itself — which speaks to Trek
 * only through the `pending` column.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";
import { timeOffView } from "./queries";
import {
  MAX_RANGE_DAYS,
  TimeOffError,
  listLeaveDays,
  markSynced,
  removeLeave,
  removeLeaveRange,
  restoreLeave,
  saveAllowance,
  saveLeaveDay,
  saveLeaveRange,
  yearWindow,
} from "./service";

let ctx: Ctx;
let other: Ctx;
const WINDOW = yearWindow(2026);

/** Monday 15 June 2026 to Friday the 19th; the 13th and 14th are a weekend. */
const MON = "2026-06-15";
const TUE = "2026-06-16";
const WED = "2026-06-17";
const THU = "2026-06-18";
const FRI = "2026-06-19";

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  other = await newContext();
});

afterAll(closeDatabase);

/** The rows of the year as the assertions read them: date, kind, size, what Trek is owed. */
async function rows(of: Ctx = ctx) {
  return (await listLeaveDays(of, WINDOW)).map((row) => [row.on, row.kind, row.fraction, row.pending]);
}

describe("writing a range", () => {
  it("writes every working day of the range and leaves the others out", async () => {
    const result = await saveLeaveRange(ctx, { from: "2026-06-12", to: FRI, kind: "vacation", fraction: 1 });
    expect(result.days.map((day) => day.on)).toEqual(["2026-06-12", MON, TUE, WED, THU, FRI]);
    expect(result.totalDays).toBe(6);
    expect(await rows()).toHaveLength(6);
  });

  it("writes one day when the two ends are the same", async () => {
    const result = await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "comp", fraction: 0.5, note: "pm" });
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({ on: TUE, kind: "comp", fraction: "0.5", note: "pm" });
  });

  it("writes every row or none: a failure on one day leaves the whole range unwritten", async () => {
    // A ROL day in the range is replaced before the new rows go in; if the write then fails on a
    // later day, the replaced row has to be back as well — that is what one transaction is for.
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 1 });
    const before = await rows();

    await getDb().execute(
      sql.raw(`
        create function pg_temp_refuse_thursday() returns trigger language plpgsql as $$
        begin
          if new."on" = date '${THU}' and new.user_id = '${ctx.userId}' then
            raise exception 'refused for the test';
          end if;
          return new;
        end $$;
        create trigger refuse_thursday before insert on leave_days
          for each row execute function pg_temp_refuse_thursday();
      `),
    );
    try {
      await expect(
        saveLeaveRange(ctx, { from: MON, to: FRI, kind: "vacation", fraction: 1 }),
      ).rejects.toThrow();
    } finally {
      await getDb().execute(
        sql.raw(`drop trigger refuse_thursday on leave_days; drop function pg_temp_refuse_thursday();`),
      );
    }

    expect(await rows()).toEqual(before);
    // And with nothing in the way the same range goes in whole.
    await saveLeaveRange(ctx, { from: MON, to: FRI, kind: "vacation", fraction: 1 });
    expect((await rows()).map((row) => row[1])).toEqual(Array.from({ length: 5 }, () => "vacation"));
  });

  it("refuses a range with no day anybody works, and says why each day was refused", async () => {
    const refusal = await saveLeaveRange(ctx, {
      from: "2026-06-13",
      to: "2026-06-14",
      kind: "vacation",
      fraction: 1,
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TimeOffError);
    expect((refusal as TimeOffError).code).toBe("not_bookable");
    expect((refusal as TimeOffError).refused).toEqual([
      { on: "2026-06-13", reason: "weekend" },
      { on: "2026-06-14", reason: "weekend" },
    ]);
    expect(await rows()).toEqual([]);
  });

  it("refuses a range longer than anybody books in one go, and an impossible input", async () => {
    await expect(
      saveLeaveRange(ctx, { from: "2026-01-01", to: "2027-06-30", kind: "vacation", fraction: 1 }),
    ).rejects.toMatchObject({ code: "range_too_long" });
    expect(MAX_RANGE_DAYS).toBe(260);
    await expect(
      saveLeaveRange(ctx, { from: FRI, to: MON, kind: "vacation", fraction: 1 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      saveLeaveRange(ctx, { from: MON, to: MON, kind: "vacation", fraction: 0.3 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("marks only the leave that reaches Trek as pending, ROL included", async () => {
    expect((await saveLeaveRange(ctx, { from: MON, to: MON, kind: "rol", fraction: 1 })).trek).toBe(true);
    expect((await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "vacation", fraction: 1 })).trek).toBe(
      true,
    );
    expect((await saveLeaveRange(ctx, { from: WED, to: WED, kind: "other", fraction: 1 })).trek).toBe(false);
    expect(await rows()).toEqual([
      [MON, "rol", "1.0", "upsert"],
      [TUE, "vacation", "1.0", "upsert"],
      [WED, "other", "1.0", "none"],
    ]);
  });

  it("keeps one user's range out of another's days", async () => {
    await saveLeaveDay(other, { from: TUE, kind: "rol", fraction: 1 });
    await saveLeaveRange(ctx, { from: MON, to: WED, kind: "vacation", fraction: 1 });
    expect(await rows(other)).toEqual([[TUE, "rol", "1.0", "upsert"]]);
  });
});

describe("what a range replaces", () => {
  it("takes away a whole day of another kind, and hands back what the days held", async () => {
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 1, note: "dentist" });
    const result = await saveLeaveRange(ctx, { from: MON, to: WED, kind: "vacation", fraction: 1 });
    expect(await rows()).toEqual([
      [MON, "vacation", "1.0", "upsert"],
      [TUE, "vacation", "1.0", "upsert"],
      [WED, "vacation", "1.0", "upsert"],
    ]);
    expect(result.undo).toEqual({
      dates: [MON, TUE, WED],
      rows: [{ on: TUE, kind: "rol", fraction: 1, note: "dentist" }],
    });
  });

  it("marks a replaced day Trek holds for removal instead of deleting it", async () => {
    const [rol] = await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 1 });
    await markSynced(ctx, [{ id: rol.id, fraction: 1, kind: "vacation" }]);
    const result = await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "other", fraction: 1 });
    expect(await rows()).toEqual([
      [TUE, "other", "1.0", "none"],
      [TUE, "rol", "1.0", "delete"],
    ]);
    // "Other" never reaches Trek, but the removal does: the pass is worth starting.
    expect(result.trek).toBe(true);
  });

  it("keeps a half of another kind beside a new half", async () => {
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 0.5 });
    await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "vacation", fraction: 0.5 });
    expect(await rows()).toEqual([
      [TUE, "rol", "0.5", "upsert"],
      [TUE, "vacation", "0.5", "upsert"],
    ]);
  });

  it("updates the row of the same kind in place, keeping what Trek was observed holding", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    await saveLeaveRange(ctx, { from: MON, to: TUE, kind: "vacation", fraction: 0.5 });
    const row = (await listLeaveDays(ctx, WINDOW)).find((one) => one.on === TUE);
    expect(row).toMatchObject({ id: day.id, fraction: "0.5", pending: "upsert", trekFraction: "1.0" });
    expect(row?.syncedAt).not.toBeNull();
  });

  it("edits one row: the kind changes and the other half of the day stays", async () => {
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 0.5 });
    await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "comp", fraction: 0.5, editedKind: "vacation" });
    expect(await rows()).toEqual([
      [TUE, "comp", "0.5", "upsert"],
      [TUE, "rol", "0.5", "upsert"],
    ]);
  });
});

describe("half of one kind and half of another, in one step (decision of 17/11/2026)", () => {
  it("writes both halves of a free day in one call, both pending for Trek, and undo takes both away", async () => {
    const result = await saveLeaveRange(ctx, {
      from: TUE,
      to: TUE,
      kind: "vacation",
      fraction: 0.5,
      otherKind: "rol",
    });
    expect(await rows()).toEqual([
      [TUE, "rol", "0.5", "upsert"],
      [TUE, "vacation", "0.5", "upsert"],
    ]);
    expect(result.totalDays).toBe(1);
    expect(result.trek).toBe(true);
    expect(result.undo).toEqual({ dates: [TUE], rows: [] });
    await restoreLeave(ctx, result.undo);
    expect(await rows()).toEqual([]);
  });

  it("splits a whole day Trek holds: the row keeps its id and what Trek was observed holding", async () => {
    const [whole] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: whole.id, fraction: 1, kind: "vacation" }]);
    await saveLeaveRange(ctx, {
      from: TUE,
      to: TUE,
      kind: "vacation",
      fraction: 0.5,
      otherKind: "rol",
      editedKind: "vacation",
    });
    const stored = await listLeaveDays(ctx, WINDOW);
    expect(stored.map((row) => [row.on, row.kind, row.fraction, row.pending])).toEqual([
      [TUE, "rol", "0.5", "upsert"],
      [TUE, "vacation", "0.5", "upsert"],
    ]);
    expect(stored.find((row) => row.kind === "vacation")).toMatchObject({
      id: whole.id,
      trekFraction: "1.0",
    });
  });

  it("writes a range of split days, and the residual of both kinds counts half a day each", async () => {
    await saveAllowance(ctx, 2026, { vacationDays: 10, rolDays: 4, totalDays: null, note: null });
    await saveLeaveRange(ctx, { from: MON, to: FRI, kind: "vacation", fraction: 0.5, otherKind: "rol" });
    expect((await rows()).length).toBe(10);
    const view = await timeOffView(ctx, 2026);
    expect(view.vacation.residual.remainingMinutes).toBe(7.5 * view.minutesPerDay);
    expect(view.rol.residual.remainingMinutes).toBe(1.5 * view.minutesPerDay);
  });

  it("refuses a second half that is not a half, or of the same kind", async () => {
    for (const input of [
      { from: TUE, to: TUE, kind: "vacation" as const, fraction: 1, otherKind: "rol" as const },
      { from: TUE, to: TUE, kind: "vacation" as const, fraction: 0.5, otherKind: "vacation" as const },
    ]) {
      await expect(saveLeaveRange(ctx, input)).rejects.toThrow(TimeOffError);
    }
    expect(await rows()).toEqual([]);
  });
});

describe("removing, with the state before", () => {
  it("removes one row by its id and says what the day held", async () => {
    const [vacation] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 0.5, note: "am" });
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 0.5 });
    const removed = await removeLeave(ctx, { id: vacation.id });
    expect(removed).toEqual({
      deleted: 1,
      pending: 0,
      undo: {
        dates: [TUE],
        rows: [
          { on: TUE, kind: "rol", fraction: 0.5, note: null },
          { on: TUE, kind: "vacation", fraction: 0.5, note: "am" },
        ],
      },
    });
    expect(await rows()).toEqual([[TUE, "rol", "0.5", "upsert"]]);
  });

  it("removes everything on a date, and counts what Trek still has to be told", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    expect(await removeLeave(ctx, { date: TUE })).toMatchObject({ deleted: 0, pending: 1 });
    expect(await rows()).toEqual([[TUE, "vacation", "1.0", "delete"]]);
  });

  it("refuses somebody else's row, and removes nothing on an empty date", async () => {
    const [theirs] = await saveLeaveDay(other, { from: TUE, kind: "vacation", fraction: 1 });
    await expect(removeLeave(ctx, { id: theirs.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await removeLeave(ctx, { date: TUE })).toEqual({
      deleted: 0,
      pending: 0,
      undo: { dates: [TUE], rows: [] },
    });
    expect(await rows(other)).toHaveLength(1);
  });
});

describe("a row Trek still has to let go of (pending = 'delete')", () => {
  it("is no longer part of the day: half of the other kind beside it is the other half, nothing replaced", async () => {
    const [vacation] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: vacation.id, fraction: 1, kind: "vacation" }]);
    // The whole vacation day becomes half a day of ROL: the vacation row waits for Trek.
    await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "rol", fraction: 0.5, editedKind: "vacation" });
    // "Add the other half": half a day of vacation beside the ROL.
    const result = await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "vacation", fraction: 0.5 });
    expect(await rows()).toEqual([
      [TUE, "rol", "0.5", "upsert"],
      [TUE, "vacation", "0.5", "upsert"],
    ]);
    expect(result.undo).toEqual({
      dates: [TUE],
      rows: [{ on: TUE, kind: "rol", fraction: 0.5, note: null }],
    });
  });

  it("is out of the calendar and of the balances, and still in the table", async () => {
    await saveAllowance(ctx, 2026, { vacationDays: 20, rolDays: null, totalDays: null, note: null });
    const [vacation] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: vacation.id, fraction: 1, kind: "vacation" }]);
    const before = await timeOffView(ctx, 2026);
    expect(before.vacation.residual.plannedMinutes).toBeGreaterThan(0);

    await removeLeave(ctx, { id: vacation.id });
    const view = await timeOffView(ctx, 2026);
    const cell = view.calendar[5].weeks.flat().find((one) => one.date === TUE);
    expect(cell?.kinds).toEqual([]);
    expect(view.vacation.residual.plannedMinutes).toBe(0);
    expect(view.rows).toContainEqual(expect.objectContaining({ on: TUE, pending: "delete" }));
  });
});

describe("removing a range (decision of 17/11/2026, N5 §7.5)", () => {
  it("removes every booked row of the range in one go: Trek's rows wait for the pass, one per row", async () => {
    await saveLeaveDay(ctx, { from: MON, kind: "vacation", fraction: 1, note: "mine" });
    const [held] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: held.id, fraction: 1, kind: "vacation" }]);
    await saveLeaveDay(ctx, { from: THU, kind: "vacation", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: THU, kind: "rol", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: "2026-06-22", kind: "vacation", fraction: 1 });
    await saveLeaveDay(other, { from: WED, kind: "vacation", fraction: 1 });

    const removed = await removeLeaveRange(ctx, { from: MON, to: FRI });
    expect(removed).toEqual({
      days: 3,
      deleted: 3,
      pending: 1,
      undo: {
        dates: [MON, TUE, THU],
        rows: [
          { on: MON, kind: "vacation", fraction: 1, note: "mine" },
          { on: TUE, kind: "vacation", fraction: 1, note: null },
          { on: THU, kind: "rol", fraction: 0.5, note: null },
          { on: THU, kind: "vacation", fraction: 0.5, note: null },
        ],
      },
    });
    expect(await rows()).toEqual([
      [TUE, "vacation", "1.0", "delete"],
      ["2026-06-22", "vacation", "1.0", "upsert"],
    ]);
    expect(await rows(other)).toHaveLength(1);

    // "Undo" brings every day back, in one call.
    if (removed.undo === null) throw new Error("expected an undo");
    await restoreLeave(ctx, removed.undo);
    expect(await rows()).toEqual([
      [MON, "vacation", "1.0", "upsert"],
      [TUE, "vacation", "1.0", "upsert"],
      [THU, "rol", "0.5", "upsert"],
      [THU, "vacation", "0.5", "upsert"],
      ["2026-06-22", "vacation", "1.0", "upsert"],
    ]);
  });

  it("does nothing on a range with nothing booked, and refuses a range that cannot be", async () => {
    const [held] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await markSynced(ctx, [{ id: held.id, fraction: 1, kind: "vacation" }]);
    await removeLeave(ctx, { id: held.id });
    // A row already waiting for Trek is not removed a second time.
    expect(await removeLeaveRange(ctx, { from: MON, to: FRI })).toEqual({
      days: 0,
      deleted: 0,
      pending: 0,
      undo: null,
    });
    await expect(removeLeaveRange(ctx, { from: FRI, to: MON })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(removeLeaveRange(ctx, { from: "2026-01-01", to: "2026-12-31" })).rejects.toMatchObject({
      code: "range_too_long",
    });
  });
});

describe("undo", () => {
  it("takes a row created and undone before any sync away for good: Trek never hears of it", async () => {
    const result = await saveLeaveRange(ctx, { from: MON, to: WED, kind: "vacation", fraction: 1 });
    expect(await restoreLeave(ctx, result.undo)).toEqual({ trek: false });
    expect(await rows()).toEqual([]);
  });

  it("puts a row Trek knows back in the queue, with what Trek was observed holding", async () => {
    const [day] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1, note: "trip" });
    await markSynced(ctx, [{ id: day.id, fraction: 1, kind: "vacation" }]);
    const removed = await removeLeave(ctx, { id: day.id });
    expect(await rows()).toEqual([[TUE, "vacation", "1.0", "delete"]]);

    expect(await restoreLeave(ctx, removed.undo)).toEqual({ trek: true });
    const [row] = await listLeaveDays(ctx, WINDOW);
    expect(row).toMatchObject({
      id: day.id,
      note: "trip",
      pending: "upsert",
      trekFraction: "1.0",
      trekKind: "vacation",
    });
    expect(row.syncedAt).not.toBeNull();
  });

  it("puts the replaced rows back and takes the new ones away, in one go", async () => {
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 0.5, note: "dentist" });
    await saveLeaveDay(ctx, { from: WED, kind: "other", fraction: 1 });
    const before = await rows();
    const result = await saveLeaveRange(ctx, { from: MON, to: FRI, kind: "vacation", fraction: 1 });
    expect(await rows()).toHaveLength(5);

    await restoreLeave(ctx, result.undo);
    expect(await rows()).toEqual(before);
    expect((await listLeaveDays(ctx, WINDOW))[0].note).toBe("dentist");
  });

  it("undoes an edit: kind, size and note of before", async () => {
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1, note: "trip" });
    const result = await saveLeaveRange(ctx, {
      from: TUE,
      to: TUE,
      kind: "rol",
      fraction: 0.5,
      note: "",
      editedKind: "vacation",
    });
    expect(await rows()).toEqual([[TUE, "rol", "0.5", "upsert"]]);
    await restoreLeave(ctx, result.undo);
    const days = await listLeaveDays(ctx, WINDOW);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ kind: "vacation", fraction: "1.0", note: "trip" });
  });

  it("leaves alone a row that is as it was, so nothing is queued for Trek without a reason", async () => {
    const [rol] = await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 0.5 });
    await markSynced(ctx, [{ id: rol.id, fraction: 0.5, kind: "vacation" }]);
    const result = await saveLeaveRange(ctx, { from: TUE, to: TUE, kind: "other", fraction: 0.5 });
    expect(await restoreLeave(ctx, result.undo)).toEqual({ trek: false });
    expect(await rows()).toEqual([[TUE, "rol", "0.5", "none"]]);
  });

  it("is not a way round the calendar, nor into somebody else's days", async () => {
    await expect(
      restoreLeave(ctx, {
        dates: ["2026-06-13"],
        rows: [{ on: "2026-06-13", kind: "vacation", fraction: 1, note: null }],
      }),
    ).rejects.toMatchObject({ code: "not_bookable" });
    await expect(
      restoreLeave(ctx, { dates: [MON], rows: [{ on: TUE, kind: "vacation", fraction: 1, note: null }] }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await saveLeaveDay(other, { from: TUE, kind: "vacation", fraction: 1 });
    await restoreLeave(ctx, { dates: [TUE], rows: [] });
    expect(await rows(other)).toHaveLength(1);
    expect(await rows()).toEqual([]);
  });
});
