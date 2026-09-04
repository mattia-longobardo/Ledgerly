import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";

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
    // `vi.hoisted()`'s callback runs before any import binding in this file
    // is initialized, so TEST_ENCRYPTION_KEY cannot be referenced from in
    // here — it is set right below instead, still ahead of the static
    // imports that trigger `env()`.
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
    SNAPSHOT_GRACE_DAYS: "3",
  });
  interface SyncRunFixture {
    id: string;
    status: string;
    stats: Record<string, number>;
    error: string | null;
  }
  return {
    runs: [] as RunRow[],
    nextRunId: 1,
    connected: true,
    syncRun: {
      id: "r1",
      status: "success",
      stats: { pulled: 3, pushed: 1 },
      error: null,
    } as SyncRunFixture | null,
  };
});
process.env.APP_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

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

vi.mock("@/modules/integrations/infrastructure/owner-connection", () => ({
  openOwnerConnection: vi.fn(async () =>
    store.connected
      ? { userId: "u1", connection: { id: "c1", provider: "trek", status: "connected" }, credentials: {} }
      : null,
  ),
}));
vi.mock("@/modules/integrations/application/run-sync", () => ({
  runSyncForUser: () => async () => {
    if (store.syncRun === null) throw new Error("lock exploded");
    return store.syncRun;
  },
}));
vi.mock("@/platform/integrations/register-all", () => ({ ensureProvidersRegistered: () => {} }));

// Gotify goes over httpRequest; a job that alerts would show up here.
vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

import { httpRequest } from "@/lib/clients/http";
import { JOB_NAME, runTrekSyncJob } from "@/lib/jobs/trek-sync-job";

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  store.connected = true;
  store.syncRun = { id: "r1", status: "success", stats: { pulled: 3, pushed: 1 }, error: null };
  vi.mocked(httpRequest).mockClear();
});

describe("runTrekSyncJob", () => {
  it("records a success run and reports what moved", async () => {
    const out = await runTrekSyncJob();

    expect(out).toMatchObject({ job: JOB_NAME, status: "success" });
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ jobName: JOB_NAME, trigger: "cron", status: "success" });
    expect(store.runs[0]?.detail).toMatchObject({ runId: "r1", pulled: 3, pushed: 1 });
  });

  it("writes NO job_runs row when the owner has no Trek connection", async () => {
    store.connected = false;

    const out = await runTrekSyncJob();

    // An hourly job logging "not connected" 24x/day would bury every other
    // job in the settings page's 20-row log.
    expect(out).toMatchObject({ status: "already_done", detail: { reason: "not_connected" } });
    expect(store.runs).toHaveLength(0);
  });

  it("records a failed sync run as failed, with its error and stats", async () => {
    store.syncRun = {
      id: "r1",
      status: "failed",
      error: "2026-09-14: boom",
      stats: { pulled: 0, pushed: 0 },
    };

    const out = await runTrekSyncJob();

    expect(out.status).toBe("failed");
    expect(out.error).toBe("2026-09-14: boom");
    expect(store.runs[0]?.status).toBe("failed");
    expect(store.runs[0]?.detail).toMatchObject({ pulled: 0, pushed: 0 });
  });

  it("never alerts — an hourly job flapping would be pure Gotify noise", async () => {
    store.syncRun = { id: "r1", status: "failed", error: "down", stats: {} };

    await runTrekSyncJob();

    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("reports already_done when a sync for this connection is already running", async () => {
    // The engine hands back the run already in flight rather than starting a
    // second conversation with Trek, whose toggle is its own inverse.
    store.syncRun = { id: "r1", status: "running", error: null, stats: {} };

    const out = await runTrekSyncJob();

    expect(out).toMatchObject({ status: "already_done", detail: { reason: "already_running" } });
    expect(store.runs[0]?.status).toBe("already_done");
    expect(store.runs[0]?.error).toBeNull();
  });

  it("passes the trigger through", async () => {
    await runTrekSyncJob({ trigger: "manual" });

    expect(store.runs[0]?.trigger).toBe("manual");
  });

  it("records a failure when the bookkeeping itself throws", async () => {
    store.syncRun = null;

    const out = await runTrekSyncJob();

    expect(out).toMatchObject({ status: "failed", error: "lock exploded" });
    expect(store.runs[0]?.status).toBe("failed");
    expect(store.runs[0]?.error).toBe("lock exploded");
  });
});
