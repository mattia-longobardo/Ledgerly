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
import { reserveImport, markUploaded } from "./create-import";
import { applyParseConclusion, applyScanConclusion, beginParse, beginScan } from "./ingest-import";
import { rejectImport } from "./review-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });
const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

function makeDeps(): UseCaseDeps & { audits: unknown[] } {
  const audits: unknown[] = [];
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryFundContributionSink(),
    timeoff: { writeForRecord: async () => ({ written: 0, skipped: [] }) },
    // No I/O happens through the DB-only halves this suite exercises, so a
    // document store and scanner that would fail if ever called are enough
    // to prove the split: these functions never touch either.
    documents: {
      provider: "local",
      put: async () => {
        throw new Error("beginScan/applyScanConclusion must never touch the document store");
      },
      get: async () => {
        throw new Error("beginScan/applyScanConclusion must never touch the document store");
      },
      delete: async () => {
        throw new Error("beginScan/applyScanConclusion must never touch the document store");
      },
      listPrefix: async () => [],
    },
    scanner: {
      scan: async () => {
        throw new Error("beginScan/applyScanConclusion must never call the scanner directly");
      },
    },
    clock: { now: () => NOW },
    audit: async (e) => void audits.push(e),
    audits,
  };
}

async function anUploadedImport(deps: UseCaseDeps, fileName = "Busta Paga Agosto 2026.pdf") {
  const reserved = await reserveImport(deps)(principal, {
    fileName, mime: "application/pdf", bytes: pdf("body"), storageProvider: "local",
  });
  return markUploaded(deps)(principal, reserved.id);
}

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: { net: { value: 1800, confidence: "high", rules: 1800, llm: null } },
  checks: [],
};

describe("beginScan", () => {
  it("hands back the storage key for an import waiting to be scanned", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    expect(await beginScan(deps)(principal, uploaded.id)).toEqual({ ready: true, storageKey: uploaded.storageKey });
  });

  it("skips an import that is not scanning", async () => {
    const deps = makeDeps();
    const reserved = await reserveImport(deps)(principal, {
      fileName: "a.pdf", mime: "application/pdf", bytes: pdf(), storageProvider: "local",
    });
    expect(await beginScan(deps)(principal, reserved.id)).toEqual({
      ready: false,
      outcome: { outcome: "skipped", reason: "not_scanning" },
    });
  });

  it("skips an import that does not exist", async () => {
    const deps = makeDeps();
    expect(await beginScan(deps)(principal, "does-not-exist")).toEqual({
      ready: false,
      outcome: { outcome: "skipped", reason: "not_scanning" },
    });
  });
});

describe("applyScanConclusion", () => {
  it("records a clean verdict, the scanner's own name and when it answered", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    const result = await applyScanConclusion(deps)(principal, uploaded.id, { kind: "clean", scanner: "none" });
    expect(result.outcome).toBe("parsed");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.scanStatus).toBe("clean");
    expect(after?.scanner).toBe("none");
    expect(after?.scannedAt).toEqual(NOW);
    expect(after?.status).toBe("extracting");
  });

  it("an infected conclusion rejects the import terminally (Ruling R4-2)", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    const result = await applyScanConclusion(deps)(principal, uploaded.id, {
      kind: "infected",
      scanner: "clamd",
      signature: "Eicar-Test-Signature",
    });
    expect(result.outcome).toBe("rejected_infected");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("rejected");
    expect(after?.scanStatus).toBe("infected");
    expect(after?.scanSignature).toBe("Eicar-Test-Signature");
    expect(after?.error).toBe("scan_infected");
    expect(after?.storageKey).toBeNull();
    // Terminal: a retry finds `beginScan` refusing, reading nothing new.
    expect(await beginScan(deps)(principal, uploaded.id)).toEqual({
      ready: false,
      outcome: { outcome: "skipped", reason: "not_scanning" },
    });
  });

  it("an unavailable conclusion leaves the import scanning and retryable for the next tick", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    const result = await applyScanConclusion(deps)(principal, uploaded.id, { kind: "unavailable", scanner: "clamd" });
    expect(result.outcome).toBe("scanner_unavailable");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("scanning");
    expect(after?.scanStatus).toBe("unavailable");
    expect(after?.error).toBe("scan_unavailable");
    expect(after?.storageKey).toBe(uploaded.storageKey);
    // Still ready to be picked up again.
    expect(await beginScan(deps)(principal, uploaded.id)).toEqual({ ready: true, storageKey: uploaded.storageKey });
  });

  it("fails an import whose bytes were reported gone, rather than declaring it clean", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    expect(await applyScanConclusion(deps)(principal, uploaded.id, { kind: "bytes_missing" })).toEqual({
      outcome: "skipped",
      reason: "no_bytes",
    });
    expect((await deps.imports.get(principal.userId, uploaded.id))?.status).toBe("failed");
    expect((await deps.imports.get(principal.userId, uploaded.id))?.storageKey).toBeNull();
  });

  it("does not resurrect an import a reviewer rejected mid-scan (Finding 2)", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    // The reviewer rejects while the job's network scan is still in flight —
    // `rejectImport` permits rejection from any live status, "scanning"
    // included.
    const rejected = await rejectImport(deps)(principal, uploaded.id, uploaded.version);
    expect(rejected.status).toBe("rejected");
    // The scan that was already in flight finishes clean and the job now
    // tries to record that verdict against a row that has moved on.
    const result = await applyScanConclusion(deps)(principal, uploaded.id, { kind: "clean", scanner: "none" });
    expect(result).toEqual({ outcome: "skipped", reason: "not_scanning" });
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("rejected");
    expect(after?.scanStatus).not.toBe("clean");
  });
});

describe("beginParse", () => {
  async function anExtractingImport(deps: UseCaseDeps, fileName?: string) {
    const uploaded = await anUploadedImport(deps, fileName);
    await applyScanConclusion(deps)(principal, uploaded.id, { kind: "clean", scanner: "none" });
    return uploaded;
  }

  it("hands back the storage key and file name for an import ready to parse", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    expect(await beginParse(deps)(principal, uploaded.id)).toEqual({
      ready: true,
      storageKey: uploaded.storageKey,
      fileName: uploaded.fileName,
    });
  });

  it("is ready for an import parked in needs_ocr (a retry after a prior needs_ocr parking)", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    await applyParseConclusion(deps)(principal, uploaded.id, { kind: "no_text_layer" });
    expect(await beginParse(deps)(principal, uploaded.id)).toEqual({
      ready: true,
      storageKey: uploaded.storageKey,
      fileName: uploaded.fileName,
    });
  });

  it("refuses an import that has not cleared the scanner (Ruling R4-2)", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    await applyScanConclusion(deps)(principal, uploaded.id, { kind: "unavailable", scanner: "clamd" });
    expect(await beginParse(deps)(principal, uploaded.id)).toEqual({
      ready: false,
      outcome: { outcome: "skipped", reason: "not_scanning" },
    });
  });
});

describe("applyParseConclusion", () => {
  async function anExtractingImport(deps: UseCaseDeps, fileName?: string) {
    const uploaded = await anUploadedImport(deps, fileName);
    await applyScanConclusion(deps)(principal, uploaded.id, { kind: "clean", scanner: "none" });
    return uploaded;
  }

  it("stores the extraction and the per-field confidence, and lands in needs_review", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    const result = await applyParseConclusion(deps)(principal, uploaded.id, { kind: "parsed", extraction });
    expect(result.outcome).toBe("parsed");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("needs_review");
    expect(after?.textSource).toBe("pdf_text");
    expect(after?.parserVersion).toBe("payroll-1.0.0");
    expect(after?.extraction).toEqual(extraction);
    expect(after?.confidence).toEqual({ net: "high" });
  });

  it("parks in needs_ocr with text_source none when the PDF carries no text layer (Rulings R4-9, R4-14)", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    const result = await applyParseConclusion(deps)(principal, uploaded.id, { kind: "no_text_layer" });
    expect(result.outcome).toBe("needs_ocr");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("needs_ocr");
    expect(after?.textSource).toBe("none");
    expect(after?.extraction).toBeNull();
    expect(after?.error).toBe("no_text_layer");
  });

  it("fails an import whose bytes were reported gone", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    expect(await applyParseConclusion(deps)(principal, uploaded.id, { kind: "bytes_missing" })).toEqual({
      outcome: "skipped",
      reason: "no_bytes",
    });
    expect((await deps.imports.get(principal.userId, uploaded.id))?.status).toBe("failed");
  });

  it("audits the parse with the field count, never with an amount", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    await applyParseConclusion(deps)(principal, uploaded.id, { kind: "parsed", extraction });
    const parsedAudit = (deps.audits as Array<{ action: string; after?: unknown }>).find(
      (a) => a.action === "payroll.import_parsed",
    );
    expect(parsedAudit?.after).toEqual({ textSource: "pdf_text", parserVersion: "payroll-1.0.0", fieldsRead: 1 });
    expect(JSON.stringify(deps.audits)).not.toContain("1800");
  });

  it("does not resurrect an import a reviewer rejected mid-parse (Finding 2)", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    const extracting = await deps.imports.get(principal.userId, uploaded.id);
    const rejected = await rejectImport(deps)(principal, uploaded.id, extracting!.version);
    expect(rejected.status).toBe("rejected");
    const result = await applyParseConclusion(deps)(principal, uploaded.id, { kind: "parsed", extraction });
    expect(result).toEqual({ outcome: "skipped", reason: "not_scanning" });
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("rejected");
    expect(after?.extraction).toBeNull();
  });

  it("audits the rejection with the scanner and signature, never with the payslip bytes", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    await applyScanConclusion(deps)(principal, uploaded.id, {
      kind: "infected",
      scanner: "clamd",
      signature: "Eicar-Test-Signature",
    });
    const rejectedAudit = (deps.audits as Array<{ action: string; after?: unknown }>).find(
      (a) => a.action === "payroll.import_rejected",
    );
    expect(rejectedAudit?.after).toEqual({
      reason: "scan_infected",
      scanner: "clamd",
      signature: "Eicar-Test-Signature",
    });
  });
});
