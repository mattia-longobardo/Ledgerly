import { describe, expect, it } from "vitest";
import { blankLine, editingOf, inputOf, newEditing } from "./rule-lines";

const CATEGORY = "00000000-0000-4000-8000-000000000001";
const ready = (lines: ReturnType<typeof blankLine>[]) => ({
  ...newEditing(lines),
  name: " Shop ",
  categoryId: CATEGORY,
});

describe("the rule the editor holds", () => {
  it("reads every kind of condition as the contract takes it", () => {
    const text = { ...blankLine("text", "EUR"), value: " coop " };
    const amount = { ...blankLine("amount", "EUR"), op: "between", value: "1,5", to: "1.234,50" };
    const lines = [
      text,
      amount,
      blankLine("direction", "EUR"),
      blankLine("source", "EUR"),
      blankLine("currency", "USD"),
    ];
    expect(inputOf(ready([...lines, blankLine("ownAccount", "EUR")]), "it-IT")).toEqual({
      name: "Shop",
      active: true,
      conditions: [
        { field: "text", op: "contains", value: "coop" },
        { field: "amount", op: "between", amount: "1.50", toAmount: "1234.50" },
        { field: "direction", value: "out" },
        { field: "source", value: "bank" },
        { field: "currency", value: "USD" },
        { field: "ownAccount" },
      ],
      categoryId: CATEGORY,
      labelIds: [],
      note: null,
    });
  });

  it("is null while a value is missing or a range runs backwards", () => {
    expect(inputOf(ready([blankLine("text", "EUR")]), "it-IT")).toBeNull();
    expect(inputOf(ready([blankLine("account", "EUR")]), "it-IT")).toBeNull();
    const backwards = { ...blankLine("amount", "EUR"), op: "between", value: "5", to: "2" };
    expect(inputOf(ready([backwards]), "it-IT")).toBeNull();
    expect(
      inputOf({ ...ready([{ ...blankLine("text", "EUR"), value: "x" }]), categoryId: null }, "it-IT"),
    ).toBeNull();
  });

  it("opens a draft with its conditions as typed", () => {
    const draft = {
      name: "Coop",
      categoryId: null,
      conditions: [{ field: "amount" as const, op: "gt" as const, amount: "1234.5" }],
    };
    const editing = editingOf(draft, "it-IT");
    expect(editing?.lines.map(({ field, op, value }) => ({ field, op, value }))).toEqual([
      { field: "amount", op: "gt", value: "1234,50" },
    ]);
  });
});
