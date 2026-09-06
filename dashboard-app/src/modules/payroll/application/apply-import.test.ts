import { describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "./ports";
import {
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import {
  MemoryContributionsRepository,
  MemoryFundsRepository,
  MemorySchedulesRepository,
} from "@/modules/funds/infrastructure/memory-repositories";
import { memoryPayrollContributionSink } from "@/modules/funds/infrastructure/memory-contribution-sink";
import { noopScanner } from "../infrastructure/noop-scanner";
import { applyImport } from "./apply-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
    net: { value: 1800, confidence: "high", rules: 1800, llm: null },
    taxes: { value: 700, confidence: "high", rules: 700, llm: null },
    fundContribEmployee: { value: 50, confidence: "high", rules: 50, llm: null },
    fundContribEmployer: { value: 100, confidence: "high", rules: 100, llm: null },
    ferieBalance: { value: 88.25, confidence: "medium", rules: 88.25, llm: null },
  },
  checks: [],
};

async function makeDeps() {
  const fundRepository = new MemoryFundsRepository();
  const scheduleRepository = new MemorySchedulesRepository();
  const contributions = new MemoryContributionsRepository();
  const fund = await fundRepository.create({
    userId: principal.userId,
    slug: "cometa",
    name: "Cometa",
    kind: "pension",
    currency: "EUR",
    accountId: null,
  });
  const funds = memoryPayrollContributionSink({
    funds: fundRepository,
    schedules: scheduleRepository,
    contributions,
  });
  const audits: Array<{ action: string; after?: unknown }> = [];
  const mappingRules = new MemoryPayrollMappingRulesRepository();
  const deps: UseCaseDeps & {
    mappingRules: MemoryPayrollMappingRulesRepository;
    contributions: MemoryContributionsRepository;
    fundId: string;
    audits: typeof audits;
  } = {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules,
    funds,
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async (e) => void audits.push(e as { action: string; after?: unknown }),
    contributions,
    fundId: fund.id,
    audits,
  };
  return deps;
}

let sha = 0;
async function aVerifiedImport(deps: UseCaseDeps, over: Partial<PayslipExtraction> = {}) {
  sha += 1;
  const created = await deps.imports.create({
    userId: principal.userId,
    fileName: "Busta Paga Agosto 2026.pdf",
    mime: "application/pdf",
    sizeBytes: 100,
    sha256: String(sha).padStart(64, "0"),
    storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null,
    replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"),
    uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, {
    status: "verified",
    scanStatus: "clean",
    scanner: "none",
    extraction: { ...extraction, ...over },
  }))!;
}

describe("applyImport", () => {
  it("refuses a principal without payroll.review", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps);
    await expect(applyImport(deps)(testPrincipal({ roles: ["viewer"] }), imp.id)).rejects.toThrow(/permission/i);
  });

  it("creates one record for the period with the headline figures off the components", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.record.periodStart).toBe("2026-08-01");
    expect(applied.record.periodEnd).toBe("2026-08-31");
    expect(applied.record.kind).toBe("ordinary");
    expect(applied.record.gross).toBe("2500.00");
    expect(applied.record.net).toBe("1800.00");
    expect(applied.record.verifiedAt).toEqual(NOW);
    expect(applied.record.verifiedBy).toBe(principal.userId);
    expect(applied.import.status).toBe("applied");
    expect(applied.supersededRecordId).toBeNull();
  });

  it("writes one classified component per field the payslip stated", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.components.map((c) => c.code)).toEqual([
      "gross", "net", "taxes", "fundContribEmployee", "fundContribEmployer", "ferieBalance",
    ]);
    expect(applied.components.find((c) => c.code === "fundContribEmployee")?.mappedTo).toEqual({
      kind: "fund_contribution", fundSlug: "cometa", part: "employee",
    });
    expect(applied.components.find((c) => c.code === "ferieBalance")?.quantity).toBe("88.250000");
  });

  it("writes every mapped Cometa part through the fund contribution sink", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.fundContributions).toEqual({ written: 2, skipped: [] });
    expect(await deps.contributions.listForFund(deps.fundId)).toEqual([
      expect.objectContaining({
        typeCode: "employee",
        amount: "50.00",
        payrollRecordId: applied.record.id,
        source: "payroll",
      }),
      expect.objectContaining({
        typeCode: "employer",
        amount: "100.00",
        payrollRecordId: applied.record.id,
        source: "payroll",
      }),
    ]);
  });

  it("collects every repeated mapped part so the sink can aggregate it", async () => {
    const deps = await makeDeps();
    deps.mappingRules.addUserRule(principal.userId, {
      matchCode: "taxes",
      matchLabel: null,
      componentKind: "employee_contribution",
      target: { kind: "fund_contribution", fundSlug: "cometa", part: "employee" },
      priority: 1,
    });
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.fundContributions).toEqual({ written: 2, skipped: [] });
    expect((await deps.contributions.listForFund(deps.fundId)).map((row) => [row.typeCode, row.amount])).toEqual([
      ["employee", "750.00"],
      ["employer", "100.00"],
    ]);
  });

  it("writes no fund contribution when the payslip stated none — never a 0.00 row", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps, {
      fields: { net: { value: 1800, confidence: "high", rules: 1800, llm: null } },
    });
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.fundContributions).toEqual({ written: 0, skipped: [] });
    expect(await deps.contributions.listForFund(deps.fundId)).toEqual([]);
  });

  it("files a tredicesima as its own record kind, so it never collides with December's ordinary payslip", async () => {
    const deps = await makeDeps();
    const ordinary = await aVerifiedImport(deps, { month: "2025-12-01" });
    await applyImport(deps)(principal, ordinary.id);
    const thirteenth = await aVerifiedImport(deps, { month: "2025-12-01", isThirteenth: true });
    const applied = await applyImport(deps)(principal, thirteenth.id);
    expect(applied.record.kind).toBe("thirteenth");
    expect((await deps.records.list(principal.userId)).length).toBe(2);
  });

  it("is re-runnable: applying twice recomputes the same record and replaces its components", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps);
    const first = await applyImport(deps)(principal, imp.id);
    await deps.imports.patch(principal.userId, imp.id, {
      status: "verified",
      extraction: { ...extraction, fields: { ...extraction.fields, net: { value: 1850, confidence: "high", rules: 1800, llm: null } } },
    });
    const second = await applyImport(deps)(principal, imp.id);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.net).toBe("1850.00");
    expect(second.record.version).toBe(first.record.version + 1);
    expect((await deps.records.list(principal.userId)).length).toBe(1);
    expect((await deps.contributions.listForFund(deps.fundId)).filter((row) => row.payrollRecordId === first.record.id)).toHaveLength(2);
  });

  it("supersedes the live record for the period when a replacement is applied (Ruling R4-4)", async () => {
    const deps = await makeDeps();
    const original = await aVerifiedImport(deps);
    const first = await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps);
    await deps.imports.patch(principal.userId, replacement.id, { status: "verified" });
    const applied = await applyImport(deps)(principal, replacement.id);

    expect(applied.supersededRecordId).toBe(first.record.id);
    expect(applied.record.id).not.toBe(first.record.id);
    const live = await deps.records.list(principal.userId);
    expect(live.map((r) => r.id)).toEqual([applied.record.id]);
    const all = await deps.records.list(principal.userId, { includeSuperseded: true });
    expect(all.length).toBe(2);
    const superseded = all.find((r) => r.id === first.record.id)!;
    expect(superseded.supersededByRecordId).toBe(applied.record.id);
    expect((await deps.imports.get(principal.userId, original.id))?.status).toBe("superseded");
  });

  it("keeps the superseded record's components as evidence (Ruling R4-4)", async () => {
    const deps = await makeDeps();
    const original = await aVerifiedImport(deps);
    const first = await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps);
    await applyImport(deps)(principal, replacement.id);
    expect((await deps.components.listForRecord(first.record.id)).length).toBeGreaterThan(0);
  });

  it("replaces the superseded record's fund contributions with the correction", async () => {
    const deps = await makeDeps();
    const original = await aVerifiedImport(deps);
    await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps, {
      fields: { ...extraction.fields, fundContribEmployee: { value: 60, confidence: "high", rules: 60, llm: null } },
    });
    const applied = await applyImport(deps)(principal, replacement.id);
    expect(await deps.contributions.listForFund(deps.fundId)).toEqual([
      expect.objectContaining({ payrollRecordId: applied.record.id, typeCode: "employee", amount: "60.00" }),
      expect.objectContaining({ payrollRecordId: applied.record.id, typeCode: "employer", amount: "100.00" }),
    ]);
  });

  it("refuses an import that is not verified", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps);
    await deps.imports.patch(principal.userId, imp.id, { status: "needs_review" });
    await expect(applyImport(deps)(principal, imp.id)).rejects.toMatchObject({ name: "ConflictError", reason: "not_verified" });
  });

  it("refuses an extraction with no month — a record must know its own period", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps, { month: null });
    await expect(applyImport(deps)(principal, imp.id)).rejects.toMatchObject({ name: "InvalidInputError" });
  });

  it("audits the apply with ids and counts, never with amounts", async () => {
    const deps = await makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    const audit = deps.audits.find((a) => a.action === "payroll.import_applied");
    expect(audit?.after).toEqual({
      recordId: applied.record.id,
      periodStart: "2026-08-01",
      kind: "ordinary",
      componentCount: 6,
      supersededRecordId: null,
      fundContributions: { written: 2, skipped: [] },
    });
    expect(JSON.stringify(deps.audits)).not.toContain("1800.00");
  });
});
