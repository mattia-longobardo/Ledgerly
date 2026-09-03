import { beforeEach, describe, expect, it, vi } from "vitest";

interface RunRow {
  id: number;
  jobName: string;
  trigger: string;
  status: string;
  error: string | null;
  detail: Record<string, unknown> | null;
}

const store = vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://dashboard@localhost/dashboard",
    AUTH_URL: "https://dash.example.test",
    AUTH_SECRET: "a".repeat(40),
    OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    AUTHORIZED_SUB: "sub-123",
    PAPERLESS_URL: "https://paperless.example.test",
    PAPERLESS_TOKEN: "paperless-token",
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
    SNAPSHOT_GRACE_DAYS: "3",
  });
  return { runs: [] as RunRow[], nextRunId: 1 };
});

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(async (input: { jobName: string; trigger: string }) => {
    const row: RunRow = {
      id: store.nextRunId++,
      jobName: input.jobName,
      trigger: input.trigger,
      status: "running",
      error: null,
      detail: null,
    };
    store.runs.push(row);
    return row;
  }),
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
  // Still exported by the real module; this wrapper no longer uses it, because
  // the lock moved into runTrekSync() where every caller has to pass through it.
  withJobLock: vi.fn(async <T,>(_key: string, fn: () => Promise<T>): Promise<T | null> => fn()),
}));

vi.mock("@/lib/clients/trek", () => ({ trekConfigured: vi.fn(() => true) }));
vi.mock("@/lib/jobs/trek-sync", () => ({ runTrekSync: vi.fn() }));

// Gotify goes over httpRequest; a job that alerts would show up here.
vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

import { trekConfigured } from "@/lib/clients/trek";
import { httpRequest } from "@/lib/clients/http";
import { runTrekSync, type TrekSyncResult } from "@/lib/jobs/trek-sync";
import { JOB_NAME, runTrekSyncJob, summarize } from "@/lib/jobs/trek-sync-job";

function result(over: Partial<TrekSyncResult> = {}): TrekSyncResult {
  return {
    status: "ok",
    year: 2026,
    pulled: 3,
    deleted: 0,
    pushed: 1,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  vi.mocked(trekConfigured).mockReturnValue(true);
  vi.mocked(runTrekSync).mockReset();
  vi.mocked(httpRequest).mockClear();
});

describe("runTrekSyncJob", () => {
  it("records a success run and reports what moved", async () => {
    vi.mocked(runTrekSync).mockResolvedValue(result());

    const out = await runTrekSyncJob();

    expect(out).toMatchObject({ job: JOB_NAME, status: "success" });
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ jobName: JOB_NAME, trigger: "cron", status: "success" });
    expect(store.runs[0]?.detail).toMatchObject({ pulled: 3, pushed: 1, year: 2026 });
  });

  it("writes NO job_runs row when Trek is not configured", async () => {
    vi.mocked(trekConfigured).mockReturnValue(false);

    const out = await runTrekSyncJob();

    // An hourly job logging "not configured" 24x/day would bury every other
    // job in the settings page's 20-row log.
    expect(out).toMatchObject({ status: "already_done", detail: { reason: "not_configured" } });
    expect(store.runs).toHaveLength(0);
    expect(runTrekSync).not.toHaveBeenCalled();
  });

  it("records a partial pass as failed, because an edit never reached Trek", async () => {
    vi.mocked(runTrekSync).mockResolvedValue(
      result({ status: "partial", errors: ["2026-09-14: boom"], stillPending: ["2026-09-14"] }),
    );

    const out = await runTrekSyncJob();

    expect(out.status).toBe("failed");
    expect(out.error).toBe("2026-09-14: boom");
    expect(store.runs[0]?.status).toBe("failed");
    expect(store.runs[0]?.detail).toMatchObject({ stillPending: ["2026-09-14"] });
  });

  it("records a failed pass with the joined errors", async () => {
    vi.mocked(runTrekSync).mockResolvedValue(
      result({ status: "failed", errors: ["login rejected", "second"] }),
    );

    const out = await runTrekSyncJob();

    expect(out.status).toBe("failed");
    expect(out.error).toBe("login rejected; second");
  });

  it("never alerts — an hourly job flapping would be pure Gotify noise", async () => {
    vi.mocked(runTrekSync).mockResolvedValue(result({ status: "failed", errors: ["down"] }));

    await runTrekSyncJob();

    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("reports already_done when a concurrent pass holds the lock", async () => {
    // The lock lives inside runTrekSync() now — it is what reports `skipped`,
    // and this wrapper only has to translate that into a job outcome that does
    // not look like a failure in the run log.
    vi.mocked(runTrekSync).mockResolvedValue(result({ status: "skipped", pulled: 0, pushed: 0 }));

    const out = await runTrekSyncJob();

    expect(out).toMatchObject({ status: "already_done", detail: { reason: "lock_not_acquired" } });
    expect(store.runs[0]?.status).toBe("already_done");
    expect(store.runs[0]?.error).toBeNull();
  });

  it("passes the trigger and the year through", async () => {
    vi.mocked(runTrekSync).mockResolvedValue(result({ year: 2025 }));

    await runTrekSyncJob({ trigger: "manual", year: 2025 });

    expect(store.runs[0]?.trigger).toBe("manual");
    expect(vi.mocked(runTrekSync).mock.calls[0]?.[0]).toMatchObject({ year: 2025 });
    // `trigger` is job bookkeeping, not a sync input — it must not leak through.
    expect(vi.mocked(runTrekSync).mock.calls[0]?.[0]).not.toHaveProperty("trigger");
  });

  it("records a failure when the bookkeeping itself throws", async () => {
    vi.mocked(runTrekSync).mockRejectedValue(new Error("lock exploded"));

    const out = await runTrekSyncJob();

    expect(out).toMatchObject({ status: "failed", error: "lock exploded" });
    expect(store.runs[0]?.status).toBe("failed");
  });
});

describe("summarize", () => {
  it("omits the empty arrays so a clean pass logs a short row", () => {
    expect(summarize(result())).toEqual({ year: 2026, pulled: 3, deleted: 0, pushed: 1 });
  });

  it("keeps the arrays that carry a problem", () => {
    const detail = summarize(result({ weekendBlocked: ["2026-09-12"], stillPending: ["2026-09-14"] }));
    expect(detail).toMatchObject({
      weekendBlocked: ["2026-09-12"],
      stillPending: ["2026-09-14"],
    });
  });
});
