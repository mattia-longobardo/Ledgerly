import { describe, expect, it } from "vitest";
import { MemoryInterestAccrualsRepository, MemoryInterestEntriesRepository, MemoryInterestRulesRepository } from "../infrastructure/memory-repositories";
import { recordPostedEntry, shouldPost } from "./post-interest-entry";
import type { InterestAccrual, InterestRule, UseCaseDeps } from "./ports";

const rule: InterestRule = {
  id: "r1", userId: "u1", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26",
  dayCount: 365, compounding: "simple_daily", effectiveFrom: "2026-01-01", effectiveTo: null,
  postingMode: "post_to_provider", providerCategoryRef: null, noteMarker: "auto-interest",
  version: 1, createdAt: new Date(), updatedAt: new Date(),
};

const accrual: InterestAccrual = {
  id: "a1", ruleId: "r1", accrualDate: "2026-09-05", balanceBasis: "1000.00",
  gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.000617",
  source: "computed", postedAt: null, entryId: null,
};

describe("shouldPost", () => {
  it("is true only when posting is enabled, nothing has posted yet, and the net amount is positive", () => {
    expect(shouldPost(rule, accrual)).toBe(true);
    expect(shouldPost({ ...rule, postingMode: "analyze_only" }, accrual)).toBe(false);
    expect(shouldPost(rule, { ...accrual, postedAt: new Date() })).toBe(false);
    expect(shouldPost(rule, { ...accrual, net: "0.00" })).toBe(false);
  });
});

describe("recordPostedEntry", () => {
  it("creates a paid entry and marks the accrual posted", async () => {
    const deps = {
      rules: new MemoryInterestRulesRepository(),
      accruals: new MemoryInterestAccrualsRepository(),
      entries: new MemoryInterestEntriesRepository(),
      balances: { latestBalanceAsOf: async () => null },
      clock: { now: () => new Date("2026-09-05T09:00:00Z") },
      audit: async () => {},
    };
    // `upsert` assigns its own id on insert (it does not trust `accrual.id`
    // from the caller) — recordPostedEntry must be called with the row
    // `upsert` actually stored, exactly as `tryPost` re-reads the accrual via
    // `forRule` before posting, never with a separately-constructed object.
    const stored = await deps.accruals.upsert(accrual);
    const entry = await recordPostedEntry(deps)(rule, stored, "auto-interest 2.25%/y (net 1.67%, -26% tax) on 1000.00");
    expect(entry.kind).toBe("paid");
    expect(await deps.entries.listForRule("r1", "paid")).toHaveLength(1);
  });

  it("treats markPosted affecting no row as a failure, not as a successful post (carried Task 16 requirement)", async () => {
    // A fake whose `markPosted` reports it matched nothing — the "wrong
    // owner, or simply a wrong id" case Task 16's review found silently
    // no-op'd. If this is ever mistaken for success, the accrual stays
    // unposted and the next run posts the same interest to Wallet again.
    const auditCalls: unknown[] = [];
    const deps: UseCaseDeps = {
      rules: new MemoryInterestRulesRepository(),
      accruals: {
        forRule: async () => [],
        latestCarry: async () => null,
        upsert: async (input) => ({ ...input, id: "ignored" }),
        markPosted: async () => false,
      },
      entries: new MemoryInterestEntriesRepository(),
      balances: { latestBalanceAsOf: async () => null },
      clock: { now: () => new Date("2026-09-05T09:00:00Z") },
      audit: async (e) => {
        auditCalls.push(e);
      },
    };

    await expect(recordPostedEntry(deps)(rule, accrual, "auto-interest note")).rejects.toThrow();

    // The failure must not be papered over by an "interests.posted" audit
    // event — that event means "this was successfully posted", which it was not.
    expect(auditCalls).toHaveLength(0);
  });
});
