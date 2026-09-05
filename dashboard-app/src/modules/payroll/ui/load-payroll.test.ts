import { afterEach, describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { UseCaseDeps } from "../application/ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { loadImports, loadReview } from "./load-payroll";
import { setPayrollDepsFactoryForTests, setPrincipalForTests } from "./run";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    net: { value: 1800, confidence: "medium", rules: 1800, llm: 1799 },
    gross: { value: null, confidence: "low", rules: null, llm: null },
  },
  checks: [{ id: "gross_minus_taxes", label: "gross − taxes = net", passed: false, detail: "no gross" }],
};

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
    funds: new MemoryLegacyFundDeposits(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async () => {},
  };
}

let sha = 0;
async function seedImport(deps: UseCaseDeps, status: "needs_review" | "scanning" | "applied" = "needs_review") {
  sha += 1;
  const created = await deps.imports.create({
    userId: principal.userId, fileName: "Busta Paga Agosto 2026.pdf", mime: "application/pdf",
    sizeBytes: 10, sha256: String(sha).padStart(64, "0"), storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${String(sha).padStart(32, "0")}.pdf`,
    idempotencyKey: null, replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, {
    status, scanStatus: "clean", scanner: "none", extraction, confidence: { net: "medium", gross: "low" },
  }))!;
}

describe("loadImports", () => {
  it("flattens each import to a serialisable row with the month off the extraction", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const imported = await seedImport(deps);
    const rows = await loadImports();
    expect(rows).toEqual([
      expect.objectContaining({ id: imported.id, status: "needs_review", month: "2026-08-01", net: "1800.00", scanStatus: "clean" }),
    ]);
  });

  it("reports a null month and net for an import that has not parsed — never a zero", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const created = await deps.imports.create({
      userId: principal.userId, fileName: "scan.pdf", mime: "application/pdf", sizeBytes: 10,
      sha256: "f".repeat(64), storageProvider: "local", storageKey: "k",
      idempotencyKey: null, replacesImportId: null,
      retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
    });
    const rows = await loadImports();
    expect(rows.find((r) => r.id === created.id)).toMatchObject({ month: null, net: null });
  });
});

describe("loadReview", () => {
  it("returns one field per parser field, with the extracted value pre-filled and both candidates", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const imported = await seedImport(deps);
    const review = await loadReview(imported.id);
    const net = review!.fields.find((f) => f.name === "net")!;
    expect(net).toMatchObject({ initial: "1800", confidence: "medium", rules: 1800, llm: 1799, unit: "eur" });
    const gross = review!.fields.find((f) => f.name === "gross")!;
    expect(gross).toMatchObject({ initial: "", confidence: "low", rules: null, llm: null });
  });

  it("carries the parser's own sanity checks through to the reviewer", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const imported = await seedImport(deps);
    expect((await loadReview(imported.id))!.checks).toEqual(extraction.checks);
  });

  it("lists the review queue, ordered, with only imports still awaiting a decision", async () => {
    const deps = makeDeps();
    useDeps(deps);
    const first = await seedImport(deps);
    await seedImport(deps, "applied");
    const review = await loadReview(first.id);
    expect(review!.pending.map((p) => p.id)).toEqual([first.id]);
  });

  it("answers null for an import that is not this user's, rather than throwing", async () => {
    const deps = makeDeps();
    useDeps(deps);
    expect(await loadReview("00000000-0000-7000-8000-0000000000ff")).toBeNull();
  });
});
