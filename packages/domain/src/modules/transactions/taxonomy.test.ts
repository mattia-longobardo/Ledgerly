// The pure part of the taxonomy: the type that the movements of a category say it is. No database.
import { describe, expect, it } from "vitest";
import { typeFromMovements } from "./taxonomy";

/*
  Wallet publishes no type on a category, so everything adopted from it is born an expense — the
  owner's "Interest, dividends", with thirty-two income movements under it, among them. What is
  filed under a category is the only evidence there is (owner, 2026-09-20).
*/
describe("the type a category's movements say it is", () => {
  it("needs enough evidence, and enough agreement", () => {
    expect(typeFromMovements({ income: 2, expense: 0, transfer: 0 })).toBeNull();
    expect(typeFromMovements({ income: 3, expense: 0, transfer: 0 })).toBe("income");
    // One stray movement out of ten is noise; four out of ten is a disagreement.
    expect(typeFromMovements({ income: 9, expense: 1, transfer: 0 })).toBe("income");
    expect(typeFromMovements({ income: 6, expense: 4, transfer: 0 })).toBeNull();
    expect(typeFromMovements({ income: 0, expense: 0, transfer: 5 })).toBe("transfer");
  });
});
