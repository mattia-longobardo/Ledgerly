import { describe, expect, it } from "vitest";
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
import { DuplicateImportError, InvalidInputError } from "./errors";
import { markUploadFailed, markUploaded, reserveImport, validateUpload } from "./create-import";

const NOW = new Date("2026-09-05T10:00:00Z");
const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

function makeDeps(): UseCaseDeps & { audits: unknown[] } {
  const audits: unknown[] = [];
  return {
    imports: new MemoryPayrollImportsRepository(),
    records: new MemoryPayrollRecordsRepository(),
    components: new MemoryPayrollComponentsRepository(),
    mappingRules: new MemoryPayrollMappingRulesRepository(),
    funds: new MemoryLegacyFundDeposits(),
    documents: {
      provider: "local",
      put: async () => {},
      get: async () => null,
      delete: async () => {},
      listPrefix: async () => [],
    },
    scanner: noopScanner,
    clock: { now: () => NOW },
    audit: async (e) => void audits.push(e),
    audits,
  };
}

const principal = testPrincipal({ userId: "00000000-0000-7000-8000-00000000000a" });

const base = { fileName: "Busta Paga Agosto 2026.pdf", mime: "application/pdf", storageProvider: "local" as const };

describe("validateUpload", () => {
  it("accepts a PDF under the size limit", () => {
    expect(validateUpload({ fileName: "a.pdf", mime: "application/pdf", bytes: pdf() })).toEqual({ ok: true });
  });

  it("rejects an empty file", () => {
    const result = validateUpload({ fileName: "a.pdf", mime: "application/pdf", bytes: new Uint8Array() });
    expect(result).toEqual({ ok: false, message: "The file is empty." });
  });

  it("rejects a file over 10 MB (spec §7.9)", () => {
    const result = validateUpload({ fileName: "a.pdf", mime: "application/pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect(result).toEqual({ ok: false, message: "The file is larger than 10 MB." });
  });

  it("rejects a declared type that is not a PDF", () => {
    expect(validateUpload({ fileName: "a.png", mime: "image/png", bytes: pdf() })).toEqual({
      ok: false,
      message: "Only PDF payslips can be uploaded.",
    });
  });

  it("rejects bytes that are not really a PDF, whatever the client declared (spec §8.3)", () => {
    const result = validateUpload({
      fileName: "a.pdf",
      mime: "application/pdf",
      bytes: new TextEncoder().encode("<html>gotcha"),
    });
    expect(result).toEqual({ ok: false, message: "That file is not a PDF." });
  });
});

describe("reserveImport", () => {
  it("refuses a principal without payroll.upload", async () => {
    const deps = makeDeps();
    await expect(
      reserveImport(deps)(testPrincipal({ roles: ["viewer"] }), { ...base, bytes: pdf() }),
    ).rejects.toThrow(/permission/i);
  });

  it("records the sha, the size, an unguessable key and a ten-year retention", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect(created.status).toBe("received");
    expect(created.scanStatus).toBe("pending");
    expect(created.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.sizeBytes).toBe(pdf().byteLength);
    expect(created.storageKey).toMatch(new RegExp(`^payroll/${principal.userId}/2026/[0-9a-f]{32}\\.pdf$`));
    expect(created.storageKey).not.toContain(created.sha256);
    expect(created.storageKey).not.toContain(created.id);
    expect(created.retentionUntil.getUTCFullYear()).toBe(2036);
  });

  it("honours an explicit retention window from policy", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf(), retentionYears: 5 });
    expect(created.retentionUntil.getUTCFullYear()).toBe(2031);
  });

  it("rejects an invalid upload before writing anything", async () => {
    const deps = makeDeps();
    await expect(
      reserveImport(deps)(principal, { ...base, bytes: new TextEncoder().encode("<html>") }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(await deps.imports.list(principal.userId)).toEqual([]);
  });

  it("raises DuplicateImportError naming the existing import when the same bytes arrive twice", async () => {
    const deps = makeDeps();
    const first = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await expect(reserveImport(deps)(principal, { ...base, bytes: pdf() })).rejects.toMatchObject({
      name: "DuplicateImportError",
      existingImportId: first.id,
    });
  });

  it("reuses a failed import rather than dead-ending the user behind their own unique index (Ruling R4-3)", async () => {
    const deps = makeDeps();
    const first = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await markUploadFailed(deps)(principal, first.id, "store unreachable");
    const retried = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect(retried.id).toBe(first.id);
    expect(retried.status).toBe("received");
    expect(retried.error).toBeNull();
    // A fresh key, so a half-written object from the failed attempt is never read back.
    expect(retried.storageKey).not.toBe(first.storageKey);
  });

  it("audits the reservation with the sha but never with the bytes", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect(deps.audits).toEqual([
      expect.objectContaining({
        action: "payroll.import_reserved",
        entityType: "payroll_import",
        entityId: created.id,
        after: { sha256: created.sha256, sizeBytes: created.sizeBytes, fileName: base.fileName },
      }),
    ]);
    expect(JSON.stringify(deps.audits)).not.toContain("%PDF");
  });
});

describe("markUploaded", () => {
  it("moves a received import into scanning", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    expect((await markUploaded(deps)(principal, created.id)).status).toBe("scanning");
  });

  it("throws NotFoundError for another user's import", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await expect(
      markUploaded(deps)(testPrincipal({ userId: "00000000-0000-7000-8000-00000000000b" }), created.id),
    ).rejects.toThrow(/not found/i);
  });
});

describe("markUploadFailed", () => {
  it("records the reason and clears the storage key, so nothing points at bytes that may not exist", async () => {
    const deps = makeDeps();
    const created = await reserveImport(deps)(principal, { ...base, bytes: pdf() });
    await markUploadFailed(deps)(principal, created.id, "store unreachable");
    const after = await deps.imports.get(principal.userId, created.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toBe("store unreachable");
    expect(after?.storageKey).toBeNull();
  });
});
