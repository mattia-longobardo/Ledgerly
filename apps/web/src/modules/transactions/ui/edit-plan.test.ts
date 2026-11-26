import { describe, expect, it } from "vitest";
import { allows, kindOf, typeSteps } from "./edit-plan";

const SPENDING = { categoryId: "cat-food", macros: ["expense"] as const, transfer: null, atSource: null };
const INCOME = { categoryId: null, macros: ["income"] as const, transfer: null, atSource: null };
const GIROCONTO_OUT = {
  categoryId: null,
  macros: [] as const,
  transfer: { state: "paired" as const, otherId: "acc-2", other: "Savings", out: true },
  atSource: null,
};

describe("the types a movement may take", () => {
  it("lets money out be a spending or a giroconto, never an income", () => {
    expect(kindOf(SPENDING)).toBe("expense");
    expect([allows(SPENDING, "expense"), allows(SPENDING, "income"), allows(SPENDING, "transfer")]).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("lets money in be an income or a giroconto, never a spending", () => {
    expect(kindOf(INCOME)).toBe("income");
    expect([allows(INCOME, "expense"), allows(INCOME, "income")]).toEqual([false, true]);
  });

  it("reads a giroconto's sign from its direction", () => {
    expect(kindOf(GIROCONTO_OUT)).toBe("transfer");
    expect([allows(GIROCONTO_OUT, "expense"), allows(GIROCONTO_OUT, "income")]).toEqual([true, false]);
  });

  it("leaves every type to a movement edited at its source, which decides the sign", () => {
    const atSource = { ...SPENDING, atSource: { type: "expense" as const, amount: "4,00" } };
    expect(allows(atSource, "income")).toBe(true);
  });
});

describe("the writes of one save", () => {
  it("writes nothing when nothing changed", () => {
    expect(typeSteps(SPENDING, { kind: "expense", categoryId: "cat-food", side: "" })).toEqual([]);
    expect(typeSteps(GIROCONTO_OUT, { kind: "transfer", categoryId: null, side: "acc-2" })).toEqual([]);
  });

  it("changes only the category of a spending", () => {
    expect(typeSteps(SPENDING, { kind: "expense", categoryId: "cat-bar", side: "" })).toEqual([
      { write: "category", categoryId: "cat-bar" },
    ]);
  });

  it("makes a spending a giroconto with an account, or with the outside", () => {
    expect(typeSteps(SPENDING, { kind: "transfer", categoryId: "cat-food", side: "acc-2" })).toEqual([
      { write: "side", side: { kind: "account", accountId: "acc-2" } },
    ]);
    expect(typeSteps(SPENDING, { kind: "transfer", categoryId: null, side: "outside" })).toEqual([
      { write: "side", side: { kind: "outside" } },
    ]);
  });

  it("makes a giroconto a spending first, then gives it its category", () => {
    expect(typeSteps(GIROCONTO_OUT, { kind: "expense", categoryId: "cat-food", side: "acc-2" })).toEqual([
      { write: "side", side: { kind: "none" } },
      { write: "category", categoryId: "cat-food" },
    ]);
  });

  it("makes a giroconto a spending with no category in one write", () => {
    expect(typeSteps(GIROCONTO_OUT, { kind: "expense", categoryId: null, side: "acc-2" })).toEqual([
      { write: "side", side: { kind: "none" } },
    ]);
  });

  it("writes nothing for a giroconto whose other account is not chosen yet", () => {
    expect(typeSteps(SPENDING, { kind: "transfer", categoryId: null, side: "" })).toEqual([]);
  });
});
