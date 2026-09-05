import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import {
  MemoryInterestAccrualsRepository,
  MemoryInterestEntriesRepository,
  MemoryInterestRulesRepository,
} from "../infrastructure/memory-repositories";
import { setInterestDepsFactoryForTests, setPrincipalForTests } from "./run";
import { loadInterestRuleDetail, loadInterestRules } from "./load-interests";

function harness(balance: string | null = "1000.00") {
  return {
    rules: new MemoryInterestRulesRepository(),
    accruals: new MemoryInterestAccrualsRepository(),
    entries: new MemoryInterestEntriesRepository(),
    balances: { latestBalanceAsOf: async () => balance },
    accounts: { ownedByUser: async () => true },
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("loadInterestRules", () => {
  it("flattens a created rule into a plain row", async () => {
    const deps = harness();
    await deps.rules.create({
      userId: "00000000-0000-7000-8000-000000000001",
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      compounding: "simple_daily",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      postingMode: "analyze_only",
      providerCategoryRef: null,
      noteMarker: "auto-interest",
    });

    setInterestDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const rows = await loadInterestRules();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: "acc-1", postingMode: "analyze_only" });
    setInterestDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  // Ruling P3-C44 (B6): the UI signal for "this rule does nothing, forever"
  // starts here — the loader's flattened row must say so, or the rule
  // detail view has no data to render it from.
  it("flags a rule as inert when its compounding is not simple_daily, and as not-inert otherwise", async () => {
    const deps = harness();
    await deps.rules.create({
      userId: "00000000-0000-7000-8000-000000000001",
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      compounding: "monthly",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      postingMode: "analyze_only",
      providerCategoryRef: null,
      noteMarker: "auto-interest",
    });
    await deps.rules.create({
      userId: "00000000-0000-7000-8000-000000000001",
      accountId: "acc-2",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      compounding: "simple_daily",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      postingMode: "analyze_only",
      providerCategoryRef: null,
      noteMarker: "auto-interest",
    });

    setInterestDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const rows = await loadInterestRules();
    expect(rows.find((r) => r.accountId === "acc-1")?.inert).toBe(true);
    expect(rows.find((r) => r.accountId === "acc-2")?.inert).toBe(false);
    setInterestDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});

describe("loadInterestRuleDetail", () => {
  it("returns null for a rule that does not exist, without throwing", async () => {
    const deps = harness();
    setInterestDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const detail = await loadInterestRuleDetail("does-not-exist", {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    expect(detail).toBeNull();
    setInterestDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  it("re-throws a failure that is not NotFoundError, rather than reporting it as a 404", async () => {
    const deps = harness();
    deps.rules.get = () => {
      throw new Error("boom");
    };
    setInterestDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    await expect(
      loadInterestRuleDetail("any-id", { periodStart: "2026-09-01", periodEnd: "2026-09-30" }),
    ).rejects.toThrow("boom");
    setInterestDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  it("carries the no_data reconciliation status through untouched — it must never read as matched", async () => {
    const deps = harness();
    const rule = await deps.rules.create({
      userId: "00000000-0000-7000-8000-000000000001",
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      compounding: "simple_daily",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      postingMode: "analyze_only",
      providerCategoryRef: null,
      noteMarker: "auto-interest",
    });

    setInterestDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const detail = await loadInterestRuleDetail(rule.id, { periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(detail?.accruals).toEqual([]);
    expect(detail?.reconciliationStatus).toBe("no_data");
    setInterestDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  it("carries an empty projection through untouched for a rule that does not compound daily — never a fabricated forecast", async () => {
    const deps = harness();
    const rule = await deps.rules.create({
      userId: "00000000-0000-7000-8000-000000000001",
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      compounding: "monthly",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      postingMode: "analyze_only",
      providerCategoryRef: null,
      noteMarker: "auto-interest",
    });

    setInterestDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
    const detail = await loadInterestRuleDetail(rule.id, { periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(detail?.projection).toEqual([]);
    setInterestDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});
