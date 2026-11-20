import { describe, expect, it } from "vitest";
import { rowViewOf } from "./rows";

const LINE = {
  categoryId: "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f",
  category: "Groceries",
  group: null,
  accountId: null,
  account: null,
  limit: "300.50",
  spent: "320.00",
  status: "over" as const,
  percent: 106,
  slug: "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f_all",
  name: null,
  color: null,
  depth: 0 as const,
  remaining: "-19.50",
};
const LABELS = { allCategories: "All categories", allAccounts: "All accounts" };

describe("a budget's row from the API", () => {
  it("formats the route's figures as the server's page did, and computes none", () => {
    const row = rowViewOf(LINE, "it-IT", LABELS);
    expect(row).toMatchObject({
      key: LINE.slug,
      href: `/budgets/${LINE.slug}`,
      scope: { categoryId: LINE.categoryId, accountId: null },
      name: "All categories",
      detail: "All accounts",
      color: "#8a8f98",
      percent: 106,
      status: "over",
    });
    expect(row.spent).toMatch(/^320,00\s€$/);
    expect(row.limit).toMatch(/^300,50\s€$/);
    expect(row.limitInput).toBe("300,50");
    expect(row.remaining).toMatch(/^−19,50\s€$/);
    expect(row.percentLabel).toMatch(/^106\s%$/);
  });

  it("drops the cents of a whole limit", () => {
    expect(rowViewOf({ ...LINE, limit: "300.00" }, "it-IT", LABELS).limit).toMatch(/^300\s€$/);
  });
});
