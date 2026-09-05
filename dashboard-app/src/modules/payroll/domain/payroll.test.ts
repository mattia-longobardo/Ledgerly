import { describe, expect, it } from "vitest";
import type { PayrollImportStatus } from "../application/ports";
import { EDITABLE_STATUSES, canTransition, isEditable, isTerminal, textSourceColumn } from "./payroll";

describe("isTerminal", () => {
  it("is true for exactly applied, rejected and superseded — the three the retention job may purge", () => {
    const terminal: PayrollImportStatus[] = ["applied", "rejected", "superseded"];
    for (const s of terminal) expect(isTerminal(s)).toBe(true);
  });

  it("is false for every status a document is still being worked on in", () => {
    const live: PayrollImportStatus[] = [
      "received", "scanning", "needs_ocr", "extracting", "parsed", "needs_review", "verified", "failed",
    ];
    for (const s of live) expect(isTerminal(s)).toBe(false);
  });
});

describe("isEditable", () => {
  it("allows editing values while needs_review or verified (Ruling R4-6)", () => {
    expect(EDITABLE_STATUSES).toEqual(["needs_review", "verified"]);
    expect(isEditable("needs_review")).toBe(true);
    expect(isEditable("verified")).toBe(true);
  });

  it("refuses to edit an applied import — the reverse of a wrong apply is a replacement", () => {
    expect(isEditable("applied")).toBe(false);
  });
});

describe("canTransition", () => {
  it("walks the happy path", () => {
    const path: PayrollImportStatus[] = ["received", "scanning", "extracting", "parsed", "needs_review", "verified", "applied"];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("lets scanning park in needs_ocr and needs_ocr resume into extracting on a retry", () => {
    expect(canTransition("scanning", "needs_ocr")).toBe(false);
    expect(canTransition("extracting", "needs_ocr")).toBe(true);
    expect(canTransition("needs_ocr", "extracting")).toBe(true);
  });

  it("never lets an applied import go back to needs_review", () => {
    expect(canTransition("applied", "needs_review")).toBe(false);
    expect(canTransition("applied", "verified")).toBe(false);
  });

  it("only ever supersedes an applied import", () => {
    expect(canTransition("applied", "superseded")).toBe(true);
    expect(canTransition("needs_review", "superseded")).toBe(false);
  });

  it("allows rejection from any live status, and never from a terminal one", () => {
    for (const s of ["received", "scanning", "needs_ocr", "extracting", "parsed", "needs_review", "verified", "failed"] as const) {
      expect(canTransition(s, "rejected")).toBe(true);
    }
    for (const s of ["applied", "rejected", "superseded"] as const) {
      expect(canTransition(s, "rejected")).toBe(false);
    }
  });

  it("lets scanning stay scanning, so an unavailable scanner is retried rather than failed (Ruling R4-2)", () => {
    expect(canTransition("scanning", "scanning")).toBe(true);
  });

  it("lets a failed upload be reused rather than duplicated (Ruling R4-3)", () => {
    expect(canTransition("failed", "received")).toBe(true);
  });
});

describe("textSourceColumn", () => {
  it("maps the parser's two values onto the spec's column vocabulary (Ruling R4-14)", () => {
    expect(textSourceColumn("pdf")).toBe("pdf_text");
    expect(textSourceColumn("ocr")).toBe("ocr");
  });

  it("maps 'no text at all' to none — the honest encoding of needs_ocr (Ruling R4-9)", () => {
    expect(textSourceColumn(null)).toBe("none");
  });
});
