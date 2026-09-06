import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { addContribution } from "./add-contribution";
import { reverseContribution } from "./reverse-contribution";
import { fundHarness, seedFund } from "./test-support";

describe("reverseContribution", () => {
  it("denies viewers, negates inflows and positive fee reversals, links, locks, and audits", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    const employee = await addContribution(h.deps)(testPrincipal(), fund.id, { typeCode: "employee", accrualMonth: "2026-01-01", amount: "100.00" });
    const fee = await addContribution(h.deps)(testPrincipal(), fund.id, { typeCode: "fee", accrualMonth: "2026-01-01", amount: "-3.00" });
    h.audits.length = 0;
    await expect(reverseContribution(h.deps)(testPrincipal({ roles: ["viewer"] }), fund.id, employee.id)).rejects.toThrow(PermissionDeniedError);
    const reversed = await reverseContribution(h.deps)(testPrincipal(), fund.id, employee.id);
    const feeReversal = await reverseContribution(h.deps)(testPrincipal(), fund.id, fee.id);
    expect(reversed).toMatchObject({ typeCode: "reversal", amount: "-100.00", reversesId: employee.id });
    expect(feeReversal.amount).toBe("3.00");
    expect(h.audits).toHaveLength(2);
    expect(h.audits[0]).toMatchObject({ action: "funds.contribution_reversed", entityId: reversed.id });
  });

  it("rejects reversing a reversal or an already reversed contribution under the lock", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    const original = await addContribution(h.deps)(testPrincipal(), fund.id, { typeCode: "employee", accrualMonth: "2026-01-01", amount: "10.00" });
    const reversal = await reverseContribution(h.deps)(testPrincipal(), fund.id, original.id);
    await expect(reverseContribution(h.deps)(testPrincipal(), fund.id, original.id)).rejects.toThrow(/already/i);
    await expect(reverseContribution(h.deps)(testPrincipal(), fund.id, reversal.id)).rejects.toThrow(/reversal/i);
  });
});
