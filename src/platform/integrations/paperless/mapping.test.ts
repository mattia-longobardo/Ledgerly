import { describe, expect, it } from "vitest";
import { resolveTypes, startCursor, storedName } from "./mapping";

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
  it("resumes from the stored cursor, or starts when the link was saved", () => {
    const linkedAt = new Date("2026-10-27T00:00:00Z");
    expect(startCursor({ modified: "2026-10-11T10:00:00+02:00" }, linkedAt)).toBe(
      "2026-10-11T10:00:00+02:00",
    );
    expect(startCursor(null, linkedAt)).toBe("2026-10-27T00:00:00.000Z");
    expect(startCursor({ modified: "garbage" }, linkedAt)).toBe("2026-10-27T00:00:00.000Z");
  });
});

describe("storedName", () => {
  it("prefers the download's name, then the original's, then the id", () => {
    expect(storedName({ header: "a.pdf", original: "b.pdf", id: 1 })).toBe("a.pdf");
    expect(storedName({ header: null, original: "b.pdf", id: 1 })).toBe("b.pdf");
    expect(storedName({ header: " ", original: null, id: 9 })).toBe("paperless-9.pdf");
  });
});
