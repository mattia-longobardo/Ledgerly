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
  pendingCount,
  saveLeaveDay,
  yearWindow,
} from "@/modules/timeoff/service";
import type { Ctx } from "@/platform/context";
import { closeDatabase, resetDatabase } from "../../../../test/db";
import { newContext } from "../../../../test/fixtures";
import { TREK_PROVIDER } from "../rules";
import { listConnections, listRuns, markConnection, saveConnection } from "../service";
import type { TogglePlanStep, TrekClient, TrekEntry, TrekYearStats } from "./client";
import { isTrekBusy, splitForTrek, syncTrekNow, trekStatsOf } from "./sync";

let ctx: Ctx;
const YEAR = 2026;
const WINDOW = yearWindow(YEAR);
/** All working days: 2026-06-16 is a Tuesday, the 17th a Wednesday, the 18th a Thursday. */
const TUE = "2026-06-16";
const WED = "2026-06-17";
const THU = "2026-06-18";

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  await saveConnection(ctx, {
    provider: TREK_PROVIDER,
    credentials: { baseUrl: "https://trek.example", token: "trek_test_token" },
  });
});

afterAll(closeDatabase);

/**
 * A Trek that really holds a year: the toggle behaves exactly as the real one does, so a test can
 * make the mistake the whole design guards against and see the day disappear.
 */
function fakeTrek(initial: TrekEntry[] = []) {
  const byDate = new Map<string, TrekEntry>();
  for (const entry of initial) byDate.set(entry.date, entry);
  let nextId = initial.length + 1;
  const toggles: TogglePlanStep[] = [];
  let failNext = 0;
  let reads = 0;

  const client: TrekClient = {
    async getEntries(): Promise<TrekEntry[]> {
      reads += 1;
      return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    async getStats(): Promise<TrekYearStats | null> {
      return null;
    },
    async toggleEntry(step: TogglePlanStep) {
      toggles.push(step);
      if (failNext > 0) {
        failNext -= 1;
        return { date: step.date, op: step.op, outcome: "failed" as const, action: null, error: "boom" };
      }
      const has = byDate.get(step.date);
      // The real semantics, verbatim: same pair removes, different pair updates, absent inserts.
      if (has === undefined) {
        byDate.set(step.date, {
          id: (nextId += 1),
          userId: null,
          date: step.date,
          note: "",
          fraction: step.fraction,
          kind: step.kind,
        });
        return { date: step.date, op: step.op, outcome: "applied" as const, action: "added" as const };
      }
      if (has.fraction === step.fraction && has.kind === step.kind) {
        byDate.delete(step.date);
        return { date: step.date, op: step.op, outcome: "applied" as const, action: "removed" as const };
      }
      byDate.set(step.date, { ...has, fraction: step.fraction, kind: step.kind });
      return { date: step.date, op: step.op, outcome: "applied" as const, action: "updated" as const };
    },
  };

  return {
    client,
    toggles,
    get dates() {
      return [...byDate.keys()].sort();
    },
    entryOn: (date: string) => byDate.get(date) ?? null,
    failNextToggles(count: number) {
      failNext = count;
    },
    get reads() {
      return reads;
    },
  };
}

const pass = (trek: ReturnType<typeof fakeTrek>) => syncTrekNow(ctx, { client: trek.client, years: [YEAR] });

/** The id of this user's Trek connection. */
async function connectionId(): Promise<string> {
  const connection = (await listConnections(ctx)).find((one) => one.provider === TREK_PROVIDER);
  if (!connection) throw new Error("no Trek connection");
  return connection.id;
}

async function rowOn(date: string) {
  return (await listLeaveDays(ctx, WINDOW)).find((row) => row.on === date) ?? null;
}

describe("splitForTrek", () => {
  const day = (
    on: string,
    kind: "vacation" | "rol" | "comp",
    pending: "none" | "upsert" | "delete",
    fraction = 1,
  ) => ({
    id: `${on}-${kind}`,
    on,
    kind,
    fraction,
    pending,
    trekFraction: null,
    trekKind: null,
  });

  it("separates what to send from what to take back", () => {
    const split = splitForTrek([day(TUE, "vacation", "upsert"), day(WED, "vacation", "delete")]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
    expect(split.removals).toEqual([WED]);
  });

  it("sends a settled day too, so a day Trek has lost comes back by itself", () => {
    const split = splitForTrek([day(TUE, "vacation", "none")]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
  });

  it("names vacation whatever the kind is, since Trek has neither ROL nor anything else", () => {
    const split = splitForTrek([day(TUE, "rol", "upsert"), day(WED, "comp", "upsert")]);
    expect(split.desired).toEqual([
      { date: TUE, fraction: 1, kind: "vacation" },
      { date: WED, fraction: 1, kind: "vacation" },
    ]);
  });

  it("adds the halves of one date up into the single row Trek keeps", () => {
    const split = splitForTrek([day(TUE, "vacation", "upsert", 0.5), day(TUE, "rol", "upsert", 0.5)]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
    expect(split.removals).toEqual([]);
  });

  it("never sends more than a whole day, whatever the date carries", () => {
    const split = splitForTrek([
      day(TUE, "vacation", "upsert", 0.5),
      day(TUE, "rol", "upsert", 0.5),
      day(TUE, "comp", "upsert", 0.5),
    ]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 1, kind: "vacation" }]);
  });

  it("takes a date back only once nothing of ours is left on it", () => {
    // Half the day goes: Trek keeps its row, shrunk to the half that stays. Nothing is removed.
    const split = splitForTrek([day(TUE, "vacation", "delete", 0.5), day(TUE, "rol", "none", 0.5)]);
    expect(split.desired).toEqual([{ date: TUE, fraction: 0.5, kind: "vacation" }]);
    expect(split.removals).toEqual([]);
  });
});

describe("a pass", () => {
  it("sends a new day, and the row stops being pending", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    expect(day.pending).toBe("upsert");

    const result = await pass(trek);
    expect(result?.counts.applied).toBe(1);
    expect(trek.dates).toEqual([TUE]);

    const after = await rowOn(TUE);
    expect(after).toMatchObject({ pending: "none", trekFraction: "1.0", trekKind: "vacation" });
    expect(after?.syncedAt).not.toBeNull();
    expect(await pendingCount(ctx)).toBe(0);
  });

  it("A SECOND PASS SENDS NOTHING — the day survives", async () => {
    // The whole point of the phase. A toggle fired again on an agreed day deletes it.
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await pass(trek);
    const togglesAfterFirst = trek.toggles.length;

    const second = await pass(trek);
    expect(trek.toggles).toHaveLength(togglesAfterFirst);
    expect(second?.counts.applied).toBe(0);
    expect(second?.counts.unchanged).toBe(1);
    expect(trek.dates).toEqual([TUE]);

    // And a third, for good measure.
    await pass(trek);
    expect(trek.dates).toEqual([TUE]);
  });

  it("removes a day by sending back the pair Trek was observed holding", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 0.5 });
    await pass(trek);
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 0.5, kind: "vacation" });

    expect(await deleteLeaveDay(ctx, day.id)).toBe("pending");
    await pass(trek);

    expect(trek.dates).toEqual([]);
    // Only once Trek has really let go does the row go.
    expect(await rowOn(TUE)).toBeNull();
    expect(await pendingCount(ctx)).toBe(0);
  });

  it("does not remove a day twice when the pass runs again", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await pass(trek);
    await deleteLeaveDay(ctx, day.id);
    await pass(trek);
    const togglesAfter = trek.toggles.length;

    // Nothing is pending any more, and the second pass must not recreate the day by toggling it.
    await pass(trek);
    expect(trek.toggles).toHaveLength(togglesAfter);
    expect(trek.dates).toEqual([]);
  });

  it("changes a day's fraction with an update, not a remove-and-add", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await pass(trek);
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 0.5 });
    await pass(trek);

    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 0.5 });
    expect(trek.toggles.at(-1)?.op).toBe("update");
    expect(await rowOn(TUE)).toMatchObject({ pending: "none", trekFraction: "0.5" });
  });

  it("leaves a failed send pending, and settles it on the next pass", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    trek.failNextToggles(1);

    const first = await pass(trek);
    expect(first?.counts.failed).toBe(1);
    expect(trek.dates).toEqual([]);
    // Still ours to send: the row did not quietly become "done".
    expect(await rowOn(TUE)).toMatchObject({ pending: "upsert" });
    expect(await pendingCount(ctx)).toBe(1);

    // And the run says the pass failed, so the log does not claim everything is well.
    const runs = await listRuns(ctx, { limit: 5 });
    expect(runs[0]).toMatchObject({ kind: "leave", state: "failed" });

    const second = await pass(trek);
    expect(second?.counts.applied).toBe(1);
    expect(trek.dates).toEqual([TUE]);
    expect(await rowOn(TUE)).toMatchObject({ pending: "none" });
  });

  it("a removal that did not land is not a conflict, and is never adopted back", async () => {
    const trek = fakeTrek();
    const [day] = await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await pass(trek);
    await deleteLeaveDay(ctx, day.id);

    // Trek refuses the removal this time round.
    trek.failNextToggles(1);
    const result = await pass(trek);
    expect(result?.conflicts).toEqual([]);
    expect(result?.counts.adopted).toBe(0);
    // The row is still ours, still asking to go, and Trek still has the day.
    expect(await rowOn(TUE)).toMatchObject({ pending: "delete" });
    expect(trek.dates).toEqual([TUE]);
    // And no second row was invented beside it.
    expect(await listLeaveDays(ctx, WINDOW)).toHaveLength(1);

    // Next pass settles it, as it should.
    await pass(trek);
    expect(trek.dates).toEqual([]);
    expect(await rowOn(TUE)).toBeNull();
  });

  it("adopts a day Trek has that we do not", async () => {
    const trek = fakeTrek([{ id: 1, userId: null, date: WED, note: "", fraction: 1, kind: "vacation" }]);
    const result = await pass(trek);

    expect(result?.counts.adopted).toBe(1);
    const adopted = await rowOn(WED);
    expect(adopted).toMatchObject({
      origin: "trek",
      kind: "vacation",
      fraction: "1.0",
      pending: "none",
      trekKind: "vacation",
    });
    // Adopting it must not then send it back.
    expect(trek.toggles).toHaveLength(0);
  });

  it("does not rewrite a day we classify differently — it reports it", async () => {
    // We hold the day as sick leave, which never goes to Trek; Trek shows a day on the same date.
    await saveLeaveDay(ctx, { from: WED, kind: "sick", fraction: 1 });
    const trek = fakeTrek([{ id: 1, userId: null, date: WED, note: "", fraction: 1, kind: "comp" }]);

    const result = await pass(trek);
    expect(result?.conflicts).toContain(WED);
    expect(result?.counts.adopted).toBe(0);
    // Ours is untouched, and no comp row was invented beside it.
    const rows = await listLeaveDays(ctx, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "sick", pending: "none" });
  });

  it("sends a ROL as a vacation, and keeps calling it a ROL here", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: WED, kind: "rol", fraction: 1 });

    const result = await pass(trek);
    expect(result?.counts.applied).toBe(1);
    // Trek has no ROL of its own, so what it is told is "this person is away".
    expect(trek.entryOn(WED)).toMatchObject({ fraction: 1, kind: "vacation" });
    expect(await rowOn(WED)).toMatchObject({
      kind: "rol",
      pending: "none",
      trekKind: "vacation",
      trekFraction: "1.0",
    });

    // And the day survives the next pass, exactly as a vacation day does.
    await pass(trek);
    expect(trek.dates).toEqual([WED]);
  });

  it("never names a kind Trek does not know", async () => {
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 1 });
    await saveLeaveDay(ctx, { from: WED, kind: "sick", fraction: 1 });
    await saveLeaveDay(ctx, { from: THU, kind: "comp", fraction: 1 });
    const trek = fakeTrek();

    await pass(trek);
    expect(trek.toggles.map((step) => step.date)).toEqual([TUE, THU]);
    expect(trek.toggles.every((step) => step.kind === "vacation")).toBe(true);
  });

  it("re-reads the year after writing, and writes what it saw", async () => {
    const trek = fakeTrek();
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
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
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 0.5 });
    await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 0.5 });
    const trek = fakeTrek();

    const result = await pass(trek);
    expect(result?.conflicts).toEqual([]);
    expect(trek.toggles).toHaveLength(1);
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 1, kind: "vacation" });

    // One row upstream, two here, and the single sighting settles both of them.
    const rows = await listLeaveDays(ctx, WINDOW);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ pending: "none", trekFraction: "1.0", trekKind: "vacation" });
    }
    expect(await pendingCount(ctx)).toBe(0);

    // And nothing is sent a second time: a toggle on an agreed day would delete it.
    await pass(trek);
    expect(trek.toggles).toHaveLength(1);
    expect(trek.dates).toEqual([TUE]);
  });

  it("shrinks the day upstream when one of its two halves goes, rather than removing it", async () => {
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 0.5 });
    const [rol] = await saveLeaveDay(ctx, { from: TUE, kind: "rol", fraction: 0.5 });
    const trek = fakeTrek();
    await pass(trek);

    expect(await deleteLeaveDay(ctx, rol.id)).toBe("pending");
    await pass(trek);

    // Trek still holds the date, now for half a day, and the deleted row is really gone.
    expect(trek.entryOn(TUE)).toMatchObject({ fraction: 0.5, kind: "vacation" });
    expect(trek.toggles.at(-1)?.op).toBe("update");
    const rows = await listLeaveDays(ctx, WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "vacation", pending: "none", trekFraction: "0.5" });
    expect(await pendingCount(ctx)).toBe(0);
  });
});

describe("Trek's own figures (plan §3.6.4)", () => {
  const stats = {
    year: YEAR,
    personName: "Test Person",
    vacationDays: 26,
    carriedOver: 3,
    totalAvailable: 29,
    used: 11,
    remaining: 18,
    compUsed: 1,
    windowStart: `${YEAR}-01-01`,
    windowEnd: `${YEAR}-12-31`,
  };

  it("keeps what Trek said, so the screen can show it beside ours", async () => {
    const trek = fakeTrek();
    const withStats: TrekClient = {
      ...trek.client,
      async getStats() {
        return stats;
      },
    };

    await syncTrekNow(ctx, { client: withStats, years: [YEAR] });
    expect(await trekStatsOf(ctx, YEAR)).toEqual({ used: 11, remaining: 18, totalAvailable: 29 });
  });

  it("offers nothing for a year the last pass did not cover", async () => {
    const trek = fakeTrek();
    const withStats: TrekClient = {
      ...trek.client,
      async getStats() {
        return stats;
      },
    };
    await syncTrekNow(ctx, { client: withStats, years: [YEAR] });
    expect(await trekStatsOf(ctx, YEAR - 1)).toBeNull();
  });

  it("offers nothing when Trek has said nothing", async () => {
    const trek = fakeTrek();
    await pass(trek);
    expect(await trekStatsOf(ctx, YEAR)).toBeNull();
  });

  it("asks for the figures once per pass, never in a loop", async () => {
    const trek = fakeTrek();
    let asked = 0;
    const counted: TrekClient = {
      ...trek.client,
      async getStats() {
        asked += 1;
        return stats;
      },
    };
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });
    await saveLeaveDay(ctx, { from: WED, kind: "vacation", fraction: 1 });
    await syncTrekNow(ctx, { client: counted, years: [YEAR] });
    // Reading them persists carry-over upstream, so twice is once too many.
    expect(asked).toBe(1);
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
    await saveLeaveDay(ctx, { from: TUE, kind: "vacation", fraction: 1 });

    const result = await pass(trek);
    expect(result?.refused).toBe("revoked");
    expect(trek.toggles).toHaveLength(0);
    expect(trek.reads).toBe(0);
    const runs = await listRuns(ctx, { limit: 5 });
    expect(runs[0]).toMatchObject({ kind: "leave", state: "skipped" });
    // The day is still ours to send once the token is replaced.
    expect(await pendingCount(ctx)).toBe(1);
  });

  it("does nothing, and writes nothing, for a user with no Trek link", async () => {
    const other = await newContext();
    const trek = fakeTrek();
    expect(await syncTrekNow(other, { client: trek.client, years: [YEAR] })).toBeNull();
    expect(await listRuns(other, { limit: 5 })).toEqual([]);
  });

  it("refuses a second pass while one is running, rather than opening another", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = fakeTrek();
    const blocking: TrekClient = {
      ...slow.client,
      async getEntries() {
        await held;
        return [];
      },
    };

    const first = syncTrekNow(ctx, { client: blocking, years: [YEAR] });
    // Give the first pass time to take the lock before the second one asks for it.
    await vi.waitFor(async () => {
      expect((await listRuns(ctx, { limit: 1 })).length).toBe(1);
    });
    await expect(syncTrekNow(ctx, { client: slow.client, years: [YEAR] })).rejects.toSatisfy(isTrekBusy);

    release?.();
    await first;
  });
});
