import { describe, expect, it } from "vitest";
import { changedLines, withoutImports } from "../scripts/assertions-diff";
import { measureDuplication } from "../scripts/duplication";
import { canonical, differences, namesIn, project, sha256 } from "../scripts/snapshot-format";

// The measuring tools of the rewrite plan (release N0): the scripts in `scripts/` that the gates
// run. They are tested here because the unit project reads `src/` only.

describe("the numbers snapshot format", () => {
  const ID = "0b9c1c5e-5a57-4c53-9d0e-0f3b1f6b7a11";
  const view = {
    total: 12_345n,
    partial: false,
    unknown: null,
    rate: 0.25,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    note: "free text",
    nextOn: "2026-03-10",
    rows: [
      { account: { id: ID, name: "Conto" }, balance: 100n, series: [1n, null, 3n] },
      { account: { id: "other", name: "Risparmio" }, balance: null, series: [] },
    ],
    byAccount: { [ID]: 7n },
  };

  it("keeps numbers, cents, nulls, flags and civil dates; names label their rows", () => {
    expect(project(view, namesIn(view))).toEqual({
      total: "12345",
      partial: false,
      unknown: null,
      rate: 0.25,
      nextOn: "2026-03-10",
      rows: {
        Conto: { balance: "100", series: ["1", null, "3"] },
        Risparmio: { balance: null, series: [] },
      },
      byAccount: { Conto: "7" },
    });
  });

  it("keeps a list a list when two rows share a label", () => {
    const rows = [
      { name: "Spesa", cents: 1n },
      { name: "Spesa", cents: 2n },
    ];
    expect(project(rows, new Map())).toEqual([{ cents: "1" }, { cents: "2" }]);
  });

  it("writes the same bytes whatever the order of the keys", () => {
    expect(canonical({ b: 1, a: { d: null, c: "2" } })).toBe(canonical({ a: { c: "2", d: null }, b: 1 }));
    expect(sha256(canonical({ a: 1 }))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names what differs, never its value", () => {
    const before = { accounts: { Conto: { balance: "100", series: ["1", "2"] } }, total: "5" };
    const after = { accounts: { Conto: { balance: "101", series: ["1", "3"] } }, total: "5", extra: 1 };
    expect(differences(before, before)).toEqual([]);
    expect(differences(before, after)).toEqual([
      "accounts.Conto.balance",
      "accounts.Conto.series.1",
      "extra",
    ]);
  });
});

describe("the duplication measure", () => {
  const block = (name: string) => `
export function ${name}(rows: readonly number[]): number {
  let total = 0;
  for (const row of rows) {
    if (row > 10) {
      total += row * 2;
    } else if (row < 0) {
      total -= row;
    } else {
      total += 1;
    }
  }
  return total > 100 ? 100 : total;
}
`;

  it("counts two blocks that differ only in their names and literals", () => {
    const files = new Map([
      ["modules/a/rules.ts", `import { x } from "./x";\n${block("sumOfRows")}`],
      ["modules/b/rules.ts", block("totalOfEntries").replace("10", "25")],
      ["modules/c/rules.ts", "export const one = 1;\nexport const two = 2;\n"],
    ]);
    const measured = measureDuplication(files);
    expect(measured.units["modules/a"]).toMatchObject({ blocks: 1, duplicatedLines: 13 });
    expect(measured.units["modules/b"]).toMatchObject({ blocks: 1, duplicatedLines: 13 });
    expect(measured.units["modules/c"]).toMatchObject({ blocks: 0, duplicatedLines: 0, lines: 2 });
    expect(measured.total.blocks).toBe(2);
  });

  it("finds nothing in code that is written once", () => {
    const measured = measureDuplication(new Map([["modules/a/rules.ts", block("sumOfRows")]]));
    expect(measured.total).toMatchObject({ duplicatedLines: 0, percent: 0 });
  });
});

describe("the assertions diff", () => {
  const before = `import { a } from "./old";
import {
  b,
  c,
} from "@/modules/old/service";
vi.mock("@/modules/old/service", () => ({}));
const { api } = await import("./app");
it("adds", () => {
  expect(a + b).toBe(3);
});
`;

  it("sees no change when a test only moves and its imports follow", () => {
    const after = before
      .replace('"./old"', '"../new/place"')
      .replace(/@\/modules\/old\/service/g, "@ledgerly/domain")
      .replace('import("./app")', 'import("../api/app")');
    expect(changedLines(before, after)).toBe(0);
  });

  it("sees an assertion that was adapted", () => {
    expect(changedLines(before, before.replace("toBe(3)", "toBe(4)"))).toBe(2);
    expect(withoutImports(before)).toHaveLength(5);
  });
});
