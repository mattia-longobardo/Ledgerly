import { describe, expect, it } from "vitest";
import { scopeMatches, usageAmount } from "./scopes";
import type { ScopeLike, TransactionLike } from "./scopes";

const baseTx: TransactionLike = {
  id: "tx-1",
  accountId: "acc-1",
  categoryId: "cat-1",
  labelIds: ["label-1"],
  type: "expense",
  amount: "-12.50",
  occurredAt: "2026-02-15",
};

describe("scopeMatches", () => {
  it("matches an account scope by accountId", () => {
    const scopes: ScopeLike[] = [{ kind: "account", refId: "acc-1" }];
    expect(scopeMatches(scopes, baseTx)).toBe(true);
    expect(scopeMatches([{ kind: "account", refId: "acc-2" }], baseTx)).toBe(false);
  });

  it("matches a category scope by categoryId", () => {
    const scopes: ScopeLike[] = [{ kind: "category", refId: "cat-1" }];
    expect(scopeMatches(scopes, baseTx)).toBe(true);
    expect(scopeMatches([{ kind: "category", refId: "cat-2" }], baseTx)).toBe(false);
  });

  it("matches a label scope when labelIds contains the ref", () => {
    const scopes: ScopeLike[] = [{ kind: "label", refId: "label-1" }];
    expect(scopeMatches(scopes, baseTx)).toBe(true);
    expect(scopeMatches([{ kind: "label", refId: "label-2" }], baseTx)).toBe(false);
  });

  it("never matches a fund scope", () => {
    const scopes: ScopeLike[] = [
      { kind: "fund", refId: "acc-1" },
      { kind: "fund", refId: "cat-1" },
      { kind: "fund", refId: "label-1" },
    ];
    expect(scopeMatches(scopes, baseTx)).toBe(false);
  });

  it("returns false when no scopes are given", () => {
    expect(scopeMatches([], baseTx)).toBe(false);
  });
});

describe("usageAmount", () => {
  it("returns the absolute value for an expense", () => {
    expect(usageAmount({ ...baseTx, type: "expense", amount: "-12.50" })).toBe("12.50");
  });

  it("returns null for income", () => {
    expect(usageAmount({ ...baseTx, type: "income", amount: "12.50" })).toBeNull();
  });

  it("returns null for a transfer", () => {
    expect(usageAmount({ ...baseTx, type: "transfer", amount: "12.50" })).toBeNull();
  });
});
