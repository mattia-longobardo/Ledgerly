import { describe, expect, it } from "vitest";
import type { RowStatusValue } from "./connection-row";
import { bySeverity, worst } from "./source-rows";

const one = (name: string, value: RowStatusValue) => ({ row: { name, status: { value } } });

describe("the rows of a source", () => {
  it("puts what needs the person first, then orders by name (UX review, point 7)", () => {
    const rows = [
      one("Alfa", "ok"),
      one("Beta", "late"),
      one("Gamma", "action"),
      one("Delta", "running"),
      one("Epsilon", "ok"),
      one("Zeta", "action"),
      one("Eta", "manual"),
    ];
    expect(rows.sort(bySeverity("en")).map((row) => row.row.name)).toEqual([
      "Gamma",
      "Zeta",
      "Beta",
      "Delta",
      "Eta",
      "Alfa",
      "Epsilon",
    ]);
  });

  it("says the state that needs the person most", () => {
    expect(worst(["ok", "manual", "late"])).toBe("late");
    expect(worst(["ok", "manual"])).toBe("manual");
    expect(worst([])).toBe("absent");
  });
});
