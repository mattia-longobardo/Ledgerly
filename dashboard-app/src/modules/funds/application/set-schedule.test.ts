import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { setSchedule } from "./set-schedule";
import { fundHarness, seedFund } from "./test-support";

describe("setSchedule", () => {
  const input = { frequency: "quarterly" as const, periodAnchorMonth: 1, postingLagMonths: 1, feePerPosting: "3.00", effectiveFrom: "2026-01-01" };

  it("denies viewers and locks before writing and auditing", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    await expect(setSchedule(h.deps)(testPrincipal({ roles: ["viewer"] }), fund.id, input)).rejects.toThrow(PermissionDeniedError);
    const row = await setSchedule(h.deps)(testPrincipal(), fund.id, input);
    expect(row.feePerPosting).toBe("3.00");
    expect(h.lockCount()).toBe(1);
    expect(h.audits).toEqual([expect.objectContaining({ action: "funds.schedule_set", entityId: row.id })]);
  });

  it("rejects invalid enums, month anchors, lags, dates, and schedule fees", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    for (const patch of [
      { frequency: "weekly" }, { periodAnchorMonth: 13 }, { postingLagMonths: -1 },
      { effectiveFrom: "2026-02-30" }, { effectiveFrom: "2026-02-02" }, { feePerPosting: "-1.00" },
    ]) {
      await expect(setSchedule(h.deps)(testPrincipal(), fund.id, { ...input, ...patch } as never)).rejects.toThrow(/invalid/i);
    }
  });
});
