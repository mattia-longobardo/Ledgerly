import { describe, expect, it } from "vitest";
import type { TrekEntry } from "@/lib/clients/trek";
import type { LeaveDayRow } from "@/lib/repo/leave";
import { planPull, planPush, plannedDaysByMonth } from "./trek-diff";

function local(over: Partial<LeaveDayRow> & { date: string }): LeaveDayRow {
  return {
    fraction: 1,
    kind: "vacation",
    trekEntryId: 1,
    origin: "trek",
    note: null,
    pendingOp: "none",
    syncedAt: null,
    ...over,
  };
}

function remote(over: Partial<TrekEntry> & { date: string }): TrekEntry {
  return { id: 1, note: "", fraction: 1, kind: "vacation", ...over };
}

describe("planPush", () => {
  it("sends staged upserts as desired days and staged deletes as removals", () => {
    const plan = planPush([
      local({ date: "2026-03-02", pendingOp: "upsert", fraction: 0.5, kind: "comp" }),
      local({ date: "2026-03-03", pendingOp: "delete" }),
      local({ date: "2026-03-04", pendingOp: "none" }),
    ]);

    expect(plan.desired).toEqual([{ date: "2026-03-02", fraction: 0.5, kind: "comp" }]);
    expect(plan.removals).toEqual(["2026-03-03"]);
  });

  it("asks for nothing when no row is dirty", () => {
    expect(planPush([local({ date: "2026-03-02" })])).toEqual({ desired: [], removals: [] });
  });
});

describe("planPull", () => {
  it("adopts a day Trek has that the dashboard does not", () => {
    const plan = planPull([], [remote({ date: "2026-03-02", id: 9, fraction: 0.5 })]);
    expect(plan.upserts).toEqual([
      { date: "2026-03-02", fraction: 0.5, kind: "vacation", trekEntryId: 9, note: null },
    ]);
  });

  it("deletes a local day Trek no longer has — Trek owns existence", () => {
    const plan = planPull([local({ date: "2026-03-02" })], []);
    expect(plan.deletes).toEqual(["2026-03-02"]);
    expect(plan.upserts).toEqual([]);
  });

  it("rewrites a day whose fraction changed in Trek (full → half)", () => {
    const plan = planPull(
      [local({ date: "2026-03-02", fraction: 1 })],
      [remote({ date: "2026-03-02", fraction: 0.5 })],
    );
    expect(plan.upserts[0]?.fraction).toBe(0.5);
  });

  it("rewrites a day whose kind changed in Trek", () => {
    const plan = planPull(
      [local({ date: "2026-03-02", kind: "vacation" })],
      [remote({ date: "2026-03-02", kind: "comp" })],
    );
    expect(plan.upserts[0]?.kind).toBe("comp");
  });

  it("writes nothing when the two already agree", () => {
    const plan = planPull([local({ date: "2026-03-02" })], [remote({ date: "2026-03-02" })]);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.unchanged).toEqual(["2026-03-02"]);
  });

  it("drops the tombstone once Trek has lost the day the push removed", () => {
    const plan = planPull([local({ date: "2026-03-02", pendingOp: "delete" })], []);
    expect(plan.deletes).toEqual(["2026-03-02"]);
  });

  it("keeps the tombstone when Trek still has the day — the removal did not land", () => {
    const plan = planPull(
      [local({ date: "2026-03-02", pendingOp: "delete" })],
      [remote({ date: "2026-03-02" })],
    );
    expect(plan.deletes).toEqual([]);
    expect(plan.skipped).toEqual(["2026-03-02"]);
  });

  it("never overwrites an edit whose push failed — the owner's change survives", () => {
    // The dashboard wants a half day; Trek still says a full one because the
    // toggle never landed. Pulling Trek's version here would discard the edit.
    const plan = planPull(
      [local({ date: "2026-03-02", fraction: 0.5, pendingOp: "upsert" })],
      [remote({ date: "2026-03-02", fraction: 1 })],
      new Set(["2026-03-02"]),
    );
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.skipped).toEqual(["2026-03-02"]);
  });

  it("takes Trek's answer once the push HAS landed — the write-through settles", () => {
    // Same row, but the push succeeded, so `stillPending` is empty and Trek's
    // post-write state is adopted verbatim.
    const plan = planPull(
      [local({ date: "2026-03-02", fraction: 0.5, pendingOp: "upsert", trekEntryId: null })],
      [remote({ date: "2026-03-02", fraction: 0.5, id: 42 })],
    );
    expect(plan.upserts).toEqual([
      { date: "2026-03-02", fraction: 0.5, kind: "vacation", trekEntryId: 42, note: null },
    ]);
  });

  it("picks up a note added in Trek", () => {
    const plan = planPull(
      [local({ date: "2026-03-02", note: null })],
      [remote({ date: "2026-03-02", note: "Ponte" })],
    );
    expect(plan.upserts[0]?.note).toBe("Ponte");
  });

  it("normalises Trek's empty-string note to null so it stops re-diffing", () => {
    const plan = planPull(
      [local({ date: "2026-03-02", note: null })],
      [remote({ date: "2026-03-02", note: "" })],
    );
    expect(plan.upserts).toEqual([]);
  });

  it("handles a mixed year in one pass", () => {
    const plan = planPull(
      [
        local({ date: "2026-03-02" }), // agrees
        local({ date: "2026-03-03", fraction: 1 }), // changed upstream
        local({ date: "2026-03-04" }), // gone upstream
      ],
      [
        remote({ date: "2026-03-02" }),
        remote({ date: "2026-03-03", fraction: 0.5 }),
        remote({ date: "2026-03-05", id: 5 }), // new upstream
      ],
    );
    expect(plan.upserts.map((u) => u.date)).toEqual(["2026-03-03", "2026-03-05"]);
    expect(plan.deletes).toEqual(["2026-03-04"]);
    expect(plan.unchanged).toEqual(["2026-03-02"]);
  });
});

describe("plannedDaysByMonth", () => {
  it("counts a half day as 0.5", () => {
    expect(
      plannedDaysByMonth([
        { date: "2026-03-02", fraction: 1 },
        { date: "2026-03-03", fraction: 0.5 },
      ]),
    ).toEqual([{ month: "2026-03-01", days: 1.5 }]);
  });

  it("groups by month, ascending", () => {
    expect(
      plannedDaysByMonth([
        { date: "2026-04-01", fraction: 1 },
        { date: "2026-03-02", fraction: 1 },
        { date: "2026-03-03", fraction: 1 },
      ]),
    ).toEqual([
      { month: "2026-03-01", days: 2 },
      { month: "2026-04-01", days: 1 },
    ]);
  });

  it("keeps a run of halves exact rather than 2.9999999999999996", () => {
    const days = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-03-0${i + 1}`,
      fraction: 0.5 as const,
    }));
    expect(plannedDaysByMonth(days)).toEqual([{ month: "2026-03-01", days: 3 }]);
  });

  it("returns nothing for an empty calendar", () => {
    expect(plannedDaysByMonth([])).toEqual([]);
  });
});
