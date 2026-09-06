import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { addContribution } from "./add-contribution";
import { setSchedule } from "./set-schedule";
import { fundHarness, seedFund } from "./test-support";

describe("addContribution", () => {
  it("denies viewers, uses the effective schedule, locks, and audits", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    await setSchedule(h.deps)(testPrincipal(), fund.id, { frequency: "quarterly", periodAnchorMonth: 1, postingLagMonths: 1, feePerPosting: "0.00", effectiveFrom: "2026-01-01" });
    h.audits.length = 0;
    await expect(addContribution(h.deps)(testPrincipal({ roles: ["viewer"] }), fund.id, { typeCode: "employee", accrualMonth: "2026-02-01", amount: "100.00" }))
      .rejects.toThrow(PermissionDeniedError);
    const row = await addContribution(h.deps)(testPrincipal(), fund.id, { typeCode: "employee", accrualMonth: "2026-02-01", amount: "100.00" });
    expect(row).toMatchObject({ postedMonth: "2026-04-01", accrualPeriodStart: "2026-01-01", accrualPeriodEnd: "2026-03-01" });
    expect(h.audits).toEqual([expect.objectContaining({ action: "funds.contribution_added", entityId: row.id })]);
  });

  it("rejects wrong signs and invalid runtime type/month/date/money inputs", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    for (const input of [
      { typeCode: "fee", accrualMonth: "2026-01-01", amount: "1.00" },
      { typeCode: "employee", accrualMonth: "2026-13-01", amount: "1.00" },
      { typeCode: "bad", accrualMonth: "2026-01-01", amount: "1.00" },
      { typeCode: "adjustment", accrualMonth: "2026-01-01", amount: "0.00" },
      { typeCode: "employee", accrualMonth: "2026-01-01", amount: "1.001", valueDate: "2026-02-30" },
    ]) {
      await expect(addContribution(h.deps)(testPrincipal(), fund.id, input as never)).rejects.toThrow(/invalid/i);
    }
  });
});
