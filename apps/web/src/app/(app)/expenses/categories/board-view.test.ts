import { describe, expect, it } from "vitest";
import { boardOf } from "./board-view";

const ID = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f";
const LINE = {
  id: ID,
  name: "Groceries",
  parentId: null,
  type: "expense" as const,
  color: "#3366cc",
  chosenColor: null,
  archived: false,
  canMerge: true,
  usage: 42,
  count: 3,
  total: "-120.00",
  in: "0.00",
  out: "120.00",
  share: 62.5,
  budget: { limit: "300.00", status: "on_track" as const },
  source: { provider: "plugin:wallet", name: "Wallet", names: ["Food"] },
};
const FORMAT = {
  numberFormat: "it-IT" as const,
  carry: { preset: "month", acc: "a1" },
  range: { from: "2026-10-01", to: "2026-10-31" },
  accounts: ["a1"],
  sourceText: (source: { name: string; names: string[] }) =>
    `From ${source.name}: ${source.names.join(", ")}`,
};

describe("the board from the API", () => {
  it("formats every figure of the route and keeps the period in every link", () => {
    const [expense] = boardOf(
      {
        macros: [
          {
            macro: "expense",
            count: 4,
            total: "-127.00",
            in: "0.00",
            out: "127.00",
            groups: [{ ...LINE, only: { total: "-7.00", count: 1 }, children: [] }],
            rest: { count: 1, total: "-7.00", in: "0.00", out: "7.00" },
          },
        ],
      },
      FORMAT,
    );
    const [group] = expense.groups;
    expect(expense.total).toMatch(/^−127,00\s€$/);
    expect(expense.outTotal).toMatch(/^127,00\s€$/);
    expect(group.href).toBe(`/expenses/categories/${ID}?preset=month&acc=a1`);
    expect(group.shareText).toMatch(/^62,5\s%$/);
    expect(group.zero).toBe(false);
    expect(group.budget?.limit).toMatch(/^300,00\s€$/);
    expect(group.source).toEqual({ text: "From Wallet: Food", href: "/settings/integrations/wallet" });
    expect(group.only?.href).toBe(`/expenses?preset=month&acc=a1&cat=${ID}`);
    expect(expense.rest?.href).toBe("/expenses/review?from=2026-10-01&to=2026-10-31&acc=a1");
  });
});
