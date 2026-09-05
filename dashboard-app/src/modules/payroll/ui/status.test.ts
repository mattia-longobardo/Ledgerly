import { describe, expect, it } from "vitest";
import { statusChip } from "./status";

describe("statusChip", () => {
  it("labels every pipeline status in English, never in Italian", () => {
    const cases: Array<[string, string]> = [
      ["received", "Uploaded"],
      ["scanning", "Scanning"],
      ["needs_ocr", "Needs OCR"],
      ["extracting", "Reading"],
      ["parsed", "Parsed"],
      ["needs_review", "Needs review"],
      ["verified", "Confirmed"],
      ["applied", "Applied"],
      ["rejected", "Rejected"],
      ["superseded", "Superseded"],
      ["failed", "Failed"],
    ];
    for (const [status, label] of cases) {
      expect(statusChip(status, "clean").label).toBe(label);
    }
  });

  it("says so when the scanner has not cleared a document yet", () => {
    expect(statusChip("scanning", "unavailable")).toEqual({ label: "Scanner unavailable", tone: "warning" });
    expect(statusChip("rejected", "infected")).toEqual({ label: "Malware found", tone: "negative" });
  });

  it("tones applied positive, failures negative and waiting states warning", () => {
    expect(statusChip("applied", "clean").tone).toBe("positive");
    expect(statusChip("failed", "clean").tone).toBe("negative");
    expect(statusChip("needs_review", "clean").tone).toBe("warning");
    expect(statusChip("superseded", "clean").tone).toBe("neutral");
  });

  it("falls back to the raw status rather than rendering nothing", () => {
    expect(statusChip("something_new", "clean")).toEqual({ label: "something_new", tone: "neutral" });
  });
});
