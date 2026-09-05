import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import {
  MemoryInterestAccrualsRepository,
  MemoryInterestEntriesRepository,
  MemoryInterestRulesRepository,
} from "../infrastructure/memory-repositories";
import { createInterestRule } from "./create-interest-rule";
import { listInterestRules } from "./list-interest-rules";
import { updateInterestRule } from "./update-interest-rule";
import { InvalidInputError, VersionMismatchError } from "./errors";

function harness() {
  return {
    rules: new MemoryInterestRulesRepository(),
    accruals: new MemoryInterestAccrualsRepository(),
    entries: new MemoryInterestEntriesRepository(),
    balances: { latestBalanceAsOf: async () => "1000.00" },
    accounts: { ownedByUser: async () => true },
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

describe("createInterestRule, updateInterestRule, listInterestRules", () => {
  it("creates a rule with analyze_only as the default posting mode", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });
    expect(rule.postingMode).toBe("analyze_only");
    expect(await listInterestRules(deps)(testPrincipal())).toHaveLength(1);
  });

  it("update rejects a stale version", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });
    await expect(
      updateInterestRule(deps)(testPrincipal(), rule.id, rule.version + 1, { annualRate: "0.03" }),
    ).rejects.toThrow(VersionMismatchError);
  });

  // Contract change (Task 14 review): `dailyInterest` now throws on a negative
  // `annualRate` or a `taxRate` outside [0, 1] instead of silently flooring to
  // zero and rolling a negative remainder forward forever. Rejecting bad rule
  // parameters here, before they are ever persisted, is what keeps
  // `runInterestAccrual` and `getInterestRuleDetail` from ever hitting that
  // throw on data this application wrote itself.
  it("rejects a negative annualRate", async () => {
    const deps = harness();
    await expect(
      createInterestRule(deps)(testPrincipal(), {
        accountId: "acc-1",
        annualRate: "-0.01",
        taxRate: "0.26",
        dayCount: 365,
        effectiveFrom: "2026-01-01",
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("rejects a taxRate above 1", async () => {
    const deps = harness();
    await expect(
      createInterestRule(deps)(testPrincipal(), {
        accountId: "acc-1",
        annualRate: "0.0225",
        taxRate: "1.26",
        dayCount: 365,
        effectiveFrom: "2026-01-01",
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("accepts the legitimate edges: a zero rate and a tax rate of exactly 1", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0",
      taxRate: "1",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });
    expect(rule.annualRate).toBe("0");
    expect(rule.taxRate).toBe("1");
  });

  it("update rejects a taxRate above 1 in the patch", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });
    await expect(
      updateInterestRule(deps)(testPrincipal(), rule.id, rule.version, { taxRate: "1.5" }),
    ).rejects.toThrow(InvalidInputError);
  });

  // The shape-only regex accepts calendar-impossible strings like
  // "2026-13-45" (month 13, day 45); a rule carrying one would then have an
  // effectiveFrom nothing else in the system could reason about correctly.
  it("rejects a calendar-impossible effectiveFrom", async () => {
    const deps = harness();
    await expect(
      createInterestRule(deps)(testPrincipal(), {
        accountId: "acc-1",
        annualRate: "0.0225",
        taxRate: "0.26",
        dayCount: 365,
        effectiveFrom: "2026-13-45",
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  // Ruling P3-C42 (B7): before this check, the only thing standing between
  // a rule's accountId and an account belonging to someone else entirely was
  // an incidental filter three layers away in the accrual job's own balance
  // lookup.
  it("rejects an accountId that does not belong to the acting user", async () => {
    const deps = { ...harness(), accounts: { ownedByUser: async () => false } };
    await expect(
      createInterestRule(deps)(testPrincipal(), {
        accountId: "someone-elses-account",
        annualRate: "0.0225",
        taxRate: "0.26",
        dayCount: 365,
        effectiveFrom: "2026-01-01",
      }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("update rejects a calendar-impossible effectiveTo in the patch", async () => {
    const deps = harness();
    const rule = await createInterestRule(deps)(testPrincipal(), {
      accountId: "acc-1",
      annualRate: "0.0225",
      taxRate: "0.26",
      dayCount: 365,
      effectiveFrom: "2026-01-01",
    });
    await expect(
      updateInterestRule(deps)(testPrincipal(), rule.id, rule.version, { effectiveTo: "2026-02-30" }),
    ).rejects.toThrow(InvalidInputError);
  });
});
