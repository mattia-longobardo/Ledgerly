import { describe, expect, it } from "vitest";
import { kpiBlockedBy, missingImports, transferRhythm } from "./pension-present";

describe("missingImports", () => {
  it("asks for nothing when both documents are in", () => {
    expect(missingImports({ operations: 9, snapshots: 1, documents: [] })).toEqual([]);
  });

  it("names only the export when the operations are missing", () => {
    expect(missingImports({ operations: 0, snapshots: 1, documents: [] })).toEqual([
      { kind: "cometa_operations", awaiting: false },
    ]);
  });

  it("names only the summary when the statements are missing", () => {
    expect(missingImports({ operations: 4, snapshots: 0, documents: [] })).toEqual([
      { kind: "cometa_position", awaiting: false },
    ]);
  });

  it("names both, export first, when nothing was imported", () => {
    expect(missingImports({ operations: 0, snapshots: 0, documents: [] }).map((one) => one.kind)).toEqual([
      "cometa_operations",
      "cometa_position",
    ]);
  });

  it("says a document is already on its way when one is still being read", () => {
    const missing = missingImports({
      operations: 0,
      snapshots: 0,
      documents: [
        { kind: "cometa_operations", state: "needs_review" },
        { kind: "cometa_position", state: "failed" },
      ],
    });
    expect(missing).toEqual([
      { kind: "cometa_operations", awaiting: true },
      { kind: "cometa_position", awaiting: false },
    ]);
  });

  it("does not count an applied document as still on its way", () => {
    const missing = missingImports({
      operations: 0,
      snapshots: 0,
      documents: [{ kind: "cometa_operations", state: "applied" }],
    });
    expect(missing[0]).toEqual({ kind: "cometa_operations", awaiting: false });
  });
});

describe("kpiBlockedBy", () => {
  const missing = missingImports({ operations: 0, snapshots: 0, documents: [] });

  it("ties the value to the position summary", () => {
    expect(kpiBlockedBy("value", missing)).toBe("cometa_position");
  });

  it("ties paid in to the operations export", () => {
    expect(kpiBlockedBy("paidIn", missing)).toBe("cometa_operations");
  });

  it("blocks nothing once the document it needs is in", () => {
    const onlyPosition = missingImports({ operations: 5, snapshots: 0, documents: [] });
    expect(kpiBlockedBy("paidIn", onlyPosition)).toBeNull();
    expect(kpiBlockedBy("value", onlyPosition)).toBe("cometa_position");
  });

  it("blocks nothing at all when both documents are in", () => {
    expect(kpiBlockedBy("value", [])).toBeNull();
  });
});

describe("transferRhythm", () => {
  const cometa = [
    { quarter: 1, month: 4, day: 20, nextYear: false },
    { quarter: 2, month: 7, day: 20, nextYear: false },
    { quarter: 3, month: 10, day: 20, nextYear: false },
    { quarter: 4, month: 1, day: 20, nextYear: true },
  ];

  it("reads Cometa's four deadlines as quarterly on the 20th", () => {
    expect(transferRhythm(cometa)).toEqual({ frequency: "quarterly", day: 20 });
  });

  it("gives no single day when the deadlines differ", () => {
    expect(transferRhythm([...cometa.slice(0, 3), { ...cometa[3], day: 15 }])).toEqual({
      frequency: "quarterly",
      day: null,
    });
  });

  it("reads twelve deadlines as monthly", () => {
    const monthly = Array.from({ length: 12 }, (_, index) => ({
      quarter: (index % 4) + 1,
      month: index + 1,
      day: 16,
      nextYear: false,
    }));
    expect(transferRhythm(monthly)).toEqual({ frequency: "monthly", day: 16 });
  });

  it("calls anything else custom, and an empty rule has no day", () => {
    expect(transferRhythm([])).toEqual({ frequency: "custom", day: null });
    expect(transferRhythm(cometa.slice(0, 2))).toEqual({ frequency: "custom", day: 20 });
  });
});
