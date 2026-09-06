import { describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
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
import { rejectImport, verifyImport } from "./review-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: {
    gross: { value: 2500, confidence: "high", rules: 2500, llm: null },
    net: { value: 1800, confidence: "medium", rules: 1800, llm: 1799 },
  },
  checks: [],
};

function makeDeps(): UseCaseDeps {
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryFundContributionSink(),
    documents: { provider: "local", put: async () => {}, get: async () => null, delete: async () => {}, listPrefix: async () => [] },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async () => {},
  };
}

async function aReviewableImport(deps: UseCaseDeps) {
  const created = await deps.imports.create({
    userId: principal.userId,
    fileName: "Busta Paga Agosto 2026.pdf",
    mime: "application/pdf",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    storageProvider: "local",
    storageKey: `payroll/${principal.userId}/2026/${"0".repeat(32)}.pdf`,
    idempotencyKey: null,
    replacesImportId: null,
    retentionUntil: new Date("2036-01-01T00:00:00Z"),
    uploadedVia: "ui",
  });
  return (await deps.imports.patch(principal.userId, created.id, {
    status: "needs_review",
    scanStatus: "clean",
    scanner: "none",
    textSource: "pdf_text",
    parserVersion: "payroll-1.0.0",
    extraction,
    confidence: { gross: "high", net: "medium" },
  }))!;
}

describe("verifyImport", () => {
  it("refuses a principal without payroll.review", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(testPrincipal({ roles: ["viewer"] }), imp.id, {
        version: imp.version, month: "2026-08-01", isThirteenth: false, values: {},
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("stores the reviewer's values in the extraction and keeps what was extracted in corrections", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2026-08-01", isThirteenth: false, values: { net: "1799.50" },
    });
    expect(verified.status).toBe("verified");
    expect(verified.extraction?.fields.net).toEqual({
      value: 1799.5, confidence: "high", rules: 1800, llm: 1799, note: "confirmed by reviewer",
    });
    expect(verified.extraction?.fields.gross?.value).toBe(2500);
    expect(verified.confidence).toEqual({ gross: "high", net: "high" });
  });

  it("records a null the reviewer cleared, rather than leaving the parser's guess in place", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2026-08-01", isThirteenth: false, values: { gross: null },
    });
    expect(verified.extraction?.fields.gross?.value).toBeNull();
  });

  it("carries the reviewer's month and tredicesima flag onto the extraction", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2025-12-01", isThirteenth: true, values: {},
    });
    expect(verified.extraction?.month).toBe("2025-12-01");
    expect(verified.extraction?.isThirteenth).toBe(true);
  });

  it("answers 409 on a stale version rather than silently overwriting a concurrent edit", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(principal, imp.id, {
        version: imp.version + 1, month: "2026-08-01", isThirteenth: false, values: {},
      }),
    ).rejects.toMatchObject({ name: "VersionMismatchError" });
  });

  it("refuses to re-verify an applied import and names the replacement path (Ruling R4-6)", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2026-08-01", isThirteenth: false, values: {},
    });
    await deps.imports.patch(principal.userId, imp.id, { status: "applied" });
    const applied = (await deps.imports.get(principal.userId, imp.id))!;
    await expect(
      verifyImport(deps)(principal, imp.id, { version: applied.version, month: "2026-08-01", isThirteenth: false, values: {} }),
    ).rejects.toMatchObject({ name: "ConflictError", reason: "already_applied" });
    expect(verified.status).toBe("verified");
  });

  it("rejects a month that is not a real calendar month", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(principal, imp.id, { version: imp.version, month: "2026-13-01", isThirteenth: false, values: {} }),
    ).rejects.toMatchObject({ name: "InvalidInputError" });
  });

  it("rejects a value that is not a decimal string", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(
      verifyImport(deps)(principal, imp.id, {
        version: imp.version, month: "2026-08-01", isThirteenth: false, values: { net: "1.800,00" },
      }),
    ).rejects.toMatchObject({ name: "InvalidInputError" });
  });

  it("rejects an integer part longer than payroll_records.gross/net can hold (Finding 7)", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    // numeric(16, 2): 16 significant digits, scale 2 — 14 integer digits is
    // the most the column can ever store. A 15-digit integer part would
    // otherwise pass straight through `Number(raw)` and only fail, silently
    // losing precision, once Postgres tried to store more than the column
    // allows.
    await expect(
      verifyImport(deps)(principal, imp.id, {
        version: imp.version, month: "2026-08-01", isThirteenth: false, values: { net: "123456789012345.00" },
      }),
    ).rejects.toMatchObject({ name: "InvalidInputError" });
    // Exactly 14 integer digits is still accepted.
    const verified = await verifyImport(deps)(principal, imp.id, {
      version: imp.version, month: "2026-08-01", isThirteenth: false, values: { net: "12345678901234.00" },
    });
    expect(verified.extraction?.fields.net?.value).toBe(12345678901234);
  });

  it("refuses an import that never parsed — there is nothing to confirm", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await deps.imports.patch(principal.userId, imp.id, { status: "needs_ocr", extraction: null });
    const parked = (await deps.imports.get(principal.userId, imp.id))!;
    await expect(
      verifyImport(deps)(principal, imp.id, { version: parked.version, month: "2026-08-01", isThirteenth: false, values: {} }),
    ).rejects.toMatchObject({ name: "ConflictError", reason: "not_reviewable" });
  });
});

describe("rejectImport", () => {
  it("moves a reviewable import to rejected", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    expect((await rejectImport(deps)(principal, imp.id, imp.version)).status).toBe("rejected");
  });

  it("refuses to reject an applied import", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await deps.imports.patch(principal.userId, imp.id, { status: "applied" });
    const applied = (await deps.imports.get(principal.userId, imp.id))!;
    await expect(rejectImport(deps)(principal, imp.id, applied.version)).rejects.toMatchObject({ name: "ConflictError" });
  });

  it("answers 409 on a stale version", async () => {
    const deps = makeDeps();
    const imp = await aReviewableImport(deps);
    await expect(rejectImport(deps)(principal, imp.id, imp.version + 1)).rejects.toMatchObject({
      name: "VersionMismatchError",
    });
  });
});
