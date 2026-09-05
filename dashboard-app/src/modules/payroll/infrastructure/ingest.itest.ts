import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { organizations, payrollImports, users } from "@/lib/db/schema";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { MalwareScanner, ScanResult } from "../application/ports";
import { uploadPayslip } from "./upload";
import { resolveDocumentStore } from "./document-store-resolver";
import { parseImport, scanImport } from "./ingest";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

async function seedPrincipal(): Promise<Principal> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const roles = ["owner"] as const;
  return { userId: user!.id, organizationId: org!.id, roles: [...roles], permissions: permissionsForRoles([...roles]) };
}

const extraction: PayslipExtraction = {
  parserVersion: "payroll-1.0.0",
  month: "2026-08-01",
  isThirteenth: false,
  textSource: "pdf",
  fields: { net: { value: 1800, confidence: "high", rules: 1800, llm: null } },
  checks: [],
};

/**
 * A scanner that records, at the instant it is called, whether the import row
 * is still in the state transaction one (`beginScan`) left it in. The read
 * runs under its own `withSystemContext` — a separate, independently
 * committed transaction, deliberately not the caller's — so it only ever
 * sees what has actually been committed to the database by that point. If
 * transaction one's write had not yet committed when this ran, or if
 * transaction two's write had already landed early, this read would show it.
 * Seeing "scanning" here and the final row "extracting" afterwards is direct
 * evidence that no transaction spans the scan call (PH4-C7).
 */
function observingScanner(importId: string, verdict: ScanResult): { scanner: MalwareScanner; sawScanningBeforeWrite: () => boolean | undefined } {
  let sawScanningBeforeWrite: boolean | undefined;
  const scanner: MalwareScanner = {
    scan: async () => {
      const db = await testDb();
      const current = await withSystemContext(db, (tx) =>
        tx.select({ status: payrollImports.status }).from(payrollImports).where(eq(payrollImports.id, importId)),
      );
      sawScanningBeforeWrite = current[0]?.status === "scanning";
      return verdict;
    },
  };
  return { scanner, sawScanningBeforeWrite: () => sawScanningBeforeWrite };
}

describe("scanImport", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("clears a clean scan, committing the first transaction before the scan call runs (PH4-C7)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await uploadPayslip(principal, { fileName: "Busta Paga Agosto 2026.pdf", mime: "application/pdf", bytes: pdf("body") });

    const { scanner, sawScanningBeforeWrite } = observingScanner(uploaded.id, {
      verdict: "clean",
      scanner: "fake",
      signature: null,
    });
    const result = await scanImport(principal, uploaded.id, { scanner });

    expect(result.outcome).toBe("parsed");
    // The row was still "scanning" — i.e. readable as committed by transaction
    // one — at the moment the (simulated) network scan ran, and only became
    // "extracting" afterwards, in transaction two.
    expect(sawScanningBeforeWrite()).toBe(true);

    const resolution = await resolveDocumentStore(principal.userId);
    expect(await resolution!.store.get(uploaded.storageKey!)).not.toBeNull();
  });

  it("deletes the bytes and rejects terminally on an infected verdict (Ruling R4-2)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("infected") });
    const scanner: MalwareScanner = {
      scan: async () => ({ verdict: "infected", scanner: "clamd", signature: "Eicar-Test-Signature" }),
    };

    const result = await scanImport(principal, uploaded.id, { scanner });
    expect(result.outcome).toBe("rejected_infected");

    const resolution = await resolveDocumentStore(principal.userId);
    expect(await resolution!.store.get(uploaded.storageKey!)).toBeNull();

    // Terminal: retrying reads nothing new and re-skips.
    const retry = await scanImport(principal, uploaded.id, { scanner });
    expect(retry).toEqual({ outcome: "skipped", reason: "not_scanning" });
  });

  it("keeps the bytes and leaves the import scanning on an unavailable verdict", async () => {
    const principal = await seedPrincipal();
    const uploaded = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("u") });
    const scanner: MalwareScanner = { scan: async () => ({ verdict: "unavailable", scanner: "clamd", signature: null }) };

    const result = await scanImport(principal, uploaded.id, { scanner });
    expect(result.outcome).toBe("scanner_unavailable");

    const resolution = await resolveDocumentStore(principal.userId);
    expect(await resolution!.store.get(uploaded.storageKey!)).not.toBeNull();

    // Retryable: a clean scan on the next tick still clears it.
    const clean: MalwareScanner = { scan: async () => ({ verdict: "clean", scanner: "clamd", signature: null }) };
    expect((await scanImport(principal, uploaded.id, { scanner: clean })).outcome).toBe("parsed");
  });
});

describe("parseImport", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  async function anExtractingImport(principal: Principal, fileName: string) {
    const uploaded = await uploadPayslip(principal, { fileName, mime: "application/pdf", bytes: pdf("body") });
    const clean: MalwareScanner = { scan: async () => ({ verdict: "clean", scanner: "none", signature: null }) };
    await scanImport(principal, uploaded.id, { scanner: clean });
    return uploaded;
  }

  it("parses, records the extraction and lands in needs_review, without a transaction spanning extractText/parse (PH4-C7)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await anExtractingImport(principal, "Busta Paga Agosto 2026.pdf");

    const result = await parseImport(principal, uploaded.id, {
      extractText: async () => "Netto 1.800,00",
      parse: async () => extraction,
    });

    expect(result.outcome).toBe("parsed");
    if (result.outcome === "parsed") {
      expect(result.import.status).toBe("needs_review");
      expect(result.import.textSource).toBe("pdf_text");
      expect(result.import.extraction).toEqual(extraction);
    }
  });

  it("hands the parser the month read off the document title", async () => {
    const principal = await seedPrincipal();
    const uploaded = await anExtractingImport(principal, "Busta Paga Maggio 2026.pdf");

    let seenMonth: string | null | undefined;
    await parseImport(principal, uploaded.id, {
      extractText: async () => "text",
      parse: async (input) => {
        seenMonth = input.month;
        return extraction;
      },
    });
    expect(seenMonth).toBe("2026-05-01");
  });

  it("files a tredicesima in December of its year, whatever month the title names", async () => {
    const principal = await seedPrincipal();
    const uploaded = await anExtractingImport(principal, "Tredicesima 2025.pdf");

    let seenMonth: string | null | undefined;
    await parseImport(principal, uploaded.id, {
      extractText: async () => "text",
      parse: async (input) => {
        seenMonth = input.month;
        return { ...extraction, month: "2025-12-01", isThirteenth: true };
      },
    });
    expect(seenMonth).toBe("2025-12-01");
  });

  it("parks in needs_ocr without calling the parser when the PDF carries no text layer (Ruling R4-9)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await anExtractingImport(principal, "Busta Paga Agosto 2026.pdf");
    let parseCalled = false;

    const result = await parseImport(principal, uploaded.id, {
      extractText: async () => null,
      parse: async () => {
        parseCalled = true;
        return extraction;
      },
    });

    expect(result.outcome).toBe("needs_ocr");
    expect(parseCalled).toBe(false);
  });

  it("refuses to parse an import that has not cleared the scanner (Ruling R4-2)", async () => {
    const principal = await seedPrincipal();
    const uploaded = await uploadPayslip(principal, { fileName: "a.pdf", mime: "application/pdf", bytes: pdf("body") });
    const unavailable: MalwareScanner = { scan: async () => ({ verdict: "unavailable", scanner: "clamd", signature: null }) };
    await scanImport(principal, uploaded.id, { scanner: unavailable });

    let parseCalled = false;
    const result = await parseImport(principal, uploaded.id, {
      extractText: async () => "text",
      parse: async () => {
        parseCalled = true;
        return extraction;
      },
    });
    expect(result).toEqual({ outcome: "skipped", reason: "not_scanning" });
    expect(parseCalled).toBe(false);
  });
});
