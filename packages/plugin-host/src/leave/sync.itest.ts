/**
 * A whole Trek pass against a real database and a fake Trek (plan F7 L4, §3.5).
 *
 * What these tests are really defending: **no repeated pass ever deletes a day**. The toggle is
 * its own inverse, so a pass that runs twice over a settled year must send nothing at all — and a
 * pass whose send failed must leave the row pending and try again next time, after reading again.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteLeaveDay,
  listLeaveDays,
  markSynced,
  pendingCount,
  removeLeave,
  restoreLeave,
  saveLeaveDay,
  saveLeaveRange,
  yearWindow,
} from "@domain/modules/timeoff/service";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { newContext } from "../../../../test/fixtures";
import { fakeTrek } from "../../../../test/fixtures/trek/fake-trek";
import { servedCalendar } from "../../../../test/fixtures/trek/served-plugin";
import {
  listConnections,
  listRuns,
  markConnection,
  saveConnection,
} from "@domain/platform/integrations/service";
import type { CalendarCalls } from "./calls";
import { isCalendarBusy, syncCalendarNow, calendarFiguresOf } from "./sync";
import { TREK_PROVIDER } from "../../../../test/fixtures/providers";
import { oldLeaveTypes, type OldTypes } from "../../../../test/leave-types";

let ctx: Ctx;
let types: OldTypes;
const YEAR = 2026;
const WINDOW = yearWindow(YEAR);
/** All working days: 2026-06-16 is a Tuesday, the 17th a Wednesday, the 18th a Thursday. */
const TUE = "2026-06-16";
const WED = "2026-06-17";
const THU = "2026-06-18";

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  types = await oldLeaveTypes(ctx);
  await saveConnection(ctx, {
    provider: TREK_PROVIDER,
    credentials: { baseUrl: "https://trek.example", clientId: "trekci_test", clientSecret: "trekcs_test" },
  });
});

afterAll(closeDatabase);

type Trek = ReturnType<typeof fakeTrek>;

/**
 * A pass through the real plugin, served in-process, on a Trek that really holds a year: the toggle
 * behaves exactly as the real one does, so a test can make the mistake the whole design guards
 * against and see the day disappear.
 */
const pass = (trek: Trek, calls: CalendarCalls = servedCalendar(trek.fetch)) =>
  syncCalendarNow(ctx, { calls, years: [YEAR] });

/** The dates Trek holds for the person now. */
const dates = (trek: Trek) => trek.held().map((one) => one.split(" ")[0]);

/** The id of this user's Trek connection. */
async function connectionId(): Promise<string> {
  const connection = (await listConnections(ctx)).find((one) => one.provider === TREK_PROVIDER);
  if (!connection) throw new Error("no Trek connection");
  return connection.id;
}

async function rowOn(date: string) {
  return (await listLeaveDays(ctx, WINDOW)).find((row) => row.on === date) ?? null;
}

describe("a pass", () => {
  it("sends a new day, and the row stops being pending", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    expect(day.pending).toBe("upsert");

    const result = await pass(trek);
    expect(result?.counts.applied).toBe(1);
    expect(dates(trek)).toEqual([TUE]);

    const after = await rowOn(TUE);
    expect(after).toMatchObject({ pending: "none", observedFraction: "1.0", observedKind: "vacation" });
    expect(after?.syncedAt).not.toBeNull();
    expect(await pendingCount(ctx)).toBe(0);
  });

  it("A SECOND PASS SENDS NOTHING — the day survives", async () => {
    // The whole point of the phase. A toggle fired again on an agreed day deletes it.
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    const togglesAfterFirst = trek.toggles.length;

    const second = await pass(trek);
    expect(trek.toggles).toHaveLength(togglesAfterFirst);
    expect(second?.counts.applied).toBe(0);
    expect(second?.counts.unchanged).toBe(1);
    expect(dates(trek)).toEqual([TUE]);

    // And a third, for good measure.
    await pass(trek);
    expect(dates(trek)).toEqual([TUE]);
  });

  it("removes a day by sending back the pair Trek was observed holding", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 0.5 });
    await pass(trek);
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 0.5, kind: "vacation" });

    expect(await deleteLeaveDay(ctx, day.id)).toBe("pending");
    await pass(trek);

    expect(dates(trek)).toEqual([]);
    // Only once Trek has really let go does the row go.
    expect(await rowOn(TUE)).toBeNull();
    expect(await pendingCount(ctx)).toBe(0);
  });

  it("does not remove a day twice when the pass runs again", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    await deleteLeaveDay(ctx, day.id);
    await pass(trek);
    const togglesAfter = trek.toggles.length;

    // Nothing is pending any more, and the second pass must not recreate the day by toggling it.
    await pass(trek);
    expect(trek.toggles).toHaveLength(togglesAfter);
    expect(dates(trek)).toEqual([]);
  });

  it("changes a day's fraction with an update, not a remove-and-add", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 0.5 });
    await pass(trek);

    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 0.5 });
    expect(trek.toggles.at(-1)?.action).toBe("updated");
    expect(await rowOn(TUE)).toMatchObject({ pending: "none", observedFraction: "0.5" });
  });

  it("leaves a failed send pending, and settles it on the next pass", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    trek.failNextToggles(1);

    const first = await pass(trek);
    expect(first?.counts.failed).toBe(1);
    expect(dates(trek)).toEqual([]);
    // Still ours to send: the row did not quietly become "done".
    expect(await rowOn(TUE)).toMatchObject({ pending: "upsert" });
    expect(await pendingCount(ctx)).toBe(1);

    // And the run says the pass failed, so the log does not claim everything is well.
    const runs = await listRuns(ctx, { limit: 5 });
    expect(runs[0]).toMatchObject({ kind: "leave", state: "failed" });

    const second = await pass(trek);
    expect(second?.counts.applied).toBe(1);
    expect(dates(trek)).toEqual([TUE]);
    expect(await rowOn(TUE)).toMatchObject({ pending: "none" });
  });

  it("a removal that did not land is not a conflict, and is never adopted back", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    await deleteLeaveDay(ctx, day.id);

    // Trek refuses the removal this time round.
    trek.failNextToggles(1);
    const result = await pass(trek);
    expect(result?.conflicts).toEqual([]);
    expect(result?.counts.adopted).toBe(0);
    // The row is still ours, still asking to go, and Trek still has the day.
    expect(await rowOn(TUE)).toMatchObject({ pending: "delete" });
    expect(dates(trek)).toEqual([TUE]);
    // And no second row was invented beside it.
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(1);

    // Next pass settles it, as it should.
    await pass(trek);
    expect(dates(trek)).toEqual([]);
    expect(await rowOn(TUE)).toBeNull();
  });

  it("adopts a day Trek has that we do not", async () => {
    const trek = fakeTrek({
      entries: [{ id: 1, user_id: null, date: WED, note: "", fraction: 1, kind: "vacation" }],
    });
    const result = await pass(trek);

    expect(result?.counts.adopted).toBe(1);
    const adopted = await rowOn(WED);
    expect(adopted).toMatchObject({
      origin: "external",
      kind: "vacation",
      fraction: "1.0",
      pending: "none",
      observedKind: "vacation",
    });
    // Adopting it must not then send it back.
    expect(trek.toggles).toHaveLength(0);
  });

  it("marks a day Trek does not take as refused, and keeps it owed", async () => {
    const trek = fakeTrek({ weekend: [TUE] });
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });

    const result = await pass(trek);
    expect(result?.counts).toMatchObject({ refused: 1, applied: 0, failed: 0 });
    expect(await rowOn(TUE)).toMatchObject({ pending: "upsert", externalState: "refused" });
    expect((await listRuns(ctx, { limit: 1 }))[0]).toMatchObject({ state: "success" });
  });

  it("does not rewrite a day we classify differently — it reports it", async () => {
    // We hold the day as "other" leave, which never goes to Trek; Trek shows a day on the same date.
    await saveLeaveDay(ctx, { from: WED, typeId: types.other, fraction: 1 });
    const trek = fakeTrek({
      entries: [{ id: 1, user_id: null, date: WED, note: "", fraction: 1, kind: "comp" }],
    });

    const result = await pass(trek);
    expect(result?.conflicts).toContain(WED);
    expect(result?.counts.adopted).toBe(0);
    // Ours is untouched, and no comp row was invented beside it.
    const rows = await listLeaveDays(ctx, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ typeId: types.other, pending: "none" });
  });

  it("sends a ROL as a vacation, and keeps calling it a ROL here", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: WED, typeId: types.rol, fraction: 1 });

    const result = await pass(trek);
    expect(result?.counts.applied).toBe(1);
    // Trek has no ROL of its own, so what it is told is "this person is away".
    expect(trek.entryOn(WED)).toMatchObject({ fraction: 1, kind: "vacation" });
    expect(await rowOn(WED)).toMatchObject({
      kind: "rol",
      pending: "none",
      observedKind: "vacation",
      observedFraction: "1.0",
    });

    // And the day survives the next pass, exactly as a vacation day does.
    await pass(trek);
    expect(dates(trek)).toEqual([WED]);
  });

  it("never names a kind Trek does not know", async () => {
    await saveLeaveDay(ctx, { from: TUE, typeId: types.rol, fraction: 1 });
    await saveLeaveDay(ctx, { from: WED, typeId: types.other, fraction: 1 });
    await saveLeaveDay(ctx, { from: THU, typeId: types.comp, fraction: 1 });
    const trek = fakeTrek();

    await pass(trek);
    expect(trek.toggles.map((step) => step.date)).toEqual([TUE, THU]);
    expect(trek.toggles.every((step) => step.kind === "vacation")).toBe(true);
  });

  it("re-reads the year after writing, and writes what it saw", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    // One read before the toggles and one after: the second is what settled the row.
    expect(trek.reads).toBe(2);
  });

  it("does not read twice when there was nothing to send", async () => {
    const trek = fakeTrek();
    await pass(trek);
    expect(trek.reads).toBe(1);
  });

  it("adds half a day of ferie and half a ROL into one whole day, and settles both rows", async () => {
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUE, typeId: types.rol, fraction: 0.5 });
    const trek = fakeTrek();

    const result = await pass(trek);
    expect(result?.conflicts).toEqual([]);
    expect(trek.toggles).toHaveLength(1);
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 1, kind: "vacation" });

    // One row upstream, two here, and the single sighting settles both of them.
    const rows = await listLeaveDays(ctx, WINDOW);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ pending: "none", observedFraction: "1.0", observedKind: "vacation" });
    }
    expect(await pendingCount(ctx)).toBe(0);

    // And nothing is sent a second time: a toggle on an agreed day would delete it.
    await pass(trek);
    expect(trek.toggles).toHaveLength(1);
    expect(dates(trek)).toEqual([TUE]);
  });

  it("shrinks the day upstream when one of its two halves goes, rather than removing it", async () => {
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 0.5 });
    const [rol] = await saveLeaveDay(ctx, { from: TUE, typeId: types.rol, fraction: 0.5 });
    const trek = fakeTrek();
    await pass(trek);

    expect(await deleteLeaveDay(ctx, rol.id)).toBe("pending");
    await pass(trek);

    // Trek still holds the date, now for half a day, and the deleted row is really gone.
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 0.5, kind: "vacation" });
    expect(trek.toggles.at(-1)?.action).toBe("updated");
    const rows = await listLeaveDays(ctx, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "vacation", pending: "none", observedFraction: "0.5" });
    expect(await pendingCount(ctx)).toBe(0);
  });
});

describe("Trek's own figures (plan §3.6.4)", () => {
  /** The row of `get_vacay_stats`, in Trek's own words. */
  const stats = { year: YEAR, total_available: 29, used: 11, remaining: 18 };

  it("keeps what Trek said, so the screen can show it beside ours", async () => {
    await pass(fakeTrek({ stats }));
    expect(await calendarFiguresOf(ctx, YEAR)).toEqual({ used: 11, remaining: 18, totalAvailable: 29 });
  });

  it("offers nothing for a year the last pass did not cover", async () => {
    await pass(fakeTrek({ stats }));
    expect(await calendarFiguresOf(ctx, YEAR - 1)).toBeNull();
  });

  it("offers nothing when Trek has said nothing", async () => {
    const trek = fakeTrek();
    await pass(trek);
    expect(await calendarFiguresOf(ctx, YEAR)).toBeNull();
  });

  it("asks for the figures once per pass, never in a loop", async () => {
    const trek = fakeTrek({ stats });
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await saveLeaveDay(ctx, { from: WED, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    // Reading them persists carry-over upstream, so twice is once too many.
    expect(trek.calls.filter((call) => call.tool === "get_vacay_stats")).toHaveLength(1);
  });
});

describe("the pass and the connection", () => {
  it("writes one run per pass, of kind leave", async () => {
    const trek = fakeTrek();
    await pass(trek);
    const runs = await listRuns(ctx, { limit: 5 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: "leave", state: "success" });
  });

  it("attempts nothing at all for a refused token, and says so in the log", async () => {
    await markConnection(ctx, await connectionId(), "revoked", "the token was refused");
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });

    const result = await pass(trek);
    expect(result?.refused).toBe("revoked");
    expect(trek.toggles).toHaveLength(0);
    expect(trek.reads).toBe(0);
    const runs = await listRuns(ctx, { limit: 5 });
    expect(runs[0]).toMatchObject({ kind: "leave", state: "skipped" });
    // The day is still ours to send once the token is replaced.
    expect(await pendingCount(ctx)).toBe(1);
  });

  it("marks the connection revoked when Trek refuses the machine client", async () => {
    const refusing: typeof fetch = async (input, init) =>
      String(input).endsWith("/oauth/token")
        ? new Response('{"error":"invalid_client"}', { status: 401 })
        : fakeTrek().fetch(input, init);
    await expect(pass(fakeTrek(), servedCalendar(refusing))).rejects.toMatchObject({ code: "auth" });
    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ state: "revoked", errorCode: "auth" });
    expect((await listRuns(ctx, { limit: 1 }))[0]).toMatchObject({ state: "failed", errorCode: "auth" });
  });

  it("does nothing, and writes nothing, for a user with no Trek link", async () => {
    const other = await newContext();
    const trek = fakeTrek();
    expect(await syncCalendarNow(other, { calls: servedCalendar(trek.fetch), years: [YEAR] })).toBeNull();
    expect(await listRuns(other, { limit: 5 })).toEqual([]);
  });

  it("refuses a second pass while one is running, rather than opening another", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = fakeTrek({}, { hold: held });

    const first = pass(slow);
    // Give the first pass time to take the lock before the second one asks for it.
    await vi.waitFor(async () => {
      expect((await listRuns(ctx, { limit: 1 })).length).toBe(1);
    });
    await expect(pass(fakeTrek())).rejects.toSatisfy(isCalendarBusy);

    release?.();
    await first;
  });
});

/**
 * A calendar that takes no writes (decision D5): the days written here stay pending ("Da inviare"),
 * the engine stops trying to write, and the connection says why.
 */
describe("a Trek that may only read", () => {
  const spied = (trek: Trek) => {
    const calls = servedCalendar(trek.fetch);
    return { ...calls, write: vi.fn(calls.write) };
  };

  it("keeps the day pending, sends Trek nothing, and records read_only on the run and the connection", async () => {
    const trek = fakeTrek({}, { scope: "vacay:read" });
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });

    const result = await pass(trek, spied(trek));
    expect(trek.toggles).toHaveLength(0);
    expect(result?.counts).toMatchObject({ applied: 0, failed: 0, readOnly: 1, unsettled: 1 });
    expect(await rowOn(TUE)).toMatchObject({ pending: "upsert", observedKind: null });
    expect((await listRuns(ctx, { limit: 1 }))[0]).toMatchObject({ state: "failed", errorCode: "read_only" });
    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ state: "error", errorCode: "read_only" });
  });

  it("does not try to write again while the connection says read_only, and still adopts Trek's days", async () => {
    await markConnection(ctx, await connectionId(), "error", "read_only");
    const trek = fakeTrek({
      entries: [{ id: 1, user_id: 7, date: WED, note: null, fraction: 1, kind: "vacation" }],
    });
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    const calls = spied(trek);

    const result = await pass(trek, calls);
    expect(calls.write).not.toHaveBeenCalled();
    expect(result?.counts).toMatchObject({ adopted: 1, readOnly: 1 });
    expect(await pendingCount(ctx)).toBe(1);
  });

  it("is a good pass when nothing is waiting, and the connection leaves read_only", async () => {
    await markConnection(ctx, await connectionId(), "error", "read_only");
    await pass(fakeTrek({}, { scope: "vacay:read" }));
    expect((await listRuns(ctx, { limit: 1 }))[0]).toMatchObject({ state: "success" });
    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ state: "active", errorCode: null });
  });
});

/**
 * The leave panel's writes (rewrite plan N5): a range, a replacement, a removal and its undo. None
 * of them calls Trek; each leaves `pending` states behind, and the pass does what it always did.
 */
describe("a pass after the leave panel", () => {
  it("sends every day of a range, ROL as readily as vacation (decision ST-23)", async () => {
    const trek = fakeTrek();
    await saveLeaveRange(ctx, { from: TUE, to: THU, typeId: types.rol, fraction: 1 });

    const result = await pass(trek);
    expect(result?.counts.applied).toBe(3);
    expect(dates(trek)).toEqual([TUE, WED, THU]);
    expect(await pendingCount(ctx)).toBe(0);
    // And a second pass has nothing left to say.
    await pass(trek);
    expect(trek.toggles).toHaveLength(3);
  });

  it("keeps Trek's day when a range replaces its kind: the date is still a day away", async () => {
    const trek = fakeTrek();
    const [rol] = await saveLeaveDay(ctx, { from: TUE, typeId: types.rol, fraction: 1 });
    await pass(trek);
    expect((await rowOn(TUE))?.id).toBe(rol.id);

    await saveLeaveRange(ctx, { from: TUE, to: WED, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    expect(dates(trek)).toEqual([TUE, WED]);
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 1, kind: "vacation" });
    // The replaced ROL row is gone for good, and nothing is left pending.
    expect((await listLeaveDays(ctx, WINDOW)).map((row) => [row.on, row.kind, row.pending])).toEqual([
      [TUE, "vacation", "none"],
      [WED, "vacation", "none"],
    ]);
  });

  it("takes Trek's day back when a range replaces it with a kind that stays here", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    expect(dates(trek)).toEqual([TUE]);

    await saveLeaveRange(ctx, { from: TUE, to: TUE, typeId: types.other, fraction: 1 });
    await pass(trek);
    expect(dates(trek)).toEqual([]);
    expect((await listLeaveDays(ctx, WINDOW)).map((row) => [row.kind, row.pending])).toEqual([
      ["other", "none"],
    ]);
  });

  it("a row Trek knows, removed and then restored, costs Trek nothing: the day never leaves it", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 1 });
    await pass(trek);
    const sent = trek.toggles.length;

    const removed = await removeLeave(ctx, { id: day.id });
    expect((await rowOn(TUE))?.pending).toBe("delete");
    await restoreLeave(ctx, removed.undo);
    expect((await rowOn(TUE))?.pending).toBe("upsert");

    // The pass reads first, finds Trek holding exactly what is wanted, and sends nothing.
    await pass(trek);
    expect(trek.toggles).toHaveLength(sent);
    expect(dates(trek)).toEqual([TUE]);
    expect(await rowOn(TUE)).toMatchObject({ id: day.id, pending: "none", observedFraction: "1.0" });
  });

  it("a row Trek knows, removed, sent, and then restored comes back to Trek", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, typeId: types.vacation, fraction: 0.5 });
    await pass(trek);
    const removed = await removeLeave(ctx, { id: day.id });
    await pass(trek);
    expect(dates(trek)).toEqual([]);
    expect(await rowOn(TUE)).toBeNull();

    await restoreLeave(ctx, removed.undo);
    await pass(trek);
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 0.5, kind: "vacation" });
    expect(await rowOn(TUE)).toMatchObject({ pending: "none", fraction: "0.5" });
  });

  it("a row created and undone before the sync never reaches Trek", async () => {
    const trek = fakeTrek();
    const result = await saveLeaveRange(ctx, { from: TUE, to: THU, typeId: types.vacation, fraction: 1 });
    await restoreLeave(ctx, result.undo);

    await pass(trek);
    expect(trek.toggles).toHaveLength(0);
    expect(dates(trek)).toEqual([]);
    expect(await listLeaveDays(ctx, WINDOW)).toEqual([]);
  });

  it("an undone replacement leaves Trek holding the day it held", async () => {
    const trek = fakeTrek();
    const [rol] = await saveLeaveDay(ctx, { from: TUE, typeId: types.rol, fraction: 1 });
    await markSynced(ctx, [{ id: rol.id, fraction: 1, kind: "vacation" }]);
    await pass(trek);
    const sent = trek.toggles.length;

    const result = await saveLeaveRange(ctx, { from: TUE, to: TUE, typeId: types.other, fraction: 1 });
    await restoreLeave(ctx, result.undo);
    await pass(trek);
    expect(trek.toggles).toHaveLength(sent);
    expect(dates(trek)).toEqual([TUE]);
    expect((await listLeaveDays(ctx, WINDOW)).map((row) => [row.kind, row.pending])).toEqual([
      ["rol", "none"],
    ]);
  });
});
