import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import {
  MemoryInterestAccrualsRepository,
  MemoryInterestEntriesRepository,
  MemoryInterestRulesRepository,
} from "../infrastructure/memory-repositories";
import { createInterestRule } from "./create-interest-rule";
import { getInterestRuleDetail } from "./get-interest-rule-detail";

function harness(balance: string | null = "1000.00") {
  return {
    rules: new MemoryInterestRulesRepository(),
    accruals: new MemoryInterestAccrualsRepository(),
    entries: new MemoryInterestEntriesRepository(),
    balances: { latestBalanceAsOf: async () => balance },
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("getInterestRuleDetail", () => {
  it("combines the rule, its accruals, its entries, a reconciliation and a projection", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });
    await deps.accruals.upsert({
      ruleId: rule.id,
      accrualDate: "2026-09-01",
      balanceBasis: "1000.00",
      gross: "0.061644",
      tax: "0.016027",
      net: "0.05",
      carryAfter: "-0.004617",
      source: "computed",
      postedAt: null,
      entryId: null,
    });

    const detail = await getInterestRuleDetail(deps)(testPrincipal(), rule.id, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      projectionDays: 3,
    });
    expect(detail.accruals).toHaveLength(1);
    expect(detail.reconciliation.status).toBe("missing");
    expect(detail.projection).toHaveLength(3);
  });

  // Contract change (Task 14 review): a period with zero accrual rows reports
  // `no_data`, never `matched` — "the accrual job never ran" and "nothing was
  // owed" are different facts, and `matched` was an affirmative claim made
  // from zero evidence.
  it("reports no_data, not matched, when no accrual rows exist for the period yet", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });

    const detail = await getInterestRuleDetail(deps)(testPrincipal(), rule.id, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    expect(detail.accruals).toHaveLength(0);
    expect(detail.reconciliation.status).toBe("no_data");
  });

  // The accrual repository's `forRule` already scopes to the period, but
  // `entries.listForRule` (Task 15's port) has no date-range parameter at
  // all. Without scoping it here, a paid entry from an entirely different
  // period would leak into this period's reconciliation and could make it
  // look "matched" (or falsely "anomalous") for the wrong reason.
  it("does not let a paid entry from outside the requested period distort this period's reconciliation", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });
    await deps.accruals.upsert({
      ruleId: rule.id,
      accrualDate: "2026-09-01",
      balanceBasis: "1000.00",
      gross: "0.061644",
      tax: "0.016027",
      net: "0.05",
      carryAfter: "-0.004617",
      source: "computed",
      postedAt: null,
      entryId: null,
    });
    // Paid in August — outside the September period being requested.
    await deps.entries.create({
      userId: testPrincipal().userId,
      accountId: "acc-1",
      occurredAt: new Date("2026-08-15T00:00:00Z"),
      gross: "0.10",
      net: "0.07",
      kind: "paid",
      transactionId: null,
      ruleId: rule.id,
      source: "provider",
    });

    const detail = await getInterestRuleDetail(deps)(testPrincipal(), rule.id, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    expect(detail.entries).toHaveLength(0);
    expect(detail.reconciliation.status).toBe("missing");
  });

  it("produces an empty (never fabricated) projection when no balance is on file", async () => {
    const deps = harness(null);
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });

    const detail = await getInterestRuleDetail(deps)(testPrincipal(), rule.id, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    expect(detail.projection).toEqual([]);
  });

  // `runInterestAccrual` only ever computes for `simple_daily` compounding —
  // a `monthly` (or `none`) rule gets no accrual there, ever. The projection
  // must honor the same gate: otherwise a rule the accrual job will never
  // post for gets a confident multi-day forecast computed with the
  // simple-daily formula anyway, which is a wrong number, not an absent one.
  it("produces no projection for a rule whose compounding is not simple_daily", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      compounding: "monthly",
      effectiveFrom: "2026-01-01",
    });

    const detail = await getInterestRuleDetail(deps)(testPrincipal(), rule.id, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      projectionDays: 3,
    });
    expect(detail.projection).toEqual([]);
  });
});
