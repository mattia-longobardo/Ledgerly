/**
 * The leave server actions, with everything below them mocked.
 *
 * What this suite is really about is the LOST RACE: the dashboard's Save and
 * Remove start a Trek sync, and so does the hourly cron. Only one of them may
 * hold the sync lock, and the loser must report the edit as saved-and-queued —
 * never as a failure, because the row is already in Postgres with its pending
 * flag and the next pass delivers it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrekSyncResult } from "@/lib/jobs/trek-sync";

const auth = vi.hoisted(() => ({ requireUser: vi.fn(async () => ({ sub: "sub-123" })) }));
const trek = vi.hoisted(() => ({
  isWeekendBlocked: vi.fn(() => false),
  trekConfigured: vi.fn(() => true),
}));
const sync = vi.hoisted(() => ({ runTrekSync: vi.fn() }));
const repo = vi.hoisted(() => ({
  stageUpsert: vi.fn(async () => null),
  stageDelete: vi.fn(async () => null),
  dayAt: vi.fn(),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/cache", () => cache);
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("@/lib/clients/trek", () => trek);
vi.mock("@/lib/jobs/trek-sync", () => sync);
vi.mock("@/lib/repo/leave", () => repo);

const { setLeaveDay, removeLeaveDay, syncLeaveNow } = await import("./leave");

function result(over: Partial<TrekSyncResult> = {}): TrekSyncResult {
  return {
    status: "ok",
    year: 2026,
    pulled: 0,
    deleted: 0,
    pushed: 1,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
    ...over,
  };
}

const DAY = { date: "2026-03-02", fraction: 1, kind: "vacation" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  trek.isWeekendBlocked.mockReturnValue(false);
  trek.trekConfigured.mockReturnValue(true);
  sync.runTrekSync.mockResolvedValue(result());
  repo.dayAt.mockResolvedValue({
    date: "2026-03-02",
    fraction: 1,
    kind: "vacation",
    trekEntryId: 7,
    origin: "trek",
    note: null,
    pendingOp: "none",
    syncedAt: null,
  });
});

describe("setLeaveDay", () => {
  it("stages the row BEFORE talking to Trek, so a lost race cannot lose the edit", async () => {
    const order: string[] = [];
    repo.stageUpsert.mockImplementation(async () => {
      order.push("stage");
      return null;
    });
    sync.runTrekSync.mockImplementation(async () => {
      order.push("sync");
      return result();
    });

    await setLeaveDay(DAY);

    expect(order).toEqual(["stage", "sync"]);
  });

  it("reports a pushed day as sent", async () => {
    const out = await setLeaveDay(DAY);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data).toMatchObject({ syncPending: false, queued: false });
    expect(out.data.message).toContain("sent to Trek");
  });

  it("succeeds — queued, not failed — when another pass holds the sync lock", async () => {
    sync.runTrekSync.mockResolvedValue(result({ status: "skipped", pushed: 0 }));

    const out = await setLeaveDay(DAY);

    // The edit is in Postgres with pending_op = 'upsert'. Reporting a failure
    // would tell the owner to retry something that is already saved, and a
    // retry is exactly what must not happen: a second toggle of the same day
    // is how Trek DELETES it.
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.queued).toBe(true);
    expect(out.data.syncPending).toBe(true);
    expect(out.data.message).toMatch(/shortly/);
    expect(repo.stageUpsert).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a queued push from an upstream failure", async () => {
    sync.runTrekSync.mockResolvedValue(result({ status: "failed", errors: ["trek is down"] }));

    const out = await setLeaveDay(DAY);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Both are `syncPending`, but only one of them means "nothing was even
    // attempted"; the UI wants to say different things about them.
    expect(out.data.syncPending).toBe(true);
    expect(out.data.queued).toBe(false);
    expect(out.data.message).toContain("retried");
  });

  it("refuses a weekend before staging anything", async () => {
    trek.isWeekendBlocked.mockReturnValue(true);

    const out = await setLeaveDay({ ...DAY, date: "2026-03-07" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.weekendBlocked).toBe(true);
    expect(out.data.queued).toBe(false);
    expect(repo.stageUpsert).not.toHaveBeenCalled();
    expect(sync.runTrekSync).not.toHaveBeenCalled();
  });

  it("refuses a fraction Trek cannot express", async () => {
    const out = await setLeaveDay({ ...DAY, fraction: 0.25 as unknown as 1 });

    expect(out.ok).toBe(false);
    expect(repo.stageUpsert).not.toHaveBeenCalled();
  });
});

describe("removeLeaveDay", () => {
  it("reports a queued removal as saved, not as an error", async () => {
    sync.runTrekSync.mockResolvedValue(result({ status: "skipped", pushed: 0 }));

    const out = await removeLeaveDay({ date: "2026-03-02" });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.queued).toBe(true);
    expect(out.data.message).toMatch(/^Day removed/);
    // Flagged, never deleted outright: the push still needs the fraction and
    // kind to build the toggle that removes it upstream.
    expect(repo.stageDelete).toHaveBeenCalledWith("2026-03-02");
  });

  it("refuses a day that was never booked", async () => {
    repo.dayAt.mockResolvedValue(null);

    const out = await removeLeaveDay({ date: "2026-03-02" });

    expect(out.ok).toBe(false);
    expect(repo.stageDelete).not.toHaveBeenCalled();
  });
});

describe("syncLeaveNow", () => {
  it("treats a lock held by the hourly pass as success, not as a failed sync", async () => {
    sync.runTrekSync.mockResolvedValue(result({ status: "skipped" }));

    const out = await syncLeaveNow({ year: 2026 });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.status).toBe("skipped");
  });

  it("still surfaces a real upstream failure", async () => {
    sync.runTrekSync.mockResolvedValue(result({ status: "failed", errors: ["trek is down"] }));

    const out = await syncLeaveNow({ year: 2026 });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("trek is down");
  });
});
