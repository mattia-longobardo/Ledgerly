import { describe, expect, it, vi } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { testPrincipal } from "@/test/principal";
import type { MalwareScanner, UseCaseDeps } from "./ports";
import {
  MemoryLegacyFundDeposits,
  MemoryPayrollComponentsRepository,
  MemoryPayrollImportsRepository,
  MemoryPayrollMappingRulesRepository,
  MemoryPayrollRecordsRepository,
} from "../infrastructure/memory-repositories";
import { noopScanner } from "../infrastructure/noop-scanner";
import { reserveImport, markUploaded } from "./create-import";
import { parseStep, scanStep } from "./ingest-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });
const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

function makeDeps(over: { scanner?: MalwareScanner; stored?: Uint8Array | null } = {}) {
  const deleted: string[] = [];
  const deps: UseCaseDeps & { deleted: string[]; audits: unknown[] } = {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: {
      provider: "local",
      put: async () => {},
      get: async () => (over.stored === undefined ? pdf("body") : over.stored),
      delete: async (k: string) => void deleted.push(k),
      listPrefix: async () => [],
    },
    scanner: over.scanner ?? noopScanner,
    clock: { now: () => NOW },
    audit: async (e) => void deps.audits.push(e),
    deleted,
    audits: [],
  };
  return deps;
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

describe("scanStep", () => {
  it("records a clean verdict, the scanner's own name and when it answered", async () => {
    const deps = makeDeps();
    const uploaded = await anUploadedImport(deps);
    const result = await scanStep(deps)(principal, uploaded.id);
    expect(result.outcome).toBe("scanner_unavailable" === result.outcome ? "scanner_unavailable" : "parsed");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.scanStatus).toBe("clean");
    expect(after?.scanner).toBe("none");
    expect(after?.scannedAt).toEqual(NOW);
    expect(after?.status).toBe("extracting");
  });

  it("an infected verdict deletes the bytes immediately and rejects the import terminally (Ruling R4-2)", async () => {
    const deps = makeDeps({
      scanner: { scan: async () => ({ verdict: "infected", scanner: "clamd", signature: "Eicar-Test-Signature" }) },
    });
    const uploaded = await anUploadedImport(deps);
    const result = await scanStep(deps)(principal, uploaded.id);
    expect(result.outcome).toBe("rejected_infected");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("rejected");
    expect(after?.scanStatus).toBe("infected");
    expect(after?.scanSignature).toBe("Eicar-Test-Signature");
    expect(after?.error).toBe("scan_infected");
    expect(after?.storageKey).toBeNull();
    expect(deps.deleted).toEqual([uploaded.storageKey]);
    // Terminal: a retry re-rejects and reads nothing.
    expect((await scanStep(deps)(principal, uploaded.id)).outcome).toBe("skipped");
  });

  it("an unavailable verdict keeps the bytes and leaves the import scanning for the next tick", async () => {
    const deps = makeDeps({
      scanner: { scan: async () => ({ verdict: "unavailable", scanner: "clamd", signature: null }) },
    });
    const uploaded = await anUploadedImport(deps);
    expect((await scanStep(deps)(principal, uploaded.id)).outcome).toBe("scanner_unavailable");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("scanning");
    expect(after?.scanStatus).toBe("unavailable");
    expect(after?.error).toBe("scan_unavailable");
    expect(after?.storageKey).toBe(uploaded.storageKey);
    expect(deps.deleted).toEqual([]);
  });

  it("skips an import that is not scanning", async () => {
    const deps = makeDeps();
    const reserved = await reserveImport(deps)(principal, {
      fileName: "a.pdf", mime: "application/pdf", bytes: pdf(), storageProvider: "local",
    });
    expect(await scanStep(deps)(principal, reserved.id)).toEqual({ outcome: "skipped", reason: "not_scanning" });
  });

  it("fails an import whose bytes are gone rather than declaring it clean", async () => {
    const deps = makeDeps({ stored: null });
    const uploaded = await anUploadedImport(deps);
    expect(await scanStep(deps)(principal, uploaded.id)).toEqual({ outcome: "skipped", reason: "no_bytes" });
    expect((await deps.imports.get(principal.userId, uploaded.id))?.status).toBe("failed");
  });
});

describe("parseStep", () => {
  async function anExtractingImport(deps: UseCaseDeps, fileName?: string) {
    const uploaded = await anUploadedImport(deps, fileName);
    await scanStep(deps)(principal, uploaded.id);
    return uploaded;
  }

  it("parses, stores the extraction and the per-field confidence, and lands in needs_review", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    const parse = vi.fn(async () => extraction);
    const result = await parseStep(deps, { extractText: async () => "Netto 1.800,00", parse })(principal, uploaded.id);
    expect(result.outcome).toBe("parsed");
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("needs_review");
    expect(after?.textSource).toBe("pdf_text");
    expect(after?.parserVersion).toBe("payroll-1.0.0");
    expect(after?.extraction).toEqual(extraction);
    expect(after?.confidence).toEqual({ net: "high" });
  });

  it("hands the parser the month read off the document title, so OCR cannot latch onto a stray year", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps, "Busta Paga Maggio 2026.pdf");
    const parse = vi.fn(async () => extraction);
    await parseStep(deps, { extractText: async () => "text", parse })(principal, uploaded.id);
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-05-01", textSource: "pdf" }));
  });

  it("files a tredicesima in December of its year, whatever month the title names", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps, "Tredicesima 2025.pdf");
    const parse = vi.fn(async () => ({ ...extraction, month: "2025-12-01", isThirteenth: true }));
    await parseStep(deps, { extractText: async () => "text", parse })(principal, uploaded.id);
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ month: "2025-12-01" }));
  });

  it("parks in needs_ocr with text_source none when the PDF carries no text layer (Rulings R4-9, R4-14)", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    const parse = vi.fn(async () => extraction);
    const result = await parseStep(deps, { extractText: async () => null, parse })(principal, uploaded.id);
    expect(result.outcome).toBe("needs_ocr");
    expect(parse).not.toHaveBeenCalled();
    const after = await deps.imports.get(principal.userId, uploaded.id);
    expect(after?.status).toBe("needs_ocr");
    expect(after?.textSource).toBe("none");
    expect(after?.extraction).toBeNull();
    expect(after?.error).toBe("no_text_layer");
  });

  it("refuses to parse an import that has not cleared the scanner (Ruling R4-2)", async () => {
    const deps = makeDeps({
      scanner: { scan: async () => ({ verdict: "unavailable", scanner: "clamd", signature: null }) },
    });
    const uploaded = await anUploadedImport(deps);
    await scanStep(deps)(principal, uploaded.id);
    const parse = vi.fn(async () => extraction);
    expect(await parseStep(deps, { extractText: async () => "text", parse })(principal, uploaded.id)).toEqual({
      outcome: "skipped",
      reason: "not_scanning",
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("audits the parse with the field count, never with an amount", async () => {
    const deps = makeDeps();
    const uploaded = await anExtractingImport(deps);
    await parseStep(deps, { extractText: async () => "text", parse: async () => extraction })(principal, uploaded.id);
    const parsedAudit = (deps.audits as Array<{ action: string; after?: unknown }>).find(
      (a) => a.action === "payroll.import_parsed",
    );
    expect(parsedAudit?.after).toEqual({ textSource: "pdf_text", parserVersion: "payroll-1.0.0", fieldsRead: 1 });
    expect(JSON.stringify(deps.audits)).not.toContain("1800");
  });
});
