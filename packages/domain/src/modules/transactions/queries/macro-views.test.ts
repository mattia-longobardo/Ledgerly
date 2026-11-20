import { describe, expect, it } from "vitest";
import type { CategoryMacroTotal } from "@domain/modules/transactions/queries";
import { type MacroCategory, macroViews } from "./macro-views";

const cat = (id: string, type: MacroCategory["type"], parentId: string | null = null): MacroCategory => ({
  id,
  name: id,
  parentId,
  type,
  archived: false,
});

const row = (
  categoryId: string | null,
  type: CategoryMacroTotal["type"],
  totalCents: bigint,
  count = 1,
): CategoryMacroTotal => ({
  categoryId,
  type,
  count,
  totalCents,
  inCents: totalCents > 0n ? totalCents : 0n,
  outCents: totalCents < 0n ? totalCents : 0n,
});

const CATEGORIES = [
  cat("home", "expense"),
  cat("rent", "expense", "home"),
  cat("bills", "expense", "home"),
  cat("food", "expense"),
  cat("work", "income"),
  cat("salary", "income", "work"),
  cat("savings", "transfer"),
];

describe("macroViews", () => {
  it("draws the three macros in order, with a group's total its own movements and its categories'", () => {
    const [income, expense, transfer] = macroViews(CATEGORIES, [
      row("rent", "expense", -80_000n),
      row("bills", "expense", -15_000n, 2),
      row("home", "expense", -5_000n),
      row("food", "expense", -42_000n, 7),
      row("salary", "income", 320_000n),
      row(null, "expense", -6_000n, 3),
    ]);
    expect([income.macro, expense.macro, transfer.macro]).toEqual(["income", "expense", "transfer"]);
    // The whole macro is every movement of its type, the uncategorised ones included.
    expect(expense.totalCents).toBe(-148_000n);
    expect(expense.count).toBe(14);
    const home = expense.groups[0];
    expect(home.category.id).toBe("home");
    expect(home.totalCents).toBe(-100_000n);
    expect(home.only?.totalCents).toBe(-5_000n);
    expect(home.children.map((child) => child.category.id)).toEqual(["rent", "bills"]);
    expect(home.share).toBe(67.5);
    expect(expense.groups[1].category.id).toBe("food");
    expect(expense.rest).toEqual({ count: 3, totalCents: -6_000n, inCents: 0n, outCents: -6_000n });
    expect(income.totalCents).toBe(320_000n);
    expect(income.groups.map((group) => group.category.id)).toEqual(["work"]);
  });

  it("keeps a group and a category with nothing in the period, at the end, at zero", () => {
    const [, expense] = macroViews(CATEGORIES, [row("food", "expense", -1_000n)]);
    expect(expense.groups.map((group) => [group.category.id, group.totalCents])).toEqual([
      ["food", -1_000n],
      ["home", 0n],
    ]);
    expect(expense.groups[1].only).toBeNull();
    expect(expense.groups[1].children).toHaveLength(2);
    expect(expense.rest).toBeNull();
  });

  it("counts a movement in the macro of its own type, and shows its category there too (§5.3)", () => {
    // A refund filed under an expense category counts as income until N3.3.
    const [income, expense] = macroViews(CATEGORIES, [
      row("rent", "income", 10_000n),
      row("rent", "expense", -80_000n),
    ]);
    expect(income.totalCents).toBe(10_000n);
    expect(income.groups.map((group) => group.category.id)).toEqual(["home", "work"]);
    expect(income.groups[0].children.map((child) => child.category.id)).toEqual(["rent"]);
    expect(expense.totalCents).toBe(-80_000n);
  });

  it("lists Transfers flat, without shares, with in and out apart and the giroconti without category", () => {
    const [, , transfer] = macroViews(CATEGORIES, [
      row("savings", "transfer", -30_000n),
      row("savings", "transfer", 5_000n),
      row("food", "transfer", -2_000n),
      row(null, "transfer", -90_000n, 2),
    ]);
    expect(transfer.groups.map((line) => line.category.id)).toEqual(["savings", "food"]);
    expect(transfer.groups[0]).toMatchObject({ totalCents: -25_000n, inCents: 5_000n, outCents: -30_000n });
    expect(transfer.groups.every((line) => line.share === 0 && line.children.length === 0)).toBe(true);
    expect(transfer.rest?.outCents).toBe(-90_000n);
    expect(transfer.outCents).toBe(-122_000n);
  });
});
