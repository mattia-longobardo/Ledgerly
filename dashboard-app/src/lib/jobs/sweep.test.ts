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
    APP_ENCRYPTION_KEY: `unit:${Buffer.alloc(32, 9).toString("base64")}`,
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
  });
  return {
    runs: [] as RunRow[],
    nextRunId: 1,
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

vi.mock("@/lib/repo/payslips", () => ({ knownDocIds: vi.fn(async () => [] as number[]) }));

vi.mock("@/lib/clients/paperless", () => ({ listPayslipDocuments: vi.fn(async () => []) }));

vi.mock("@/lib/jobs/payslip-ingest", () => ({
  ingestPayslipDocument: vi.fn(async () => ({ job: "payslip_ingest", status: "success" })),
}));

vi.mock("@/lib/jobs/heartbeat", () => ({ touchHeartbeat: vi.fn(async () => true) }));

import { listPayslipDocuments } from "@/lib/clients/paperless";
import { touchHeartbeat } from "@/lib/jobs/heartbeat";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";
import { knownDocIds } from "@/lib/repo/payslips";
import { runSweep } from "@/lib/jobs/sweep";

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  vi.clearAllMocks();
  vi.mocked(listPayslipDocuments).mockResolvedValue([]);
  vi.mocked(knownDocIds).mockResolvedValue([]);
  vi.mocked(touchHeartbeat).mockResolvedValue(true);
});

describe("payslip polling fallback", () => {
  it("ingests only documents that are not already known", async () => {
    vi.mocked(listPayslipDocuments).mockResolvedValue([
      { id: 11, title: "old", added: "2026-07-03T00:00:00Z", tags: [22] },
      { id: 12, title: "new", added: "2026-08-03T00:00:00Z", tags: [22] },
    ]);
    vi.mocked(knownDocIds).mockResolvedValue([11]);

    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(ingestPayslipDocument).toHaveBeenCalledTimes(1);
    expect(ingestPayslipDocument).toHaveBeenCalledWith({ docId: 12, trigger: "sweep" });
    expect(result.detail?.payslipPolling).toEqual({ seen: 2, ingested: { 12: "success" } });
  });
});

describe("resilience", () => {
  it("keeps going after a failing step, reports it, and still touches the heartbeat", async () => {
    vi.mocked(listPayslipDocuments).mockRejectedValue(new Error("paperless 502"));

    const result = await runSweep({ now: new Date("2026-08-15T09:07:00Z") });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("payslip_polling: paperless 502");
    expect(touchHeartbeat).toHaveBeenCalledWith(new Date("2026-08-15T09:07:00Z"));
    expect(store.runs.find((r) => r.jobName === "sweep")?.status).toBe("failed");
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
