import { describe, expect, it } from "vitest";
import type { TrekEntry } from "@/lib/clients/trek";
import type { TimeoffEvent } from "../application/ports";
import { planPull, planPush, storedFraction, trekEvents, trekFraction, trekKindOf, typeCodeOf } from "./trek-diff";

const EPOCH = new Date("2026-01-01T00:00:00Z");

function local(over: Partial<TimeoffEvent> & { date: string }): TimeoffEvent {
  return {
    id: `event-${over.date}`,
    userId: "user-1",
    typeId: "type-vacation",
    typeCode: "vacation",
    fraction: "1.00",
    status: "planned",
    origin: "trek",
    note: null,
    pendingOp: "none",
    syncedAt: null,
    trekEntryId: 1,
    version: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...over,
  };
}

function remote(over: Partial<TrekEntry> & { date: string }): TrekEntry {
  return { id: 1, note: "", fraction: 1, kind: "vacation", ...over };
}

describe("planPush", () => {
  it("sends staged upserts as desired days and staged deletes as removals", () => {
    const plan = planPush([
      local({ date: "2026-03-02", pendingOp: "upsert", fraction: "0.50", typeCode: "comp" }),
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
      [local({ date: "2026-03-02", fraction: "1.00" })],
      [remote({ date: "2026-03-02", fraction: 0.5 })],
    );
    expect(plan.upserts[0]?.fraction).toBe(0.5);
  });

  it("rewrites a day whose kind changed in Trek", () => {
    const plan = planPull(
      [local({ date: "2026-03-02", typeCode: "vacation" })],
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
      [local({ date: "2026-03-02", fraction: "0.50", pendingOp: "upsert" })],
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
      [local({ date: "2026-03-02", fraction: "0.50", pendingOp: "upsert", trekEntryId: null })],
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
        local({ date: "2026-03-03", fraction: "1.00" }), // changed upstream
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

describe("R7-2 — the Trek code mapping", () => {
  it("maps the two kinds Trek models, both ways", () => {
    expect(trekKindOf("vacation")).toBe("vacation");
    expect(trekKindOf("comp")).toBe("comp");
    expect(typeCodeOf("vacation")).toBe("vacation");
    expect(typeCodeOf("comp")).toBe("comp");
  });

  it("has no Trek kind for a type Trek cannot hold", () => {
    expect(trekKindOf("permits")).toBeNull();
    expect(trekKindOf("sick")).toBeNull();
  });

  it("never offers a permits day as a desired day", () => {
    const plan = planPush([
      local({ date: "2026-03-02", typeCode: "permits", pendingOp: "upsert", trekEntryId: null }),
      local({ date: "2026-03-03", pendingOp: "upsert" }),
    ]);
    expect(plan.desired.map((d) => d.date)).toEqual(["2026-03-03"]);
  });

  it("still removes a day Trek holds, whatever the local type says now", () => {
    const plan = planPush([local({ date: "2026-03-02", typeCode: "permits", pendingOp: "delete" })]);
    expect(plan.removals).toEqual(["2026-03-02"]);
  });

  it("keeps permits out of the set a pull is diffed against, so Trek cannot delete it", () => {
    const kept = trekEvents([
      local({ date: "2026-03-02", typeCode: "permits", trekEntryId: null }),
      local({ date: "2026-03-03" }),
    ]);
    expect(kept.map((e) => e.date)).toEqual(["2026-03-03"]);
    expect(planPull(kept, []).deletes).toEqual(["2026-03-03"]);
  });
});

describe("fraction at the Trek boundary", () => {
  it("crosses in both directions without floating point", () => {
    expect(trekFraction("0.50")).toBe(0.5);
    expect(trekFraction("1.00")).toBe(1);
    expect(storedFraction(0.5)).toBe("0.50");
    expect(storedFraction(1)).toBe("1.00");
  });
});
