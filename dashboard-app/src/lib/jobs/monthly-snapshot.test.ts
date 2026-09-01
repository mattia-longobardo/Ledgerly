import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/contracts";

/**
 * The snapshot job is a state machine over `monthly_snapshots` + `job_runs`, so
 * the repo layer is faked with real in-memory state rather than bare spies:
 * "the retry re-sent the cached values" and "exactly one Teable row" are claims
 * about state transitions, and a stub that always returns `null` would let a
 * broken ordering pass.
 */

interface SnapshotRow {
  monthKey: string;
  ing: string;
  revolut: string;
  status: string;
  teableRecordId: string | null;
  capturedAt: Date;
}

interface RunRow {
  id: number;
  jobName: string;
  trigger: string;
  dedupeKey: string | null;
  attempt: number;
  status: string;
  error: string | null;
  detail: Record<string, unknown> | null;
}

const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://dashboard@localhost/dashboard",
  AUTH_URL: "https://dash.example.test",
  AUTH_SECRET: "a".repeat(40),
  OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  AUTHORIZED_SUB: "sub-123",
  TEABLE_URL: "https://teable.example.test",
  TEABLE_TOKEN: "teable-token",
  PAPERLESS_URL: "https://paperless.example.test",
  PAPERLESS_TOKEN: "paperless-token",
  CRON_SECRET: "c".repeat(20),
  WEBHOOK_SECRET: "w".repeat(20),
  GOTIFY_URL: "https://gotify.example.test",
  GOTIFY_TOKEN: "gotify-token",
};

const store = vi.hoisted(() => {
  // Runs before the imports below, so env() sees a complete environment.
  Object.assign(process.env, {
    DATABASE_URL: "postgres://dashboard@localhost/dashboard",
    AUTH_URL: "https://dash.example.test",
    AUTH_SECRET: "a".repeat(40),
    OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    AUTHORIZED_SUB: "sub-123",
    TEABLE_URL: "https://teable.example.test",
    TEABLE_TOKEN: "teable-token",
    PAPERLESS_URL: "https://paperless.example.test",
    PAPERLESS_TOKEN: "paperless-token",
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
  });
  return {
    snapshots: new Map<string, SnapshotRow>(),
    runs: [] as RunRow[],
    heldLocks: new Set<string>(),
    nextRunId: 1,
  };
});

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(
    async (input: {
      jobName: string;
      trigger: string;
      dedupeKey?: string | null;
      attempt?: number;
    }) => {
      const row: RunRow = {
        id: store.nextRunId++,
        jobName: input.jobName,
        trigger: input.trigger,
        dedupeKey: input.dedupeKey ?? null,
        attempt: input.attempt ?? 1,
        status: "running",
        error: null,
        detail: null,
      };
      store.runs.push(row);
      return row;
    },
  ),
  finishRun: vi.fn(
    async (
      id: number,
      status: string,
      extra?: { error?: string; detail?: Record<string, unknown> },
    ) => {
      const row = store.runs.find((r) => r.id === id);
      if (!row) throw new Error(`finishRun for unknown run ${id}`);
      row.status = status;
      row.error = extra?.error ?? null;
      row.detail = extra?.detail ?? null;
    },
  ),
  // Mirrors pg_try_advisory_xact_lock: held for the callback, never queued.
  withJobLock: vi.fn(async (key: string, fn: () => Promise<unknown>) => {
    if (store.heldLocks.has(key)) return null;
    store.heldLocks.add(key);
    try {
      return await fn();
    } finally {
      store.heldLocks.delete(key);
    }
  }),
  getMonthlySnapshot: vi.fn(async (monthKey: string) => store.snapshots.get(monthKey) ?? null),
  persistPending: vi.fn(
    async (input: { monthKey: string; ing: string; revolut: string; capturedAt: Date }) => {
      const existing = store.snapshots.get(input.monthKey);
      if (existing) return existing;
      const row: SnapshotRow = { ...input, status: "pending_teable", teableRecordId: null };
      store.snapshots.set(input.monthKey, row);
      return row;
    },
  ),
  markSnapshotDone: vi.fn(async (monthKey: string, teableRecordId: string) => {
    const row = store.snapshots.get(monthKey);
    if (row) {
      row.status = "done";
      row.teableRecordId = teableRecordId;
    }
  }),
  markSnapshotStatus: vi.fn(async (monthKey: string, status: string) => {
    const row = store.snapshots.get(monthKey);
    if (row) row.status = status;
  }),
  pendingTeableWrites: vi.fn(async () =>
    [...store.snapshots.values()].filter((r) => r.status === "pending_teable"),
  ),
  attemptsFor: vi.fn(async (jobName: string, dedupeKey: string) =>
    store.runs.filter(
      (r) => r.jobName === jobName && r.dedupeKey === dedupeKey && r.status === "failed",
    ).length,
  ),
  allMonthKeys: vi.fn(async () => [...store.snapshots.keys()]),
  recentRuns: vi.fn(async () => [...store.runs].reverse()),
  lastSuccess: vi.fn(async () => null),
}));

vi.mock("@/lib/repo/balances", () => ({
  recordSnapshots: vi.fn(async () => undefined),
  latestBalances: vi.fn(async () => []),
}));

vi.mock("@/lib/clients/wallet", () => ({
  getBalances: vi.fn(async () => BALANCES),
}));

vi.mock("@/lib/clients/teable", () => ({
  upsertAllocationRow: vi.fn(async () => ({ recordId: "rec_generated", action: "created" })),
}));

/**
 * Gotify is left real and cut at the HTTP boundary instead: the alert
 * priorities are part of the contract under test, and a mocked
 * `alertJobFailure` would assert nothing about the 8 it is supposed to send.
 */
vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

const BALANCES = {
  ing: 1234.56,
  revolut: 789.01,
  breakdown: {
    ing: 1234.56,
    revolut_main: 500,
    revolut_savings: 200.01,
    revolut_holidays: 89,
  },
} as const;

import { httpRequest } from "@/lib/clients/http";
import { upsertAllocationRow } from "@/lib/clients/teable";
import { getBalances } from "@/lib/clients/wallet";
import { recordSnapshots } from "@/lib/repo/balances";
import { persistPending } from "@/lib/repo/jobs";
import { MAX_ATTEMPTS, runMonthlySnapshot } from "@/lib/jobs/monthly-snapshot";

const MONTH = "2026-09-01";
const NOW = new Date("2026-09-01T21:59:00Z");

function order(fn: unknown): number {
  const calls = vi.mocked(fn as (...args: never[]) => unknown).mock.invocationCallOrder;
  const first = calls[0];
  expect(first, "expected the function to have been called").toBeDefined();
  return first ?? -1;
}

/** Gotify messages that actually left the process. */
function alerts(): Array<{ title: string; message: string; priority: number }> {
  return vi.mocked(httpRequest).mock.calls.map((call) => {
    const init = call[2];
    return JSON.parse(String(init?.body ?? "{}")) as {
      title: string;
      message: string;
      priority: number;
    };
  });
}

function runsFor(monthKey: string): RunRow[] {
  return store.runs.filter((r) => r.jobName === "monthly_snapshot" && r.dedupeKey === monthKey);
}

/** Drives the month to `n` recorded failures without touching the store directly. */
async function failTimes(n: number, monthKey = MONTH): Promise<void> {
  vi.mocked(upsertAllocationRow).mockRejectedValue(new Error("teable 502"));
  for (let i = 0; i < n; i += 1) {
    await runMonthlySnapshot({ monthKey, trigger: "cron", now: NOW });
  }
}

beforeEach(() => {
  Object.assign(process.env, BASE_ENV);
  store.snapshots.clear();
  store.runs.length = 0;
  store.heldLocks.clear();
  store.nextRunId = 1;
  vi.clearAllMocks();
  vi.mocked(getBalances).mockResolvedValue(BALANCES);
  vi.mocked(upsertAllocationRow).mockResolvedValue({ recordId: "rec_generated", action: "created" });
  vi.mocked(httpRequest).mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("phase ordering", () => {
  it("reads, persists, then writes — in that order — and records the run", async () => {
    const result = await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });

    expect(result.status).toBe("success");
    expect(order(getBalances)).toBeLessThan(order(persistPending));
    expect(order(persistPending)).toBeLessThan(order(upsertAllocationRow));

    expect(store.snapshots.get(MONTH)).toMatchObject({
      status: "done",
      ing: "1234.56",
      revolut: "789.01",
      teableRecordId: "rec_generated",
      capturedAt: NOW,
    });
    expect(runsFor(MONTH)).toHaveLength(1);
    expect(runsFor(MONTH)[0]?.status).toBe("success");
  });

  it("writes the Teable row as the month key with money kept as strings", async () => {
    await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });

    expect(upsertAllocationRow).toHaveBeenCalledWith({
      date: MONTH,
      ing: 1234.56,
      revolut: 789.01,
    });
    const [rows] = vi.mocked(recordSnapshots).mock.calls[0] ?? [];
    expect(rows?.map((r) => [r.accountKey, r.balance])).toEqual([
      ["ing", "1234.56"],
      ["revolut_total", "789.01"],
      ["revolut_main", "500.00"],
      ["revolut_savings", "200.01"],
      ["revolut_holidays", "89.00"],
    ]);
  });

  it("records in the run detail whether the Teable row was created or patched", async () => {
    vi.mocked(upsertAllocationRow).mockResolvedValue({
      recordId: "recExisting",
      action: "updated",
    });

    const result = await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });

    expect(result.detail).toMatchObject({
      teableRecordId: "recExisting",
      teableAction: "updated",
    });
    expect(result.detail).not.toHaveProperty("teableDuplicateRecordIds");
    // A patched row's id is just as valid an identifier for the month.
    expect(store.snapshots.get(MONTH)?.teableRecordId).toBe("recExisting");
    expect(runsFor(MONTH)[0]?.detail).toMatchObject({ teableAction: "updated" });
  });

  it("surfaces the month's duplicate rows in the run log instead of swallowing them", async () => {
    // When a month has drifted to two rows — as 2026-09 had before the owner
    // merged them by hand — the job patches the newest and reports the other
    // rather than deleting or ignoring it.
    vi.mocked(upsertAllocationRow).mockResolvedValue({
      recordId: "rec41rYnDKuR6WV9786",
      action: "updated",
      duplicates: ["recE2yriad1cOxQxQQK"],
    });

    const result = await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });

    expect(result.status).toBe("success");
    expect(result.detail?.teableDuplicateRecordIds).toEqual(["recE2yriad1cOxQxQQK"]);
    expect(runsFor(MONTH)[0]?.detail?.teableDuplicateRecordIds).toEqual(["recE2yriad1cOxQxQQK"]);
  });

  it("writes NOTHING anywhere when the Wallet read is partial", async () => {
    vi.mocked(getBalances).mockRejectedValue(
      new UpstreamError("wallet", "required account(s) not found: Holidays"),
    );

    const result = await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });

    expect(result.status).toBe("failed");
    expect(persistPending).not.toHaveBeenCalled();
    expect(recordSnapshots).not.toHaveBeenCalled();
    expect(upsertAllocationRow).not.toHaveBeenCalled();
    expect(store.snapshots.size).toBe(0);
    expect(runsFor(MONTH)[0]?.status).toBe("failed");
    expect(runsFor(MONTH)[0]?.error).toContain("required account(s) not found");
  });
});

describe("phase 3 retries", () => {
  it("leaves the row pending_teable and replays the CACHED values without re-reading Wallet", async () => {
    vi.mocked(upsertAllocationRow).mockRejectedValueOnce(new Error("teable 502"));

    const first = await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });
    expect(first.status).toBe("failed");
    expect(store.snapshots.get(MONTH)).toMatchObject({ status: "pending_teable", ing: "1234.56" });
    expect(getBalances).toHaveBeenCalledTimes(1);

    // The balances would be from a different moment an hour later — the retry
    // must never look at them.
    vi.mocked(getBalances).mockResolvedValue({
      ing: 999.99,
      revolut: 111.11,
      breakdown: { ing: 999.99, revolut_main: 111.11, revolut_savings: 0, revolut_holidays: 0 },
    });

    const later = new Date("2026-09-02T08:07:00Z");
    const second = await runMonthlySnapshot({ monthKey: MONTH, trigger: "sweep", now: later });

    expect(second.status).toBe("success_after_retry");
    expect(getBalances).toHaveBeenCalledTimes(1);
    expect(upsertAllocationRow).toHaveBeenLastCalledWith({
      date: MONTH,
      ing: 1234.56,
      revolut: 789.01,
    });
    expect(store.snapshots.get(MONTH)).toMatchObject({
      status: "done",
      teableRecordId: "rec_generated",
      capturedAt: NOW,
    });
    // The read cache is not rewritten by a write-only retry.
    expect(recordSnapshots).toHaveBeenCalledTimes(1);
  });

  it("alerts at priority 4 after a retry and stays silent on a clean run", async () => {
    await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });
    expect(alerts()).toEqual([]);

    vi.mocked(upsertAllocationRow).mockRejectedValueOnce(new Error("teable 502"));
    const other = "2026-10-01";
    await runMonthlySnapshot({ monthKey: other, trigger: "cron", now: new Date("2026-10-01T21:59:00Z") });
    expect(alerts()).toEqual([]);

    await runMonthlySnapshot({ monthKey: other, trigger: "sweep", now: new Date("2026-10-02T08:07:00Z") });

    const sent = alerts();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.priority).toBe(4);
    expect(sent[0]?.title).toContain(other);
  });
});

describe("idempotency", () => {
  it("writes exactly one Teable row when two invocations overlap", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(getBalances).mockImplementationOnce(async () => {
      await gate;
      return BALANCES;
    });

    const first = runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });
    // Let the first invocation take the advisory lock before the second starts.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    const second = runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    release();

    const [a, b] = await Promise.all([first, second]);

    expect(a.status).toBe("success");
    expect(b.status).toBe("already_done");
    expect(b.detail?.reason).toBe("lock_not_acquired");
    expect(upsertAllocationRow).toHaveBeenCalledTimes(1);
    expect(store.snapshots.size).toBe(1);
    // Even the no-op invocation is observable.
    expect(runsFor(MONTH).map((r) => r.status)).toEqual(["success", "already_done"]);
  });

  it("is a no-op when re-triggered after success", async () => {
    await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });
    vi.mocked(upsertAllocationRow).mockClear();

    const again = await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });

    expect(again.status).toBe("already_done");
    expect(again.detail?.reason).toBe("snapshot_already_done");
    expect(upsertAllocationRow).not.toHaveBeenCalled();
    expect(getBalances).toHaveBeenCalledTimes(1);
    expect(runsFor(MONTH)).toHaveLength(2);
    expect(runsFor(MONTH)[1]?.status).toBe("already_done");
  });
});

describe("poisoning", () => {
  it("keeps retrying up to the budget, then poisons once and stops", async () => {
    await failTimes(MAX_ATTEMPTS - 1);

    expect(runsFor(MONTH).map((r) => r.status)).toEqual(Array(MAX_ATTEMPTS - 1).fill("failed"));
    expect(store.snapshots.get(MONTH)?.status).toBe("pending_teable");
    expect(alerts()).toEqual([]);

    const final = await runMonthlySnapshot({ monthKey: MONTH, trigger: "sweep", now: NOW });

    expect(final.status).toBe("poisoned");
    expect(store.snapshots.get(MONTH)?.status).toBe("poisoned");
    const sent = alerts();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.priority).toBe(8);
    expect(sent[0]?.title).toContain(MONTH);
    expect(sent[0]?.message).toContain("teable 502");

    // Auto-retries stop: no upstream call, and no second alert.
    vi.mocked(upsertAllocationRow).mockClear();
    vi.mocked(getBalances).mockClear();
    const after = await runMonthlySnapshot({ monthKey: MONTH, trigger: "sweep", now: NOW });
    expect(after.status).toBe("poisoned");
    expect(after.detail?.requiresManualAction).toBe(true);
    expect(upsertAllocationRow).not.toHaveBeenCalled();
    expect(getBalances).not.toHaveBeenCalled();
    expect(alerts()).toHaveLength(1);
  });

  it("only a manual force revives a poisoned month, and only the write is replayed", async () => {
    await failTimes(MAX_ATTEMPTS);
    expect(store.snapshots.get(MONTH)?.status).toBe("poisoned");

    vi.mocked(upsertAllocationRow).mockResolvedValue({ recordId: "rec_manual", action: "created" });
    vi.mocked(getBalances).mockClear();

    const result = await runMonthlySnapshot({
      monthKey: MONTH,
      trigger: "manual",
      now: NOW,
      force: true,
    });

    expect(result.status).toBe("success_after_retry");
    expect(getBalances).not.toHaveBeenCalled();
    expect(upsertAllocationRow).toHaveBeenLastCalledWith({
      date: MONTH,
      ing: 1234.56,
      revolut: 789.01,
    });
    expect(store.snapshots.get(MONTH)).toMatchObject({
      status: "done",
      teableRecordId: "rec_manual",
    });
  });

  it("counts a failed Wallet read against the same budget", async () => {
    vi.mocked(getBalances).mockRejectedValue(new UpstreamError("wallet", "401 rejected"));

    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });
    }
    const final = await runMonthlySnapshot({ monthKey: MONTH, trigger: "cron", now: NOW });

    expect(final.status).toBe("poisoned");
    // Nothing was ever persisted, so there is no row to mark — the job_runs
    // trail is the only record, and it must still be terminal.
    expect(store.snapshots.size).toBe(0);
    expect(runsFor(MONTH).at(-1)?.status).toBe("poisoned");
    expect(alerts()[0]?.priority).toBe(8);
  });
});
