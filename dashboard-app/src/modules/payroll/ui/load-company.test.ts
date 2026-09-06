import { afterEach, describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "../application/ports";
import { MemoryFundContributionSink } from "@/modules/funds/infrastructure/memory-contribution-sink";
import {
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { loadCompanyOverview, loadEarnings, loadRecordDetail } from "./load-company";
import { setPayrollDepsFactoryForTests, setPrincipalForTests } from "./run";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

let shared: UseCaseDeps | null = null;

function useDeps(deps: UseCaseDeps) {
  shared = deps;
  setPayrollDepsFactoryForTests(() => shared!);
  setPrincipalForTests(principal);
}

afterEach(() => {
  setPayrollDepsFactoryForTests(null);
  setPrincipalForTests(null);
  shared = null;
});

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

let sha = 0;
async function seedApplied(deps: UseCaseDeps, periodStart: string, net = "1800.00") {
  sha += 1;
  const imported = await deps.imports.create({
    userId: principal.userId, fileName: "b.pdf", mime: "application/pdf", sizeBytes: 10,
    sha256: String(sha).padStart(64, "0"), storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null, replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
  });
  await deps.imports.patch(principal.userId, imported.id, { status: "applied", scanStatus: "clean", scanner: "none" });
  const record = await deps.records.create({
    userId: principal.userId, importId: imported.id, periodStart,
    periodEnd: `${periodStart.slice(0, 7)}-28`, payDate: null, kind: "ordinary", currency: "EUR",
    gross: "2500.00", net, verifiedAt: new Date("2026-09-05T00:00:00Z"), verifiedBy: principal.userId, corrections: null,
  });
  await deps.components.replaceForRecord(record.id, [
    { recordId: "", code: "taxes", labelRaw: "Totale trattenute", kind: "tax", amount: "700.00", quantity: null, unit: "eur", currency: "EUR", confidence: "high", source: "rules", mappedTo: { kind: "earnings" }, sortOrder: 0 },
  ]);
  return { imported, record };
}

describe("loadCompanyOverview", () => {
  it("reports an empty overview for a user with nothing, never zeros", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadCompanyOverview()).toEqual({
      latestImport: null, pendingReview: 0, year: null, months: [], salaryWindows: [],
    });
  });

  it("reports the newest import, the review backlog and this year's totals", async () => {
    const deps = makeDeps();
    useDeps(deps);
    await seedApplied(deps, "2026-07-01");
    const latest = await seedApplied(deps, "2026-08-01");
    const created = await deps.imports.create({
      userId: principal.userId, fileName: "waiting.pdf", mime: "application/pdf", sizeBytes: 10,
      sha256: "e".repeat(64), storageProvider: "local", storageKey: "k",
      idempotencyKey: null, replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
    });
    await deps.imports.patch(principal.userId, created.id, { status: "needs_review", scanStatus: "clean" });

    const overview = await loadCompanyOverview();
    expect(overview.latestImport?.id).toBe(created.id);
    expect(overview.pendingReview).toBe(1);
    expect(overview.year).toMatchObject({ key: "2026", net: "3600.00", taxes: "1400.00", recordCount: 2 });
    expect(overview.months.map((m) => m.key)).toEqual(["2026-08", "2026-07"]);
    void latest;
  });

  it("builds the three salary windows from applied records, excluding a tredicesima from the average", async () => {
    const deps = makeDeps();
    useDeps(deps);
    await seedApplied(deps, "2026-06-01", "1800.00");
    await seedApplied(deps, "2026-07-01", "1900.00");
    const overview = await loadCompanyOverview();
    expect(overview.salaryWindows.map((w) => w.key)).toEqual(["3", "6", "12"]);
    expect(overview.salaryWindows[0]!.avgNet).toBeCloseTo(1850, 2);
  });
});

describe("loadEarnings", () => {
  it("lists live records newest first with the summary alongside", async () => {
    const deps = makeDeps();
    useDeps(deps);
    await seedApplied(deps, "2026-07-01");
    await seedApplied(deps, "2026-08-01");
    const { rows, summary } = await loadEarnings();
    expect(rows.map((r) => r.periodStart)).toEqual(["2026-08-01", "2026-07-01"]);
    expect(rows[0]).toMatchObject({ gross: "2500.00", net: "1800.00", taxes: "700.00" });
    expect(summary.years[0]).toMatchObject({ key: "2026", recordCount: 2 });
  });

  it("returns nothing at all for a user with no records", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadEarnings()).toEqual({ rows: [], summary: { months: [], quarters: [], years: [] } });
  });

  it("never lists a superseded record (Ruling R4-12)", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const first = await seedApplied(deps, "2026-08-01");
    await deps.records.supersede(principal.userId, first.record.id, first.record.id, new Date());
    expect((await loadEarnings()).rows).toEqual([]);
  });
});

describe("loadRecordDetail", () => {
  it("returns the record with its components and says whether the original is still there", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const { record, imported } = await seedApplied(deps, "2026-08-01");
    const detail = await loadRecordDetail(record.id);
    expect(detail?.importId).toBe(imported.id);
    expect(detail?.components.map((c) => c.code)).toEqual(["taxes"]);
    expect(detail?.originalAvailable).toBe(true);
  });

  it("says the original is gone once retention has purged it", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const { record, imported } = await seedApplied(deps, "2026-08-01");
    await deps.imports.patch(principal.userId, imported.id, { storageKey: null, purgedAt: new Date() });
    expect((await loadRecordDetail(record.id))?.originalAvailable).toBe(false);
  });

  it("answers null for a record that is not this user's", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadRecordDetail("00000000-0000-7000-8000-0000000000ff")).toBeNull();
  });
});
