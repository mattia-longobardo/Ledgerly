import { describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
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

function makeDeps() {
  const funds = new MemoryLegacyFundDeposits(["cometa"]);
  const audits: Array<{ action: string; after?: unknown }> = [];
  const deps: UseCaseDeps & { funds: MemoryLegacyFundDeposits; audits: typeof audits } = {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds,
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async (e) => void audits.push(e as { action: string; after?: unknown }),
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
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    await expect(applyImport(deps)(testPrincipal({ roles: ["viewer"] }), imp.id)).rejects.toThrow(/permission/i);
  });

  it("creates one record for the period with the headline figures off the components", async () => {
    const deps = makeDeps();
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
    const deps = makeDeps();
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

  it("bridges the Cometa contributions into the legacy fund deposits (Ruling R4-6)", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.fundDeposit).toBe("written");
    expect(deps.funds.rows).toEqual([
      {
        fundSlug: "cometa",
        month: "2026-08-01",
        amount: "150.00",
        employee: "50.00",
        employer: "100.00",
        source: "payroll",
        payslipId: null,
      },
    ]);
  });

  it("writes no fund deposit when the payslip stated no contribution — never a 0.00 row", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps, {
      fields: { net: { value: 1800, confidence: "high", rules: 1800, llm: null } },
    });
    const applied = await applyImport(deps)(principal, imp.id);
    expect(applied.fundDeposit).toBe("no_amount");
    expect(deps.funds.rows).toEqual([]);
  });

  it("files a tredicesima as its own record kind, so it never collides with December's ordinary payslip", async () => {
    const deps = makeDeps();
    const ordinary = await aVerifiedImport(deps, { month: "2025-12-01" });
    await applyImport(deps)(principal, ordinary.id);
    const thirteenth = await aVerifiedImport(deps, { month: "2025-12-01", isThirteenth: true });
    const applied = await applyImport(deps)(principal, thirteenth.id);
    expect(applied.record.kind).toBe("thirteenth");
    expect((await deps.records.list(principal.userId)).length).toBe(2);
  });

  it("is re-runnable: applying twice recomputes the same record and replaces its components", async () => {
    const deps = makeDeps();
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
  });

  it("supersedes the live record for the period when a replacement is applied (Ruling R4-4)", async () => {
    const deps = makeDeps();
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
    const deps = makeDeps();
    const original = await aVerifiedImport(deps);
    const first = await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps);
    await applyImport(deps)(principal, replacement.id);
    expect((await deps.components.listForRecord(first.record.id)).length).toBeGreaterThan(0);
  });

  it("re-upserts the month's fund deposit from the replacement, so the Funds page follows the correction", async () => {
    const deps = makeDeps();
    const original = await aVerifiedImport(deps);
    await applyImport(deps)(principal, original.id);
    const replacement = await aVerifiedImport(deps, {
      fields: { ...extraction.fields, fundContribEmployee: { value: 60, confidence: "high", rules: 60, llm: null } },
    });
    await applyImport(deps)(principal, replacement.id);
    expect(deps.funds.rows).toEqual([
      {
        fundSlug: "cometa",
        month: "2026-08-01",
        amount: "160.00",
        employee: "60.00",
        employer: "100.00",
        source: "payroll",
        payslipId: null,
      },
    ]);
  });

  it("refuses an import that is not verified", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    await deps.imports.patch(principal.userId, imp.id, { status: "needs_review" });
    await expect(applyImport(deps)(principal, imp.id)).rejects.toMatchObject({ name: "ConflictError", reason: "not_verified" });
  });

  it("refuses an extraction with no month — a record must know its own period", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps, { month: null });
    await expect(applyImport(deps)(principal, imp.id)).rejects.toMatchObject({ name: "InvalidInputError" });
  });

  it("audits the apply with ids and counts, never with amounts", async () => {
    const deps = makeDeps();
    const imp = await aVerifiedImport(deps);
    const applied = await applyImport(deps)(principal, imp.id);
    const audit = deps.audits.find((a) => a.action === "payroll.import_applied");
    expect(audit?.after).toEqual({
      recordId: applied.record.id,
      periodStart: "2026-08-01",
      kind: "ordinary",
      componentCount: 6,
      supersededRecordId: null,
      fundDeposit: "written",
    });
    expect(JSON.stringify(deps.audits)).not.toContain("1800.00");
  });
});
