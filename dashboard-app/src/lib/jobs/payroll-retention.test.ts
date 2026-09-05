import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(async () => ({ id: "run-1" })),
  finishRun: vi.fn(async () => {}),
  withJobLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/clients/gotify", () => ({ alertJobFailure: vi.fn(async () => {}) }));

const purge = vi.fn();
vi.mock("@/modules/payroll/infrastructure/purge-expired-originals", () => ({
  PURGE_BATCH: 100,
  purgeExpiredOriginals: (...args: unknown[]) => purge(...args),
}));

const { runPayrollRetentionJob } = await import("./payroll-retention");
const { finishRun } = await import("@/lib/repo/jobs");
const { alertJobFailure } = await import("@/lib/clients/gotify");

const NOW = new Date("2026-09-05T02:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  purge.mockReset();
});

describe("runPayrollRetentionJob", () => {
  it("reports what it purged", async () => {
    purge.mockResolvedValue({ considered: 3, purged: 3, failed: 0 });
    const result = await runPayrollRetentionJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(result.detail).toEqual({ considered: 3, purged: 3, failed: 0 });
    expect(purge).toHaveBeenCalledWith(NOW, 100);
  });

  it("succeeds with zeros when nothing has expired", async () => {
    purge.mockResolvedValue({ considered: 0, purged: 0, failed: 0 });
    const result = await runPayrollRetentionJob({ trigger: "cron", now: NOW });
    expect(result.detail).toEqual({ considered: 0, purged: 0, failed: 0 });
  });

  it("alerts when a delete failed, because a store that cannot be purged is an operator problem", async () => {
    purge.mockResolvedValue({ considered: 2, purged: 1, failed: 1 });
    const result = await runPayrollRetentionJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(alertJobFailure).toHaveBeenCalledWith(expect.objectContaining({ job: "payroll_retention" }));
  });

  it("records a failed run when the purge itself throws", async () => {
    purge.mockRejectedValue(new Error("store unreachable"));
    const result = await runPayrollRetentionJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("failed");
    expect(finishRun).toHaveBeenCalledWith("run-1", "failed", expect.objectContaining({ error: "store unreachable" }));
  });
});
