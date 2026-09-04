import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/contracts";

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
    APP_ENCRYPTION_KEY: `unit:${Buffer.alloc(32, 9).toString("base64")}`,
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
    SNAPSHOT_GRACE_DAYS: "3",
  });
  return { runs: [] as RunRow[], nextRunId: 1, lockHeld: false };
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
  // `pg_try_advisory_xact_lock` returning false surfaces as `null`, exactly as
  // the real helper does.
  withJobLock: vi.fn(async <T,>(_key: string, fn: () => Promise<T>): Promise<T | null> =>
    store.lockHeld ? null : fn(),
  ),
}));

vi.mock("@/lib/repo/balances", () => ({ recordSnapshots: vi.fn(async () => undefined) }));

vi.mock("@/lib/clients/wallet", () => ({ getBalances: vi.fn() }));

vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

import { httpRequest } from "@/lib/clients/http";
import { getBalances } from "@/lib/clients/wallet";
import { recordSnapshots } from "@/lib/repo/balances";
import { finishRun, withJobLock } from "@/lib/repo/jobs";
import { JOB_NAME, runWalletRefresh } from "@/lib/jobs/wallet-refresh";

const NOON = new Date("2026-09-01T10:00:00Z");

const BALANCES = {
  ing: 1234.56,
  revolut: 789.01,
  breakdown: { ing: 1234.56, revolut_main: 500, revolut_savings: 200.01, revolut_holidays: 89 },
} as const;

function alerts(): Array<{ title: string; message: string; priority: number }> {
  return vi.mocked(httpRequest).mock.calls.map(
    (call) =>
      JSON.parse(String(call[2]?.body ?? "{}")) as {
        title: string;
        message: string;
        priority: number;
      },
  );
}

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  store.lockHeld = false;
  vi.clearAllMocks();
  vi.mocked(getBalances).mockResolvedValue(BALANCES);
  vi.mocked(httpRequest).mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("runWalletRefresh", () => {
  it("writes ING, the Revolut total and the three sub-accounts at `now`", async () => {
    const result = await runWalletRefresh({ now: NOON });

    expect(result).toMatchObject({ job: JOB_NAME, status: "success" });
    expect(getBalances).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(recordSnapshots).mock.calls.at(-1)?.[0];
    expect(rows?.map((r) => [r.accountKey, r.balance])).toEqual([
      ["ing", "1234.56"],
      ["revolut_total", "789.01"],
      ["revolut_main", "500.00"],
      ["revolut_savings", "200.01"],
      ["revolut_holidays", "89.00"],
    ]);
    expect(rows?.every((r) => r.capturedAt === NOON)).toBe(true);
    expect(rows?.every((r) => r.source === "wallet")).toBe(true);
  });

  it("records the run and stays silent when it works", async () => {
    await runWalletRefresh({ now: NOON, trigger: "cron" });

    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ jobName: JOB_NAME, trigger: "cron", status: "success" });
    expect(alerts()).toEqual([]);
  });

  it("has no staleness gate: the cron schedule is the gate", async () => {
    // Two runs back to back fetch twice. A budget on top of a daily schedule
    // could only ever suppress the one refresh of the day.
    await runWalletRefresh({ now: NOON });
    await runWalletRefresh({ now: new Date(NOON.getTime() + 60_000) });

    expect(getBalances).toHaveBeenCalledTimes(2);
  });

  it("defaults the trigger to cron", async () => {
    await runWalletRefresh({ now: NOON });
    expect(store.runs[0]?.trigger).toBe("cron");
  });

  it("takes the job lock, so `curl --retry` cannot double-write", async () => {
    store.lockHeld = true;

    const result = await runWalletRefresh({ now: NOON });

    expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function));
    expect(result).toMatchObject({
      job: JOB_NAME,
      status: "already_done",
      detail: { reason: "lock_not_acquired" },
    });
    expect(getBalances).not.toHaveBeenCalled();
    expect(recordSnapshots).not.toHaveBeenCalled();
    expect(store.runs[0]?.status).toBe("already_done");
    expect(alerts()).toEqual([]);
  });

  it("never throws: an upstream failure becomes a failed run plus a JobResult", async () => {
    vi.mocked(getBalances).mockRejectedValue(
      new UpstreamError("wallet", "authentication rejected by the Wallet API (HTTP 401)"),
    );

    const result = await runWalletRefresh({ now: NOON });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("authentication rejected");
    expect(store.runs[0]?.status).toBe("failed");
    expect(recordSnapshots).not.toHaveBeenCalled();
  });

  it("alerts on failure — a daily job has no second attempt coming", async () => {
    vi.mocked(getBalances).mockRejectedValue(new Error("wallet 502"));

    await runWalletRefresh({ now: NOON });

    const sent = alerts();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toContain("wallet_refresh");
    expect(sent[0]?.priority).toBe(8);
    expect(sent[0]?.message).toContain("wallet 502");
  });

  it("still finishes the run when the alert itself cannot be delivered", async () => {
    vi.mocked(getBalances).mockRejectedValue(new Error("wallet 502"));
    vi.mocked(httpRequest).mockRejectedValue(new Error("gotify down"));

    const result = await runWalletRefresh({ now: NOON });

    expect(result.status).toBe("failed");
    expect(finishRun).toHaveBeenCalledWith(1, "failed", { error: "wallet 502" });
  });
});
