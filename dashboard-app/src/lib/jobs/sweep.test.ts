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
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
    // `vi.hoisted()`'s callback runs before any import binding in this file
    // is initialized, so TEST_ENCRYPTION_KEY cannot be referenced from in
    // here — it is set right below instead, still ahead of the static
    // imports that trigger `env()`.
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
  });
  return {
    runs: [] as RunRow[],
    nextRunId: 1,
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
}));

vi.mock("@/lib/jobs/heartbeat", () => ({ touchHeartbeat: vi.fn(async () => true) }));

import { touchHeartbeat } from "@/lib/jobs/heartbeat";
import { runSweep } from "@/lib/jobs/sweep";

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  vi.clearAllMocks();
  vi.mocked(touchHeartbeat).mockResolvedValue(true);
});

describe("resilience", () => {
  it("touches the heartbeat and nothing else", async () => {
    const result = await runSweep({ trigger: "cron", now: new Date("2026-09-05T10:00:00Z") });
    expect(result.status).toBe("success");
    expect(Object.keys(result.detail ?? {})).toEqual(["heartbeat"]);
  });

  it("records a clean sweep as a success run", async () => {
    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(result.status).toBe("success");
    expect(result.detail?.heartbeat).toBe(true);
    expect(store.runs.filter((r) => r.jobName === "sweep")).toHaveLength(1);
  });

  it("defaults the trigger to cron", async () => {
    await runSweep({ now: new Date("2026-08-15T09:07:00Z") });
    expect(store.runs[0]?.trigger).toBe("cron");
  });
});
