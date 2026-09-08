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
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
    APP_ENCRYPTION_KEY: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
    WALLET_API_URL: "https://wallet.example.test/wallet/v1/api",
  });
  return {
    runs: [] as RunRow[],
    nextRunId: 1,
    lockHeld: false,
    connected: true,
    syncRun: { id: "r1", status: "success", stats: { created: 2, patternsDetected: 0 }, error: null } as {
      id: string;
      status: "success" | "failed";
      stats: Record<string, number>;
      error: string | null;
    },
  };
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
    async (id: number, status: string, extra?: { error?: string; detail?: Record<string, unknown> }) => {
      const row = store.runs.find((r) => r.id === id);
      if (!row) throw new Error(`finishRun for unknown run ${id}`);
      row.status = status;
      row.error = extra?.error ?? null;
      row.detail = extra?.detail ?? null;
    },
  ),
  withJobLock: vi.fn(async <T,>(_key: string, fn: () => Promise<T>): Promise<T | null> =>
    store.lockHeld ? null : fn(),
  ),
}));

vi.mock("@/modules/integrations/infrastructure/owner-connection", () => ({
  openOwnerConnection: vi.fn(async () =>
    store.connected
      ? {
          userId: "00000000-0000-7000-8000-000000000001",
          connection: { id: "c1", provider: "wallet", status: "connected" },
          credentials: { token: "test-token" },
        }
      : null,
  ),
}));

vi.mock("@/modules/integrations/application/run-sync", () => ({
  runSyncForUser: () => async () => store.syncRun,
}));

vi.mock("@/platform/integrations/register-all", () => ({ ensureProvidersRegistered: vi.fn() }));

vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

import { httpRequest } from "@/lib/clients/http";
import { withJobLock } from "@/lib/repo/jobs";
import { openOwnerConnection } from "@/modules/integrations/infrastructure/owner-connection";
import { JOB_NAME, runWalletTransactionsSync } from "@/lib/jobs/wallet-transactions-sync";

function alerts(): Array<{ title: string; message: string }> {
  return vi
    .mocked(httpRequest)
    .mock.calls.map((call) => JSON.parse(String(call[2]?.body ?? "{}")) as { title: string; message: string });
}

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  store.lockHeld = false;
  store.connected = true;
  store.syncRun = { id: "r1", status: "success", stats: { created: 2, patternsDetected: 0 }, error: null };
  vi.clearAllMocks();
  vi.mocked(httpRequest).mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("runWalletTransactionsSync", () => {
  it("syncs the owner, once, through the sync engine", async () => {
    const result = await runWalletTransactionsSync({ trigger: "cron" });

    expect(result).toMatchObject({
      job: JOB_NAME,
      status: "success",
      detail: { runId: "r1", status: "success", created: 2, patternsDetected: 0 },
    });
    expect(vi.mocked(openOwnerConnection)).toHaveBeenCalledWith("wallet");
    expect(store.runs[0]).toMatchObject({ jobName: JOB_NAME, trigger: "cron", status: "success" });
    expect(alerts()).toEqual([]);
  });

  it("records a skipped run and stays silent when Wallet is not connected", async () => {
    store.connected = false;

    const result = await runWalletTransactionsSync();

    expect(result).toMatchObject({
      job: JOB_NAME,
      status: "already_done",
      detail: { reason: "wallet_not_connected" },
    });
    expect(store.runs[0]?.status).toBe("already_done");
    expect(alerts()).toEqual([]);
  });

  it("takes the job lock, so `curl --retry` cannot double-write", async () => {
    store.lockHeld = true;

    const result = await runWalletTransactionsSync();

    expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function));
    expect(result).toMatchObject({ status: "already_done", detail: { reason: "lock_not_acquired" } });
    expect(alerts()).toEqual([]);
  });

  it("never throws: a failure becomes a failed run, a JobResult and an alert", async () => {
    store.syncRun = { id: "r1", status: "failed", stats: {}, error: "wallet 502" };

    const result = await runWalletTransactionsSync();

    expect(result).toMatchObject({ job: JOB_NAME, status: "failed", error: "wallet 502" });
    expect(store.runs[0]?.status).toBe("failed");
    const sent = alerts();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toContain(JOB_NAME);
    expect(sent[0]?.message).toContain("wallet 502");
  });

  it("defaults the trigger to cron", async () => {
    await runWalletTransactionsSync();
    expect(store.runs[0]?.trigger).toBe("cron");
  });

  it("registers the providers before the first sync can be dispatched", async () => {
    const { ensureProvidersRegistered } = await import("@/platform/integrations/register-all");
    await runWalletTransactionsSync();
    expect(ensureProvidersRegistered).toHaveBeenCalled();
  });
});
