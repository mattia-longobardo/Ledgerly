import { describe, expect, it } from "vitest";
import {
  canTransition,
  cleanFileName,
  DOCUMENT_STATES,
  retentionEnd,
  sniffFormat,
  sourcesOf,
  storageKeyFor,
} from "./rules";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the document states (spec §7.8)", () => {
  it("allows the pipeline's path and Retry, and nothing out of a final state", () => {
    expect(canTransition("received", "scanning")).toBe(true);
    expect(canTransition("scanning", "extracting")).toBe(true);
    expect(canTransition("extracting", "needs_review")).toBe(true);
    expect(canTransition("extracting", "needs_ocr")).toBe(true);
    expect(canTransition("needs_review", "verified")).toBe(true);
    expect(canTransition("verified", "applied")).toBe(true);
    expect(canTransition("applied", "superseded")).toBe(true);
    expect(canTransition("failed", "extracting")).toBe(true);
    expect(canTransition("rejected", "extracting")).toBe(true);

    expect(canTransition("received", "applied")).toBe(false);
    expect(canTransition("needs_review", "applied")).toBe(false);
    expect(canTransition("applied", "rejected")).toBe(false);
    expect(canTransition("applied", "extracting")).toBe(false);
    for (const to of DOCUMENT_STATES) expect(canTransition("superseded", to)).toBe(false);
  });

  it("lists the states a move may start from", () => {
    expect(sourcesOf("applied")).toEqual(["verified"]);
    expect(sourcesOf("superseded")).toEqual(["applied"]);
  });
});

describe("sniffFormat (spec §9.3: the format from the content)", () => {
  it("recognises PDF, XLS, XLSX and the HTML table exported as .xls", () => {
    expect(sniffFormat(bytes("%PDF-1.7\n…"))).toBe("pdf");
    expect(sniffFormat(bytes("\n\n%PDF-1.4"))).toBe("pdf");
    expect(sniffFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toBe("xls");
    expect(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe("xlsx");
    expect(sniffFormat(bytes("<html><body><table>"))).toBe("xls_html");
  });

  it("refuses anything else, whatever it is called", () => {
    expect(sniffFormat(bytes("hello"))).toBeNull();
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("storageKeyFor", () => {
  it("builds the key of spec §7.8 with nothing from the file's name", () => {
    expect(storageKeyFor("payslip", "0190a1b2-0000-7000-8000-000000000001", 2026, "ab12", "pdf")).toBe(
      "payslips/0190a1b2-0000-7000-8000-000000000001/2026/ab12.pdf",
    );
    expect(storageKeyFor("cometa_operations", "u", 2026, "cd34", "xls_html")).toBe("cometa/u/2026/cd34.xls");
  });
});

describe("retentionEnd", () => {
  it("keeps an original ten years by default, 29 February becoming 28 February", () => {
    expect(retentionEnd("2026-09-19")).toBe("2036-09-19");
    expect(retentionEnd("2028-02-29")).toBe("2038-02-28");
    expect(retentionEnd("2028-02-29", 4)).toBe("2032-02-29");
  });
});

describe("cleanFileName", () => {
  it("keeps the name only, without paths, quotes or control characters", () => {
    expect(cleanFileName("C:\\Users\\me\\Busta paga.pdf")).toBe("Busta paga.pdf");
    expect(cleanFileName('../../evil"\n.pdf')).toBe("evil.pdf");
    expect(cleanFileName("   ")).toBe("document");
    expect(cleanFileName("a".repeat(300))).toHaveLength(200);
  });
});
