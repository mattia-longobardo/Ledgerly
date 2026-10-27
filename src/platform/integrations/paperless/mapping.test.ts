import { describe, expect, it } from "vitest";
import { INITIAL_LOOKBACK_DAYS, resolveTypes, startCursor, storedName } from "./mapping";

const TYPES = [
  { id: 48, name: "Payroll" },
  { id: 70, name: "Cometa Movimenti" },
];

describe("resolveTypes", () => {
  it("maps the configured names to ids, case-insensitively", () => {
    const { byType, missing } = resolveTypes(
      { payslipType: "payroll", cometaOperationsType: "Cometa Movimenti" },
      TYPES,
    );
    expect([...byType]).toEqual([
      [48, "payslip"],
      [70, "cometa_operations"],
    ]);
    expect(missing).toEqual([]);
  });

  it("reports a name Paperless does not have, and skips a kind left empty", () => {
    const { byType, missing } = resolveTypes({ payslipType: "Payroll", cometaPositionType: "Nope" }, TYPES);
    expect([...byType.keys()]).toEqual([48]);
    expect(missing).toEqual(["Nope"]);
  });
});

describe("startCursor", () => {
  it("resumes from the stored cursor, or looks back on the first pass", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    expect(startCursor({ modified: "2026-10-11T10:00:00+02:00" }, now)).toBe("2026-10-11T10:00:00+02:00");
    const first = new Date(startCursor(null, now));
    expect((now.getTime() - first.getTime()) / 86_400_000).toBe(INITIAL_LOOKBACK_DAYS);
    expect(startCursor({ modified: "garbage" }, now)).toBe(first.toISOString());
  });
});

describe("storedName", () => {
  it("prefers the download's name, then the original's, then the id", () => {
    expect(storedName({ header: "a.pdf", original: "b.pdf", id: 1 })).toBe("a.pdf");
    expect(storedName({ header: null, original: "b.pdf", id: 1 })).toBe("b.pdf");
    expect(storedName({ header: " ", original: null, id: 9 })).toBe("paperless-9.pdf");
  });
});
