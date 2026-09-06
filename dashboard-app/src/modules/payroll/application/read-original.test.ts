import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import type { PayrollImportPatch, UseCaseDeps } from "./ports";
import { MemoryFundContributionSink } from "@/modules/funds/infrastructure/memory-contribution-sink";
import {
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { beginReadOriginal, recordOriginalRead } from "./read-original";

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });
const bytes = new TextEncoder().encode("%PDF-1.7 body");

function makeDeps(): UseCaseDeps & { audits: unknown[] } {
  const audits: unknown[] = [];
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryFundContributionSink(),
    // No I/O happens through either DB-only half this suite exercises — a
    // document store that throws if ever called is what proves the split:
    // `beginReadOriginal`/`recordOriginalRead` never touch it. The actual
    // fetch is the orchestrator's job (`infrastructure/read-original.itest.ts`).
    documents: {
      provider: "local",
      put: async () => {
        throw new Error("beginReadOriginal/recordOriginalRead must never touch the document store");
      },
      get: async () => {
        throw new Error("beginReadOriginal/recordOriginalRead must never touch the document store");
      },
      delete: async () => {
        throw new Error("beginReadOriginal/recordOriginalRead must never touch the document store");
      },
      listPrefix: async () => [],
    },
    scanner: {
      scan: async () => {
        throw new Error("beginReadOriginal/recordOriginalRead must never call the scanner");
      },
    },
    clock: { now: () => new Date("2026-09-05T10:00:00Z") },
    audit: async (e) => void audits.push(e),
    audits,
  };
}

async function anImport(deps: UseCaseDeps, patch: PayrollImportPatch = { scanStatus: "clean" }) {
  const created = await deps.imports.create({
    userId: principal.userId, fileName: "Busta Paga Agosto 2026.pdf", mime: "application/pdf",
    sizeBytes: bytes.byteLength, sha256: "a".repeat(64), storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${"0".repeat(32)}.pdf`,
    idempotencyKey: null, replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"), uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, patch))!;
}

describe("beginReadOriginal", () => {
  it("refuses a principal without payroll.read_original", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps);
    await expect(beginReadOriginal(deps)(testPrincipal({ roles: ["viewer"] }), imp.id)).rejects.toThrow(/permission/i);
  });

  it("hands back the storage key, filename, mime and digest for a clean, live original", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps);
    expect(await beginReadOriginal(deps)(principal, imp.id)).toEqual({
      storageKey: imp.storageKey,
      mime: "application/pdf",
      fileName: "Busta Paga Agosto 2026.pdf",
      sha256: "a".repeat(64),
      sizeBytes: bytes.byteLength,
    });
  });

  it("refuses an import that has not cleared the scanner, with a conflict (Ruling R4-2)", async () => {
    for (const scanStatus of ["pending", "unavailable", "infected"] as const) {
      const deps = makeDeps();
      const imp = await anImport(deps, { scanStatus });
      await expect(beginReadOriginal(deps)(principal, imp.id)).rejects.toMatchObject({
        name: "ConflictError",
        reason: "not_scanned",
      });
    }
  });

  it("refuses a purged original with a conflict naming retention, not a 404 (Ruling R4-5)", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps, { scanStatus: "clean", storageKey: null, purgedAt: new Date() });
    await expect(beginReadOriginal(deps)(principal, imp.id)).rejects.toMatchObject({
      name: "ConflictError",
      reason: "purged",
    });
  });

  it("throws NotFoundError for another user's import", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps);
    await expect(
      beginReadOriginal(deps)(testPrincipal({ userId: "00000000-0000-7000-8000-00000000000b" }), imp.id),
    ).rejects.toThrow(/not found/i);
  });

  it("throws NotFoundError for an import that does not exist", async () => {
    const deps = makeDeps();
    await expect(beginReadOriginal(deps)(principal, "does-not-exist")).rejects.toThrow(/not found/i);
  });
});

describe("recordOriginalRead", () => {
  it("audits the read with the id and the digest, never the bytes", async () => {
    const deps = makeDeps();
    const imp = await anImport(deps);
    await recordOriginalRead(deps)(principal, imp.id, { sha256: imp.sha256, sizeBytes: imp.sizeBytes });
    expect(deps.audits).toEqual([
      {
        actorUserId: principal.userId,
        action: "payroll.original_read",
        entityType: "payroll_import",
        entityId: imp.id,
        after: { sha256: imp.sha256, sizeBytes: imp.sizeBytes },
      },
    ]);
  });
});
