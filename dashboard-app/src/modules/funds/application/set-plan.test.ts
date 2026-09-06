import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { setPlan } from "./set-plan";
import { fundHarness, seedFund } from "./test-support";

describe("setPlan", () => {
  it("denies viewers and records nonzero opening capital exactly once", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    const input = { effectiveFrom: "2026-01-01", initialCapital: "1000.00", fixedMonthlyAmount: "50.00", note: null };
    await expect(setPlan(h.deps)(testPrincipal({ roles: ["viewer"] }), fund.id, input)).rejects.toThrow(PermissionDeniedError);
    const first = await setPlan(h.deps)(testPrincipal(), fund.id, input);
    await setPlan(h.deps)(testPrincipal(), fund.id, { ...input, effectiveFrom: "2026-06-01", initialCapital: "2000.00" });
    const contributions = await h.deps.contributions.listForFund(fund.id);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ typeCode: "adjustment", amount: "1000.00", postedMonth: "2026-01-01", valueDate: "2026-01-01" });
    expect(h.lockCount()).toBe(2);
    expect(h.audits[0]).toMatchObject({ action: "funds.plan_set", entityId: first.id, after: expect.objectContaining({ openingContributionId: contributions[0]!.id }) });
  });

  it("validates dates and signed bounded money", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    const base = { effectiveFrom: "2026-01-01", initialCapital: "0.00", fixedMonthlyAmount: null, note: null };
    for (const patch of [{ effectiveFrom: "2026-01-02" }, { initialCapital: "-1.00" }, { fixedMonthlyAmount: "1.234" }]) {
      await expect(setPlan(h.deps)(testPrincipal(), fund.id, { ...base, ...patch })).rejects.toThrow(/invalid/i);
    }
  });
});
