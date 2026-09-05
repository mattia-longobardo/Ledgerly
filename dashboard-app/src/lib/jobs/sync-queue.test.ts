import { beforeEach, describe, expect, it, vi } from "vitest";

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
    WALLET_API_URL: "https://wallet.example.test/wallet/v1/api",
    APP_ENCRYPTION_KEY: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
  });
  return { runs: [] as { id: number; status: string; detail: unknown; error: string | null }[], nextId: 1, lockHeld: false, drained: [] as { status: string }[] };
});

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(async () => {
    const row = { id: store.nextId++, status: "running", detail: null, error: null };
    store.runs.push(row);
    return row;
  }),
  finishRun: vi.fn(async (id: number, status: string, extra?: { detail?: unknown; error?: string }) => {
    const row = store.runs.find((r) => r.id === id)!;
    row.status = status;
    row.detail = extra?.detail ?? null;
    row.error = extra?.error ?? null;
  }),
  withJobLock: vi.fn(async <T,>(_k: string, fn: () => Promise<T>) => (store.lockHeld ? null : fn())),
}));
vi.mock("@/modules/integrations/application/drain-sync-queue", () => ({
  drainSyncQueue: () => async () => store.drained,
}));

import { runSyncQueue } from "./sync-queue";

describe("runSyncQueue", () => {
  beforeEach(() => {
    store.runs = [];
    store.nextId = 1;
    store.lockHeld = false;
    store.drained = [];
  });

  it("reports an empty queue as already_done", async () => {
    const result = await runSyncQueue();
    expect(result.status).toBe("already_done");
    expect(result.detail).toEqual({ reason: "queue_empty" });
    expect(store.runs[0]!.status).toBe("already_done");
  });

  it("counts what it drained, failures included", async () => {
    store.drained = [{ status: "success" }, { status: "failed" }];
    const result = await runSyncQueue();
    expect(result.status).toBe("success");
    expect(result.detail).toEqual({ drained: 2, failed: 1 });
  });

  it("stands down when another tick holds the lock", async () => {
    store.lockHeld = true;
    const result = await runSyncQueue();
    expect(result.detail).toEqual({ reason: "lock_not_acquired" });
  });
});
