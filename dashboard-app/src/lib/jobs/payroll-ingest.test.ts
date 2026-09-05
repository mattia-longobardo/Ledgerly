import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(async () => ({ id: "run-1" })),
  finishRun: vi.fn(async () => {}),
  withJobLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/clients/gotify", () => ({ alertJobFailure: vi.fn(async () => {}) }));

const scanImport = vi.fn();
const parseImport = vi.fn();
const listDue = vi.fn();
const patchImport = vi.fn(async () => null);

vi.mock("@/modules/payroll/infrastructure/ingest", () => ({
  scanImport: (...args: unknown[]) => scanImport(...args),
  parseImport: (...args: unknown[]) => parseImport(...args),
}));
vi.mock("@/platform/db/context", () => ({
  withSystemContext: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("@/modules/payroll/infrastructure/deps", () => ({
  payrollDeps: () => ({ imports: { listByStatusForAllUsers: listDue, patch: patchImport } }),
}));

const { runPayrollIngestJob } = await import("./payroll-ingest");
const { finishRun } = await import("@/lib/repo/jobs");
const { alertJobFailure } = await import("@/lib/clients/gotify");

const NOW = new Date("2026-09-05T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  scanImport.mockReset();
  parseImport.mockReset();
  listDue.mockReset();
  patchImport.mockReset();
  patchImport.mockResolvedValue(null);
});

function due(id: string, userId = "u1", status = "scanning") {
  return { id, userId, status };
}

describe("runPayrollIngestJob", () => {
  it("records a success with zero counts when nothing is due", async () => {
    listDue.mockResolvedValue([]);
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ considered: 0, scanned: 0, parsed: 0, needsOcr: 0, failed: 0 });
  });

  it("scans a scanning import and then parses it in the same tick", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanImport.mockResolvedValue({ outcome: "parsed", import: { id: "i1", status: "extracting" } });
    parseImport.mockResolvedValue({ outcome: "parsed", import: { id: "i1", status: "needs_review" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(scanImport).toHaveBeenCalledTimes(1);
    expect(parseImport).toHaveBeenCalledTimes(1);
    expect(result.detail).toMatchObject({ considered: 1, scanned: 1, parsed: 1 });
  });

  it("counts a scanner outage and does not try to parse behind it", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanImport.mockResolvedValue({ outcome: "scanner_unavailable", import: { id: "i1" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(parseImport).not.toHaveBeenCalled();
    expect(result.detail).toMatchObject({ scannerUnavailable: 1, parsed: 0 });
  });

  it("counts an infected rejection and does not parse it", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanImport.mockResolvedValue({ outcome: "rejected_infected", import: { id: "i1" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(parseImport).not.toHaveBeenCalled();
    expect(result.detail).toMatchObject({ infected: 1 });
  });

  it("parses an import already past the scanner without re-scanning it", async () => {
    listDue.mockResolvedValue([due("i1", "u1", "extracting")]);
    parseImport.mockResolvedValue({ outcome: "parsed", import: { id: "i1" } });
    await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(scanImport).not.toHaveBeenCalled();
    expect(parseImport).toHaveBeenCalledTimes(1);
  });

  it("counts a needs_ocr park separately from a failure", async () => {
    listDue.mockResolvedValue([due("i1", "u1", "extracting")]);
    parseImport.mockResolvedValue({ outcome: "needs_ocr", import: { id: "i1" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.detail).toMatchObject({ needsOcr: 1, failed: 0 });
  });

  it("isolates one import's failure so the rest of the tick still runs", async () => {
    listDue.mockResolvedValue([due("i1"), due("i2", "u2")]);
    scanImport
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ outcome: "parsed", import: { id: "i2" } });
    parseImport.mockResolvedValue({ outcome: "parsed", import: { id: "i2" } });
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ considered: 2, failed: 1, parsed: 1 });
  });

  it("records a bare error patch on a failing import, so it sorts to the back of the next tick (Finding 8)", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanImport.mockRejectedValue(new Error("llm unavailable"));
    await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(patchImport).toHaveBeenCalledWith("u1", "i1", { error: "llm unavailable" });
  });

  it("does not let a failed bookkeeping patch mask the original failure", async () => {
    listDue.mockResolvedValue([due("i1")]);
    scanImport.mockRejectedValue(new Error("llm unavailable"));
    patchImport.mockRejectedValue(new Error("db also down"));
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("success");
    expect(result.detail).toMatchObject({ failed: 1 });
  });

  it("records a failed run and alerts when the selection itself throws", async () => {
    listDue.mockRejectedValue(new Error("database down"));
    const result = await runPayrollIngestJob({ trigger: "cron", now: NOW });
    expect(result.status).toBe("failed");
    expect(finishRun).toHaveBeenCalledWith("run-1", "failed", expect.objectContaining({ error: "database down" }));
    expect(alertJobFailure).toHaveBeenCalled();
  });
});
