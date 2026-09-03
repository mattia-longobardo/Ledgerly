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
    WALLET_API_URL: "https://wallet.example.test/wallet/v1/api",
  });
  return {
    runs: [] as RunRow[],
    nextRunId: 1,
    lockHeld: false,
    tokenConfigured: true,
    owners: [] as string[],
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

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    walletToken: vi.fn(() => {
      if (!store.tokenConfigured) throw new Error("Wallet token file /run/secrets/wallet is empty");
      return "jwt-token";
    }),
  };
});

// Only the owner lookup runs against `db` here; every account statement goes
// through the mocked user context below.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => store.owners.map((id) => ({ id })).slice(0, 1) }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/platform/db/context", () => ({
  withUserContext: vi.fn(async <T,>(_db: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn({})),
}));

vi.mock("@/modules/accounts/application/sync-provider-accounts", () => ({
  syncProviderAccounts: vi.fn(() => async () => ({
    created: 1,
    updated: 2,
    adopted: 0,
    balances: 3,
    missing: 1,
  })),
}));

vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

import { httpRequest } from "@/lib/clients/http";
import { withJobLock } from "@/lib/repo/jobs";
import { syncProviderAccounts } from "@/modules/accounts/application/sync-provider-accounts";
import { withUserContext } from "@/platform/db/context";
import { JOB_NAME, runWalletAccountsSync } from "@/lib/jobs/wallet-accounts-sync";

function alerts(): Array<{ title: string; message: string }> {
  return vi
    .mocked(httpRequest)
    .mock.calls.map((call) => JSON.parse(String(call[2]?.body ?? "{}")) as { title: string; message: string });
}

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  store.lockHeld = false;
  store.tokenConfigured = true;
  store.owners = ["owner-1"];
  vi.clearAllMocks();
  vi.mocked(httpRequest).mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("runWalletAccountsSync", () => {
  it("syncs the owner, once, under the owner's own context", async () => {
    const result = await runWalletAccountsSync({ trigger: "cron" });

    expect(result).toMatchObject({
      job: JOB_NAME,
      status: "success",
      detail: { created: 1, updated: 2, adopted: 0, balances: 3, missing: 1 },
    });
    // One credential, one user: a second user would be handed the owner's
    // provider links, which are unique on the external id alone.
    expect(vi.mocked(withUserContext).mock.calls.map((c) => c[1])).toEqual([
      { userId: "owner-1", role: "system" },
    ]);
    expect(store.runs[0]).toMatchObject({ jobName: JOB_NAME, trigger: "cron", status: "success" });
    expect(alerts()).toEqual([]);
  });

  it("records a skipped run when the install has no owner yet", async () => {
    store.owners = [];

    const result = await runWalletAccountsSync();

    expect(result).toMatchObject({ job: JOB_NAME, status: "already_done", detail: { reason: "no_owner" } });
    expect(store.runs[0]?.status).toBe("already_done");
    expect(syncProviderAccounts).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
  });

  it("records a skipped run and stays silent when Wallet is not configured", async () => {
    store.tokenConfigured = false;

    const result = await runWalletAccountsSync();

    expect(result).toMatchObject({
      job: JOB_NAME,
      status: "already_done",
      detail: { reason: "wallet_not_configured" },
    });
    expect(store.runs[0]?.status).toBe("already_done");
    expect(syncProviderAccounts).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
  });

  it("takes the job lock, so `curl --retry` cannot double-write", async () => {
    store.lockHeld = true;

    const result = await runWalletAccountsSync();

    expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function));
    expect(result).toMatchObject({ status: "already_done", detail: { reason: "lock_not_acquired" } });
    expect(syncProviderAccounts).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
  });

  it("never throws: a failure becomes a failed run, a JobResult and an alert", async () => {
    vi.mocked(syncProviderAccounts).mockImplementationOnce(() => async () => {
      throw new Error("wallet 502");
    });

    const result = await runWalletAccountsSync();

    expect(result).toMatchObject({ job: JOB_NAME, status: "failed", error: "wallet 502" });
    expect(store.runs[0]?.status).toBe("failed");
    const sent = alerts();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toContain(JOB_NAME);
    expect(sent[0]?.message).toContain("wallet 502");
  });

  it("defaults the trigger to cron", async () => {
    await runWalletAccountsSync();
    expect(store.runs[0]?.trigger).toBe("cron");
  });
});
