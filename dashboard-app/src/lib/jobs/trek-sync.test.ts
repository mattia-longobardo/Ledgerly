/**
 * Sync orchestration tests. The client and the repo are both mocked: this suite
 * is about ORDER and about what happens to a local row when a push does not
 * land — never about reaching Trek, which has no working credential and must
 * not be written to from a test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyDesiredStateResult, TrekEntry, TrekYearStats } from "@/lib/clients/trek";
import type { LeaveDayRow } from "@/lib/repo/leave";

const trek = vi.hoisted(() => ({
  trekConfigured: vi.fn(() => true),
  getEntries: vi.fn(),
  getStats: vi.fn(),
  applyDesiredState: vi.fn(),
  isTrekNotConfigured: vi.fn(() => false),
}));

const repo = vi.hoisted(() => ({
  pendingDays: vi.fn(),
  daysInYear: vi.fn(),
  upsertFromTrek: vi.fn(),
  deleteDates: vi.fn(),
  clearPending: vi.fn(),
}));

const state = vi.hoisted(() => ({ setCachedTrekStats: vi.fn() }));

/**
 * The advisory lock lives inside `runTrekSync()` now, so every test in this file
 * runs through it. `lockHeld` stands in for another pass owning it.
 */
const jobs = vi.hoisted(() => {
  const store = {
    lockHeld: false,
    withJobLock: vi.fn(),
  };
  store.withJobLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) =>
    store.lockHeld ? null : fn(),
  );
  return store;
});

vi.mock("@/lib/clients/trek", () => trek);
vi.mock("@/lib/repo/leave", () => repo);
vi.mock("@/lib/repo/trek-state", () => state);
vi.mock("@/lib/repo/jobs", () => ({ withJobLock: jobs.withJobLock }));

const { runTrekSync, TREK_SYNC_LOCK_KEY } = await import("./trek-sync");

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

function applied(over: Partial<ApplyDesiredStateResult> = {}): ApplyDesiredStateResult {
  return { results: [], unchanged: [], alreadyAbsent: [], before: [], ...over };
}

const STATS: TrekYearStats = {
  year: 2026,
  personName: "mattia",
  vacationDays: 33,
  carriedOver: 0,
  totalAvailable: 33,
  used: 26,
  remaining: 7,
  compUsed: 0,
  windowStart: "2026-01-01",
  windowEnd: "2027-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  jobs.lockHeld = false;
  trek.trekConfigured.mockReturnValue(true);
  trek.isTrekNotConfigured.mockReturnValue(false);
  trek.getEntries.mockResolvedValue([]);
  trek.getStats.mockResolvedValue(STATS);
  trek.applyDesiredState.mockResolvedValue(applied());
  repo.pendingDays.mockResolvedValue([]);
  repo.daysInYear.mockResolvedValue([]);
});

describe("the sync lock", () => {
  it("takes it on every pass, under the key the trek_sync job runs under", async () => {
    await runTrekSync({ year: 2026 });

    expect(jobs.withJobLock).toHaveBeenCalledTimes(1);
    expect(jobs.withJobLock.mock.calls[0]?.[0]).toBe(TREK_SYNC_LOCK_KEY);
  });

  it("does NOTHING when another pass holds it — a second toggle would delete the day", async () => {
    jobs.lockHeld = true;
    repo.pendingDays.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);
    repo.daysInYear.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);

    const result = await runTrekSync({ year: 2026 });

    expect(result.status).toBe("skipped");
    expect(result.errors).toEqual([]);
    // The exact failure this lock exists for: the winning pass books the day and
    // clears the flag, and a second read → diff → toggle over the same year
    // toggles it again, which is how Trek REMOVES an entry. Then the pull,
    // seeing it gone upstream and no longer pending locally, deletes it here
    // too. Nothing may run outside the lock.
    expect(trek.applyDesiredState).not.toHaveBeenCalled();
    expect(trek.getEntries).not.toHaveBeenCalled();
    expect(trek.getStats).not.toHaveBeenCalled();
    expect(repo.clearPending).not.toHaveBeenCalled();
    expect(repo.deleteDates).not.toHaveBeenCalled();
    expect(repo.upsertFromTrek).not.toHaveBeenCalled();
  });

  it("leaves the pending row pending, so the next pass delivers it", async () => {
    jobs.lockHeld = true;
    repo.pendingDays.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);

    const result = await runTrekSync({ year: 2026 });

    expect(result.pushed).toBe(0);
    expect(repo.clearPending).not.toHaveBeenCalled();
  });

  it("does not open a transaction at all when Trek is not configured", async () => {
    trek.trekConfigured.mockReturnValue(false);

    await runTrekSync({ year: 2026 });

    expect(jobs.withJobLock).not.toHaveBeenCalled();
  });
});

describe("when Trek is not configured", () => {
  it("disables itself instead of failing — no credential is not an error", async () => {
    trek.trekConfigured.mockReturnValue(false);

    const result = await runTrekSync({ year: 2026 });

    expect(result.status).toBe("disabled");
    expect(result.errors).toEqual([]);
    expect(result.stats).toBeNull();
  });

  it("touches neither Trek nor the database", async () => {
    trek.trekConfigured.mockReturnValue(false);
    await runTrekSync({ year: 2026 });

    expect(trek.getEntries).not.toHaveBeenCalled();
    expect(trek.applyDesiredState).not.toHaveBeenCalled();
    expect(trek.getStats).not.toHaveBeenCalled();
    expect(repo.upsertFromTrek).not.toHaveBeenCalled();
    expect(repo.deleteDates).not.toHaveBeenCalled();
  });

  it("degrades the same way when the credential vanishes mid-flight", async () => {
    trek.isTrekNotConfigured.mockReturnValue(true);
    trek.getEntries.mockRejectedValue(new Error("not configured"));

    expect((await runTrekSync({ year: 2026 })).status).toBe("disabled");
  });
});

describe("push then pull", () => {
  it("pushes local edits BEFORE reading Trek back", async () => {
    const order: string[] = [];
    repo.pendingDays.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);
    trek.applyDesiredState.mockImplementation(async () => {
      order.push("push");
      return applied({
        results: [{ date: "2026-03-02", op: "insert", outcome: "applied", action: "added" }],
      });
    });
    trek.getEntries.mockImplementation(async () => {
      order.push("pull");
      return [remote({ date: "2026-03-02" })];
    });

    const result = await runTrekSync({ year: 2026 });

    expect(order).toEqual(["push", "pull"]);
    expect(result.pushed).toBe(1);
  });

  it("skips the push entirely when nothing is staged", async () => {
    await runTrekSync({ year: 2026 });
    expect(trek.applyDesiredState).not.toHaveBeenCalled();
    expect(trek.getEntries).toHaveBeenCalledTimes(1);
  });

  it("only pushes rows belonging to the year being synced", async () => {
    repo.pendingDays.mockResolvedValue([
      local({ date: "2026-03-02", pendingOp: "upsert" }),
      local({ date: "2025-12-30", pendingOp: "upsert" }),
    ]);

    await runTrekSync({ year: 2026 });

    const [input] = trek.applyDesiredState.mock.calls[0] as [
      { desired: { date: string }[]; removals: string[] },
    ];
    expect(input.desired.map((d) => d.date)).toEqual(["2026-03-02"]);
  });

  it("writes Trek's answer into the local mirror", async () => {
    trek.getEntries.mockResolvedValue([remote({ date: "2026-03-02", id: 9, fraction: 0.5 })]);

    const result = await runTrekSync({ year: 2026 });

    expect(repo.upsertFromTrek).toHaveBeenCalledWith(
      [{ date: "2026-03-02", fraction: 0.5, kind: "vacation", trekEntryId: 9, note: null }],
      expect.any(Date),
    );
    expect(result.pulled).toBe(1);
  });

  it("drops a local day Trek no longer has", async () => {
    repo.daysInYear.mockResolvedValue([local({ date: "2026-03-02" })]);
    trek.getEntries.mockResolvedValue([]);

    const result = await runTrekSync({ year: 2026 });

    expect(repo.deleteDates).toHaveBeenCalledWith(["2026-03-02"]);
    expect(result.deleted).toBe(1);
  });
});

describe("a push that does not land", () => {
  it("keeps the local edit and reports partial rather than success", async () => {
    repo.pendingDays.mockResolvedValue([
      local({ date: "2026-03-02", fraction: 0.5, pendingOp: "upsert" }),
    ]);
    repo.daysInYear.mockResolvedValue([
      local({ date: "2026-03-02", fraction: 0.5, pendingOp: "upsert" }),
    ]);
    trek.applyDesiredState.mockResolvedValue(
      applied({
        results: [
          { date: "2026-03-02", op: "insert", outcome: "failed", action: null, error: "boom" },
        ],
      }),
    );
    // Trek still reports the old value; the pull must not adopt it.
    trek.getEntries.mockResolvedValue([remote({ date: "2026-03-02", fraction: 1 })]);

    const result = await runTrekSync({ year: 2026 });

    expect(result.status).toBe("partial");
    expect(result.stillPending).toEqual(["2026-03-02"]);
    expect(repo.upsertFromTrek).toHaveBeenCalledWith([], expect.any(Date));
    expect(repo.deleteDates).toHaveBeenCalledWith([]);
  });
});

describe("weekend-blocked days", () => {
  it("drops the row rather than retrying a request Trek will always refuse", async () => {
    repo.pendingDays.mockResolvedValue([local({ date: "2026-03-07", pendingOp: "upsert" })]);
    trek.applyDesiredState.mockResolvedValue(
      applied({
        results: [
          { date: "2026-03-07", op: "insert", outcome: "weekend_blocked", action: null },
        ],
      }),
    );

    const result = await runTrekSync({ year: 2026 });

    expect(result.weekendBlocked).toEqual(["2026-03-07"]);
    expect(repo.deleteDates).toHaveBeenCalledWith(["2026-03-07"]);
    // A domain outcome, not an error: the pass still reports success.
    expect(result.status).toBe("ok");
    expect(result.errors).toEqual([]);
  });
});

describe("settling pushed rows", () => {
  it("clears the flag on a day Trek ACCEPTED, so it is not re-sent next pass", async () => {
    repo.pendingDays.mockResolvedValue([
      local({ date: "2026-03-02", fraction: 0.5, pendingOp: "upsert" }),
    ]);
    trek.applyDesiredState.mockResolvedValue(
      applied({
        results: [{ date: "2026-03-02", op: "update", outcome: "applied", action: "updated" }],
      }),
    );

    await runTrekSync({ year: 2026 });

    expect(repo.clearPending).toHaveBeenCalledWith(["2026-03-02"], expect.any(Date));
  });

  it("leaves the flag on a day whose push failed", async () => {
    repo.pendingDays.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);
    trek.applyDesiredState.mockResolvedValue(
      applied({
        results: [
          { date: "2026-03-02", op: "insert", outcome: "failed", action: null, error: "boom" },
        ],
      }),
    );

    await runTrekSync({ year: 2026 });

    expect(repo.clearPending).not.toHaveBeenCalled();
  });

  it("clears the pending flag on days Trek already agreed with", async () => {
    repo.pendingDays.mockResolvedValue([
      local({ date: "2026-03-02", pendingOp: "upsert" }),
      local({ date: "2026-03-03", pendingOp: "delete" }),
    ]);
    trek.applyDesiredState.mockResolvedValue(
      applied({ unchanged: ["2026-03-02"], alreadyAbsent: ["2026-03-03"] }),
    );

    await runTrekSync({ year: 2026 });

    expect(repo.clearPending).toHaveBeenCalledWith(
      ["2026-03-02", "2026-03-03"],
      expect.any(Date),
    );
  });
});

describe("stats", () => {
  it("fetches them exactly once and caches them — the endpoint writes upstream", async () => {
    const result = await runTrekSync({ year: 2026 });

    expect(trek.getStats).toHaveBeenCalledTimes(1);
    expect(state.setCachedTrekStats).toHaveBeenCalledWith(2026, STATS, expect.any(Date));
    expect(result.stats).toEqual(STATS);
  });

  it("skips them when the caller does not need the figures", async () => {
    await runTrekSync({ year: 2026, withStats: false });

    expect(trek.getStats).not.toHaveBeenCalled();
    expect(state.setCachedTrekStats).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  it("reports failed with the message, and never throws at the caller", async () => {
    trek.getEntries.mockRejectedValue(new Error("trek is down"));

    const result = await runTrekSync({ year: 2026 });

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("trek is down");
  });
});
