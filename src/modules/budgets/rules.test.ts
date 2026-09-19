import { describe, expect, it } from "vitest";
import { budgetRows, budgetStatus, limitFor, percentOf, setLimitSchema } from "./rules";

describe("limitFor", () => {
  const versions = [
    { fromMonth: "2026-01-01", amountCents: 10_000n, stopped: false },
    { fromMonth: "2026-04-01", amountCents: 15_000n, stopped: false },
    { fromMonth: "2026-07-01", amountCents: null, stopped: true },
    { fromMonth: "2026-09-01", amountCents: 20_000n, stopped: false },
  ];

  it("takes the latest version on or before the month", () => {
    expect(limitFor(versions, "2026-01-01")).toBe(10_000n);
    expect(limitFor(versions, "2026-03-01")).toBe(10_000n);
    expect(limitFor(versions, "2026-04-01")).toBe(15_000n);
    expect(limitFor(versions, "2026-12-01")).toBe(20_000n);
  });

  it("has no limit before the first version or while stopped", () => {
    expect(limitFor(versions, "2025-12-01")).toBeNull();
    expect(limitFor(versions, "2026-08-01")).toBeNull();
    expect(limitFor([], "2026-08-01")).toBeNull();
  });

  it("does not depend on the order the versions come in", () => {
    expect(limitFor([...versions].reverse(), "2026-05-01")).toBe(15_000n);
  });
});

describe("budgetStatus", () => {
  it("is on track below 85 %", () => {
    expect(budgetStatus(8_499n, 10_000n)).toBe("on_track");
    expect(budgetStatus(0n, 10_000n)).toBe("on_track");
  });

  it("is near the limit from 85 % up to the limit itself", () => {
    expect(budgetStatus(8_500n, 10_000n)).toBe("near");
    expect(budgetStatus(10_000n, 10_000n)).toBe("near");
  });

  it("is over one cent past the limit", () => {
    expect(budgetStatus(10_001n, 10_000n)).toBe("over");
  });

  it("compares in integers: 85 % of an odd limit is not rounded away", () => {
    // 85 % of 333 cents is 283.05: 283 is below it, 284 above.
    expect(budgetStatus(283n, 333n)).toBe("on_track");
    expect(budgetStatus(284n, 333n)).toBe("near");
  });
});

describe("percentOf", () => {
  it("rounds half-up and goes past 100", () => {
    expect(percentOf(16_820n, 15_000n)).toBe(112);
    expect(percentOf(5n, 1_000n)).toBe(1);
    expect(percentOf(4n, 1_000n)).toBe(0);
    expect(percentOf(0n, 1_000n)).toBe(0);
  });
});

describe("budgetRows", () => {
  const categories = [
    { id: "home", parentId: null, name: "Casa", color: "#111111" },
    { id: "rent", parentId: "home", name: "Affitto", color: "#222222" },
    { id: "bills", parentId: "home", name: "Utenze", color: null },
    { id: "food", parentId: null, name: "Cibo", color: "#333333" },
    { id: "eat-out", parentId: "food", name: "Ristoranti", color: null },
    { id: "health", parentId: null, name: "Salute", color: "#444444" },
  ];
  const accounts = [
    { id: "ing", name: "ING" },
    { id: "rev", name: "Revolut" },
  ];
  const on = (categoryId: string | null, accountId: string | null, limitCents: bigint) => ({
    categoryId,
    accountId,
    limitCents,
  });
  const spent = (categoryId: string | null, accountId: string, cents: bigint) => ({
    categoryId,
    accountId,
    cents,
  });

  it("gives a group what its children spent, and a child only its own", () => {
    const { rows } = budgetRows(
      categories,
      accounts,
      [on("rent", null, 80_000n), on("home", null, 100_000n)],
      [spent("home", "ing", 1_000n), spent("rent", "ing", 75_000n), spent("bills", "rev", 9_000n)],
    );
    expect(rows.map((row) => [row.categoryId, row.spentCents, row.depth])).toEqual([
      ["home", 85_000n, 0],
      ["rent", 75_000n, 1],
    ]);
  });

  it("narrows a budget to its account, and a whole-account budget takes every category", () => {
    const { rows } = budgetRows(
      categories,
      accounts,
      [on("food", "rev", 20_000n), on(null, "ing", 50_000n)],
      [spent("eat-out", "rev", 3_000n), spent("eat-out", "ing", 4_000n), spent(null, "ing", 500n)],
    );
    expect(rows.map((row) => [row.name, row.accountName, row.spentCents])).toEqual([
      [null, "ING", 4_500n],
      ["Cibo", "Revolut", 3_000n],
    ]);
  });

  it("does not add a budget contained in another to the limit, and counts each movement once", () => {
    const { totals, unbudgetedCents } = budgetRows(
      categories,
      accounts,
      [
        on("home", null, 100_000n),
        on("rent", null, 80_000n),
        on("home", "ing", 90_000n),
        on("food", "rev", 20_000n),
      ],
      [
        spent("rent", "ing", 75_000n),
        spent("eat-out", "rev", 3_000n),
        spent("health", "rev", 2_000n),
        spent(null, "ing", 500n),
      ],
    );
    // Only "Casa, every account" and "Cibo on Revolut" are outermost.
    expect(totals).toEqual({ limitCents: 120_000n, spentCents: 78_000n });
    expect(unbudgetedCents).toBe(2_500n);
  });

  it("shows a budgeted child of an unbudgeted group at the top level, in its group's colour", () => {
    const { rows } = budgetRows(categories, accounts, [on("eat-out", null, 15_000n)], []);
    expect(rows[0]).toMatchObject({ categoryId: "eat-out", depth: 0, groupName: "Cibo", color: "#333333" });
  });

  it("has zero totals with no budget at all", () => {
    const result = budgetRows(categories, accounts, [], [spent("rent", "ing", 1n)]);
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ limitCents: 0n, spentCents: 0n });
    expect(result.unbudgetedCents).toBe(1n);
  });
});

describe("the scope schema", () => {
  it("needs a category, an account or both", () => {
    const id = "0199a0a0-0000-7000-8000-000000000001";
    expect(
      setLimitSchema.safeParse({ categoryId: null, accountId: null, month: "2026-09-01", cents: 1n }).success,
    ).toBe(false);
    expect(
      setLimitSchema.safeParse({ categoryId: id, accountId: null, month: "2026-09-01", cents: 1n }).success,
    ).toBe(true);
    expect(
      setLimitSchema.safeParse({ categoryId: null, accountId: id, month: "2026-09-01", cents: 1n }).success,
    ).toBe(true);
  });
});
