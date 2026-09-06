import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "./ports";
import { MemoryFundContributionSink } from "@/modules/funds/infrastructure/memory-contribution-sink";
import {
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { getImport, listImports } from "./list-imports";
import { earningsSummary, getRecord, listRecords } from "./list-records";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

function makeDeps(): UseCaseDeps {
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryFundContributionSink(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async () => {},
  };
}

async function seedRecord(deps: UseCaseDeps, periodStart: string, importId: string) {
  return deps.records.create({
    userId: principal.userId,
    importId,
    periodStart,
    periodEnd: `${periodStart.slice(0, 7)}-28`,
    payDate: null,
    kind: "ordinary",
    currency: "EUR",
    gross: "2500.00",
    net: "1800.00",
    verifiedAt: null,
    verifiedBy: null,
    corrections: null,
  });
}

describe("listImports and getImport", () => {
  it("refuse a principal without payroll.read", async () => {
    const deps = makeDeps();
    const stranger = testPrincipal({ roles: [] });
    await expect(listImports(deps)(stranger)).rejects.toThrow(/permission/i);
  });

  it("getImport throws NotFoundError for another user's import", async () => {
    const deps = makeDeps();
    const created = await deps.imports.create({
      userId: "someone-else", fileName: "a.pdf", mime: "application/pdf", sizeBytes: 1, sha256: "a".repeat(64),
      storageProvider: "local", storageKey: "k", idempotencyKey: null, replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
    });
    await expect(getImport(deps)(principal, created.id)).rejects.toThrow(/not found/i);
  });
});

describe("listRecords and getRecord", () => {
  it("lists newest period first and never a superseded record", async () => {
    const deps = makeDeps();
    const july = await seedRecord(deps, "2026-07-01", "imp-1");
    const august = await seedRecord(deps, "2026-08-01", "imp-2");
    await deps.records.supersede(principal.userId, july.id, august.id, new Date());
    expect((await listRecords(deps)(principal)).map((r) => r.periodStart)).toEqual(["2026-08-01"]);
  });

  it("getRecord returns the record with its components in sort order", async () => {
    const deps = makeDeps();
    const record = await seedRecord(deps, "2026-08-01", "imp-1");
    await deps.components.replaceForRecord(record.id, [
      { recordId: "", code: "taxes", labelRaw: "Totale trattenute", kind: "tax", amount: "700.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 1 },
      { recordId: "", code: "net", labelRaw: "Netto del mese", kind: "earning", amount: "1800.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 0 },
    ]);
    const detail = await getRecord(deps)(principal, record.id);
    expect(detail.components.map((c) => c.code)).toEqual(["net", "taxes"]);
  });

  it("getRecord throws NotFoundError for another user's record", async () => {
    const deps = makeDeps();
    const record = await seedRecord(deps, "2026-08-01", "imp-1");
    await expect(
      getRecord(deps)(testPrincipal({ userId: "00000000-0000-7000-8000-00000000000b" }), record.id),
    ).rejects.toThrow(/not found/i);
  });
});

describe("earningsSummary", () => {
  it("summarises live records only, and returns empty lists when there are none", async () => {
    const deps = makeDeps();
    expect(await earningsSummary(deps)(principal)).toEqual({ months: [], quarters: [], years: [] });
    const record = await seedRecord(deps, "2026-08-01", "imp-1");
    await deps.components.replaceForRecord(record.id, [
      { recordId: "", code: "taxes", labelRaw: "Totale trattenute", kind: "tax", amount: "700.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 0 },
    ]);
    const summary = await earningsSummary(deps)(principal);
    expect(summary.months).toEqual([
      {
        key: "2026-08",
        gross: "2500.00",
        net: "1800.00",
        taxes: "700.00",
        contributions: null,
        recordCount: 1,
        // No contribution component on this record, so contributions is a
        // caveat-flagged null rather than a confirmed zero (Finding 4).
        partial: { gross: false, net: false, taxes: false, contributions: true },
      },
    ]);
  });

  it("refuses a principal without payroll.read", async () => {
    await expect(earningsSummary(makeDeps())(testPrincipal({ roles: [] }))).rejects.toThrow(/permission/i);
  });
});
