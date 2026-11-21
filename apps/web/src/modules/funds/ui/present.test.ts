import { describe, expect, it } from "vitest";
import {
  operationGross,
  operationOrigin,
  originParts,
  voluntaryCents,
} from "@domain/modules/funds/queries/figures";
import { monthPill } from "./present";

const SOURCES = [
  { id: "s-payroll", kind: "payroll" as const },
  { id: "s-debit", kind: "bank_debit" as const },
  { id: "s-manual", kind: "manual" as const },
];

const amounts = (classification: string, worker: bigint, other = 0n) => ({
  classification,
  workerCents: worker,
  employerCents: 0n,
  tfrCents: 0n,
  otherCents: other,
});

describe("operationOrigin", () => {
  it("reads the kind of the source an operation belongs to, whoever wrote it", () => {
    expect(operationOrigin({ source: "manual", sourceId: "s-payroll" }, SOURCES)).toBe("payroll");
    expect(operationOrigin({ source: "rule", sourceId: "s-debit" }, SOURCES)).toBe("rule");
    expect(operationOrigin({ source: "manual", sourceId: "s-manual" }, SOURCES)).toBe("manual");
  });

  it("reads who wrote an operation that belongs to no source", () => {
    expect(operationOrigin({ source: "import", sourceId: null }, SOURCES)).toBe("import");
    expect(operationOrigin({ source: "rule", sourceId: null }, SOURCES)).toBe("rule");
    expect(operationOrigin({ source: "manual", sourceId: null }, SOURCES)).toBe("manual");
    expect(operationOrigin({ source: "import", sourceId: "gone" }, SOURCES)).toBe("import");
  });
});

describe("operationGross", () => {
  it("is the sum of the four amounts, and negative for an exit", () => {
    expect(operationGross({ ...amounts("contribution", 8_000n), employerCents: 6_000n })).toBe(14_000n);
    expect(operationGross(amounts("withdrawal", 0n, 500_000n))).toBe(-500_000n);
    expect(operationGross(amounts("withdrawal", 0n, -500_000n))).toBe(-500_000n);
  });
});

describe("originParts", () => {
  it("takes the voluntary payments out of the person's own part and leaves the empty parts out", () => {
    const operations = [amounts("voluntary", 25_100n), amounts("contribution", 8_000n)];
    expect(voluntaryCents(operations)).toBe(25_100n);
    expect(
      originParts({ youCents: 33_100n, employerCents: 6_000n, tfrCents: 0n, otherCents: 0n }, 25_100n),
    ).toEqual([
      { key: "you", cents: 8_000n },
      { key: "employer", cents: 6_000n },
      { key: "voluntary", cents: 25_100n },
    ]);
  });

  it("is one line for a fund paid by voluntary payments only", () => {
    expect(
      originParts({ youCents: 25_100n, employerCents: 0n, tfrCents: 0n, otherCents: 0n }, 25_100n),
    ).toEqual([{ key: "voluntary", cents: 25_100n }]);
  });
});

describe("monthPill", () => {
  const labels = {
    found: (date: string) => `found ${date}`,
    awaited: "awaited",
    missing: "missing",
    none: "none",
  };

  it("says each state of a debit's running period in words", () => {
    expect(monthPill({ kind: "found", on: "2026-10-05" }, "en", labels)).toEqual({
      text: "found 05 Oct",
      tone: "pos",
    });
    expect(monthPill({ kind: "missing", by: "2026-10-08" }, "en", labels).tone).toBe("neg");
    expect(monthPill({ kind: "awaited" }, "en", labels).text).toBe("awaited");
    expect(monthPill({ kind: "none" }, "en", labels).text).toBe("none");
  });
});
