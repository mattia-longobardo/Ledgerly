/**
 * Sync orchestration tests. The Trek client and the events store are both
 * doubles: this suite is about ORDER, about what happens to a local row when a
 * push does not land, and about the rule that no network call may happen
 * inside a database context — never about reaching Trek, which has no working
 * credential and must not be written to from a test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyDesiredStateResult, TrekEntry, TrekYearStats } from "@/lib/clients/trek";
import type { EventsRepository, TimeoffEvent, TimeoffStore, TypesRepository } from "../application/ports";

const trek = vi.hoisted(() => ({
  getEntries: vi.fn(),
  getStats: vi.fn(),
  applyDesiredState: vi.fn(),
}));

const repo = vi.hoisted(() => ({
  pending: vi.fn(),
  inRange: vi.fn(),
  upsertFromProvider: vi.fn(),
  deleteDates: vi.fn(),
  clearPending: vi.fn(),
  unlinkProvider: vi.fn(),
}));

const state = vi.hoisted(() => ({ setCachedTrekStats: vi.fn() }));

/** Records the interleaving of database contexts and network calls. */
const trace = vi.hoisted(() => ({ steps: [] as string[], openContexts: 0 }));

/**
 * The advisory lock lives inside `runTrekSync()`, so every test in this file
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
vi.mock("@/lib/repo/trek-state", () => state);
vi.mock("@/lib/repo/jobs", () => ({ withJobLock: jobs.withJobLock }));
vi.mock("@/lib/repo/settings", () => ({
  hoursPerDay: async () => 8,
  DEFAULT_HOURS_PER_DAY: 8,
  SETTING_KEYS: { hoursPerDay: "hours_per_day" },
  getSetting: async () => null,
  setSetting: async () => {},
}));

const { runTrekSync, disabledTrekSync, TREK_SYNC_LOCK_KEY } = await import("./trek-sync");

const USER_ID = "00000000-0000-7000-8000-00000000000a";
const CONFIG = { baseUrl: "https://trek.example", token: "trek_test" };
const CALL = { config: CONFIG, sleep: async () => {} };
const EPOCH = new Date("2026-01-01T00:00:00Z");
const MONDAY = "2026-03-02";
const MONDAY_CONVERTED = "2026-03-09";

const TYPE_IDS: Record<string, string> = {
  vacation: "type-vacation",
  permits: "type-permits",
  comp: "type-comp",
};

function local(over: Partial<TimeoffEvent> & { date: string }): TimeoffEvent {
  const typeCode = over.typeCode ?? "vacation";
  return {
    id: `event-${over.date}`,
    userId: USER_ID,
    typeId: TYPE_IDS[typeCode]!,
    typeCode,
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

function applied(over: Partial<ApplyDesiredStateResult> = {}): ApplyDesiredStateResult {
  return { results: [], unchanged: [], alreadyAbsent: [], before: [], ...over };
}

/**
 * A store whose `withEvents` records that a context is open, so a network call
 * made inside one is caught by `trace` rather than by production.
 */
const store: TimeoffStore = {
  async withEvents(userId, fn) {
    trace.openContexts += 1;
    trace.steps.push("db");
    try {
      const events = {
        pending: (id: string) => repo.pending(id),
        inRange: (id: string, from: string, to: string) => repo.inRange(id, from, to),
        upsertFromProvider: (...args: unknown[]) => repo.upsertFromProvider(...args),
        deleteDates: (...args: unknown[]) => repo.deleteDates(...args),
        clearPending: (...args: unknown[]) => repo.clearPending(...args),
        unlinkProvider: (...args: unknown[]) => repo.unlinkProvider(...args),
        at: async () => null,
        stageUpsert: async () => {
          throw new Error("not used");
        },
        stageDelete: async () => null,
      } as unknown as EventsRepository;
      const types = {
        list: async () => Object.entries(TYPE_IDS).map(([code, id]) => ({
          id,
          userId,
          code,
          label: code,
          unit: "hours",
          hoursPerDay: "8.00",
          createdAt: EPOCH,
          updatedAt: EPOCH,
        })),
        getByCode: async (_id: string, code: string) => ({ id: TYPE_IDS[code]!, code }),
        create: async () => {
          throw new Error("types are already seeded in this double");
        },
      } as unknown as TypesRepository;
      return await fn(events, types);
    } finally {
      trace.openContexts -= 1;
    }
  },
};

function networkStep(name: string) {
  // The rule this suite exists to keep: Trek is never called with a database
  // context open (shared conventions — no network I/O inside withUserContext).
  if (trace.openContexts > 0) throw new Error(`${name} ran inside a database context`);
  trace.steps.push(name);
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

function run(over: { year?: number; withStats?: boolean } = {}) {
  return runTrekSync({ year: 2026, userId: USER_ID, store, call: CALL, ...over });
}

beforeEach(() => {
  vi.clearAllMocks();
  jobs.lockHeld = false;
  trace.steps = [];
  trace.openContexts = 0;
  trek.getEntries.mockImplementation(async () => {
    networkStep("pull");
    return [];
  });
  trek.getStats.mockImplementation(async () => {
    networkStep("stats");
    return STATS;
  });
  trek.applyDesiredState.mockImplementation(async () => {
    networkStep("push");
    return applied();
  });
  repo.pending.mockResolvedValue([]);
  repo.inRange.mockResolvedValue([]);
});

describe("the sync lock", () => {
  it("takes it on every pass, under the key the trek_sync job runs under", async () => {
    await run();

    expect(jobs.withJobLock).toHaveBeenCalledTimes(1);
    expect(jobs.withJobLock.mock.calls[0]?.[0]).toBe(TREK_SYNC_LOCK_KEY);
  });

  it("does NOTHING when another pass holds it — a second toggle would delete the day", async () => {
    jobs.lockHeld = true;
    repo.pending.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);
    repo.inRange.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);

    const result = await run();

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
    expect(repo.upsertFromProvider).not.toHaveBeenCalled();
  });

  it("leaves the pending row pending, so the next pass delivers it", async () => {
    jobs.lockHeld = true;
    repo.pending.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);

    const result = await run();

    expect(result.pushed).toBe(0);
    expect(repo.clearPending).not.toHaveBeenCalled();
  });
});

describe("disabledTrekSync", () => {
  it("describes an untouched year", () => {
    expect(disabledTrekSync(2026)).toEqual({
      status: "disabled",
      year: 2026,
      pulled: 0,
      deleted: 0,
      pushed: 0,
      weekendBlocked: [],
      stillPending: [],
      stats: null,
      errors: [],
    });
  });
});

describe("push then pull", () => {
  it("pushes local edits BEFORE reading Trek back", async () => {
    repo.pending.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [{ date: "2026-03-02", op: "insert", outcome: "applied", action: "added" }],
      });
    });
    trek.getEntries.mockImplementation(async () => {
      networkStep("pull");
      return [remote({ date: "2026-03-02" })];
    });

    const result = await run();

    expect(trace.steps.filter((s) => s !== "db")).toEqual(["push", "pull", "stats"]);
    expect(result.pushed).toBe(1);
  });

  it("never calls Trek with a database context open", async () => {
    repo.pending.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [{ date: "2026-03-02", op: "insert", outcome: "applied", action: "added" }],
      });
    });
    // Each network step throws if a context is open, so a clean pass proves it.
    await expect(run()).resolves.toMatchObject({ status: "ok", errors: [] });
    // read → push → settle → pull → write → stats: five alternations, and no
    // "push"/"pull"/"stats" ever nested inside a "db".
    expect(trace.steps).toEqual(["db", "push", "db", "pull", "db", "stats"]);
  });

  it("scopes every database step to the calendar's owner", async () => {
    await run();
    expect(repo.inRange).toHaveBeenCalledWith(USER_ID, "2026-01-01", "2026-12-31");
  });

  it("skips the push entirely when nothing is staged", async () => {
    await run();
    expect(trek.applyDesiredState).not.toHaveBeenCalled();
    expect(trek.getEntries).toHaveBeenCalledTimes(1);
  });

  it("only pushes rows belonging to the year being synced", async () => {
    repo.pending.mockResolvedValue([
      local({ date: "2026-03-02", pendingOp: "upsert" }),
      local({ date: "2025-12-30", pendingOp: "upsert" }),
    ]);

    await run();

    const [input] = trek.applyDesiredState.mock.calls[0] as [
      { desired: { date: string }[]; removals: string[] },
    ];
    expect(input.desired.map((d) => d.date)).toEqual(["2026-03-02"]);
  });

  it("writes Trek's answer into the local mirror as a timeoff event", async () => {
    trek.getEntries.mockImplementation(async () => {
      networkStep("pull");
      return [remote({ date: "2026-03-02", id: 9, fraction: 0.5 })];
    });

    const result = await run();

    expect(repo.upsertFromProvider).toHaveBeenCalledWith(
      USER_ID,
      [{ date: "2026-03-02", fraction: "0.50", typeId: "type-vacation", trekEntryId: 9, note: null }],
      expect.any(Date),
    );
    expect(result.pulled).toBe(1);
  });

  it("drops a local day Trek no longer has", async () => {
    repo.inRange.mockResolvedValue([local({ date: "2026-03-02" })]);

    const result = await run();

    expect(repo.deleteDates).toHaveBeenCalledWith(USER_ID, ["2026-03-02"]);
    expect(result.deleted).toBe(1);
  });
});

describe("R7-2 — days Trek cannot hold", () => {
  it("settles a staged permits day locally and never sends it", async () => {
    repo.pending.mockResolvedValue([
      local({ date: "2026-03-02", typeCode: "permits", pendingOp: "upsert", trekEntryId: null }),
    ]);

    const result = await run();

    expect(trek.applyDesiredState).not.toHaveBeenCalled();
    expect(repo.clearPending).toHaveBeenCalledWith(USER_ID, ["2026-03-02"], expect.any(Date));
    expect(result.pushed).toBe(0);
    expect(result.status).toBe("ok");
  });

  it("removes the Trek entry when a Trek day is converted to permits", async () => {
    // The transition the first cut got wrong: `planPush` skipped the row and
    // `syncPass` settled it locally, so Trek kept its entry, the pull saw it as
    // new upstream and wrote the day back to `vacation`.
    const converted = local({
      date: MONDAY_CONVERTED,
      typeCode: "permits",
      pendingOp: "upsert",
      trekEntryId: 4242,
    });
    repo.pending.mockResolvedValue([converted]);
    repo.inRange.mockResolvedValue([converted]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [{ date: MONDAY_CONVERTED, op: "delete", outcome: "applied", action: "removed" }],
      });
    });
    // Trek has honoured the removal, so the year comes back without it.
    trek.getEntries.mockImplementation(async () => {
      networkStep("pull");
      return [];
    });

    const result = await run();

    const [input] = trek.applyDesiredState.mock.calls[0] as [
      { desired: unknown[]; removals: string[] },
    ];
    expect(input.desired).toEqual([]);
    expect(input.removals).toEqual([MONDAY_CONVERTED]);
    // The day itself stays — it is the owner's; only its link to Trek goes.
    expect(repo.clearPending).toHaveBeenCalledWith(USER_ID, [MONDAY_CONVERTED], expect.any(Date));
    expect(repo.unlinkProvider).toHaveBeenCalledWith(USER_ID, [MONDAY_CONVERTED]);
    expect(repo.deleteDates).toHaveBeenCalledWith(USER_ID, []);
    expect(result.status).toBe("ok");
  });

  it("keeps the Trek link while the conversion's removal has NOT landed", async () => {
    const converted = local({
      date: MONDAY_CONVERTED,
      typeCode: "permits",
      pendingOp: "upsert",
      trekEntryId: 4242,
    });
    repo.pending.mockResolvedValue([converted]);
    repo.inRange.mockResolvedValue([converted]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [
          { date: MONDAY_CONVERTED, op: "delete", outcome: "failed", action: null, error: "boom" },
        ],
      });
    });

    const result = await run();

    expect(repo.clearPending).not.toHaveBeenCalled();
    expect(repo.unlinkProvider).not.toHaveBeenCalled();
    expect(result.status).toBe("partial");
    expect(result.stillPending).toEqual([MONDAY_CONVERTED]);
  });

  it("never unlinks a permits day Trek has never held", async () => {
    repo.pending.mockResolvedValue([
      local({ date: MONDAY, typeCode: "permits", pendingOp: "upsert", trekEntryId: null }),
    ]);

    await run();

    expect(repo.clearPending).toHaveBeenCalledWith(USER_ID, [MONDAY], expect.any(Date));
    expect(repo.unlinkProvider).not.toHaveBeenCalled();
  });

  it("keeps a permits day when Trek reports an empty year", async () => {
    repo.inRange.mockResolvedValue([
      local({ date: "2026-03-02", typeCode: "permits", trekEntryId: null }),
    ]);

    const result = await run();

    expect(repo.deleteDates).toHaveBeenCalledWith(USER_ID, []);
    expect(result.deleted).toBe(0);
  });
});

describe("a push that does not land", () => {
  it("keeps the local edit and reports partial rather than success", async () => {
    repo.pending.mockResolvedValue([
      local({ date: "2026-03-02", fraction: "0.50", pendingOp: "upsert" }),
    ]);
    repo.inRange.mockResolvedValue([
      local({ date: "2026-03-02", fraction: "0.50", pendingOp: "upsert" }),
    ]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [
          { date: "2026-03-02", op: "insert", outcome: "failed", action: null, error: "boom" },
        ],
      });
    });
    // Trek still reports the old value; the pull must not adopt it.
    trek.getEntries.mockImplementation(async () => {
      networkStep("pull");
      return [remote({ date: "2026-03-02", fraction: 1 })];
    });

    const result = await run();

    expect(result.status).toBe("partial");
    expect(result.stillPending).toEqual(["2026-03-02"]);
    expect(repo.upsertFromProvider).toHaveBeenCalledWith(USER_ID, [], expect.any(Date));
    expect(repo.deleteDates).toHaveBeenCalledWith(USER_ID, []);
  });
});

describe("weekend-blocked days", () => {
  it("drops the row rather than retrying a request Trek will always refuse", async () => {
    repo.pending.mockResolvedValue([local({ date: "2026-03-07", pendingOp: "upsert" })]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [
          { date: "2026-03-07", op: "insert", outcome: "weekend_blocked", action: null },
        ],
      });
    });

    const result = await run();

    expect(result.weekendBlocked).toEqual(["2026-03-07"]);
    expect(repo.deleteDates).toHaveBeenCalledWith(USER_ID, ["2026-03-07"]);
    // A domain outcome, not an error: the pass still reports success.
    expect(result.status).toBe("ok");
    expect(result.errors).toEqual([]);
  });
});

describe("settling pushed rows", () => {
  it("clears the flag on a day Trek ACCEPTED, so it is not re-sent next pass", async () => {
    repo.pending.mockResolvedValue([
      local({ date: "2026-03-02", fraction: "0.50", pendingOp: "upsert" }),
    ]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [{ date: "2026-03-02", op: "update", outcome: "applied", action: "updated" }],
      });
    });

    await run();

    expect(repo.clearPending).toHaveBeenCalledWith(USER_ID, ["2026-03-02"], expect.any(Date));
  });

  it("leaves the flag on a day whose push failed", async () => {
    repo.pending.mockResolvedValue([local({ date: "2026-03-02", pendingOp: "upsert" })]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({
        results: [
          { date: "2026-03-02", op: "insert", outcome: "failed", action: null, error: "boom" },
        ],
      });
    });

    await run();

    expect(repo.clearPending).not.toHaveBeenCalled();
  });

  it("clears the pending flag on days Trek already agreed with", async () => {
    repo.pending.mockResolvedValue([
      local({ date: "2026-03-02", pendingOp: "upsert" }),
      local({ date: "2026-03-03", pendingOp: "delete" }),
    ]);
    trek.applyDesiredState.mockImplementation(async () => {
      networkStep("push");
      return applied({ unchanged: ["2026-03-02"], alreadyAbsent: ["2026-03-03"] });
    });

    await run();

    expect(repo.clearPending).toHaveBeenCalledWith(
      USER_ID,
      ["2026-03-02", "2026-03-03"],
      expect.any(Date),
    );
  });
});

describe("stats", () => {
  it("fetches them exactly once and caches them — the endpoint writes upstream", async () => {
    const result = await run();

    expect(trek.getStats).toHaveBeenCalledTimes(1);
    expect(state.setCachedTrekStats).toHaveBeenCalledWith(2026, STATS, expect.any(Date));
    expect(result.stats).toEqual(STATS);
  });

  it("skips them when the caller does not need the figures", async () => {
    await run({ withStats: false });

    expect(trek.getStats).not.toHaveBeenCalled();
    expect(state.setCachedTrekStats).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  it("reports failed with the message, and never throws at the caller", async () => {
    trek.getEntries.mockRejectedValue(new Error("trek is down"));

    const result = await run();

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("trek is down");
  });
});
