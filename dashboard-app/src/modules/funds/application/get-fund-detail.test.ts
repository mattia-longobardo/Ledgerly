import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { getFundDetail } from "./get-fund-detail";
import { fundHarness, seedFund } from "./test-support";

describe("getFundDetail", () => {
  it("returns null value without an account and carries only known valuations through the series", async () => {
    const h = fundHarness();
    const plain = await seedFund(h.deps);
    expect(await getFundDetail(h.deps)(testPrincipal(), plain.id)).toMatchObject({ value: null, valueSeries: [] });

    const linked = await seedFund(h.deps, { slug: "linked", accountId: "account-1" });
    h.monthly.set("account-1", [
      { month: "2026-02-01", balance: "120.00" },
      { month: "2026-04-01", balance: "170.00" },
    ]);
    h.latest.set("account-1", { asOf: "2026-04-30", balance: "170.00" });
    for (const [month, amount] of [["2026-01-01", "50.00"], ["2026-03-01", "25.00"]] as const) {
      await h.deps.contributions.create({
        fundId: linked.id, typeCode: "employee", accrualPeriodStart: month, accrualPeriodEnd: month,
        postedMonth: month, valueDate: null, amount, currency: "EUR", source: "manual", payrollRecordId: null,
        note: null, reversesId: null, reconciliationStatus: "received",
      });
    }
    const detail = await getFundDetail(h.deps)(testPrincipal(), linked.id);
    expect(detail.valueSeries).toEqual([
      { month: "2026-02-01", value: "120.00", deposited: "50.00" },
      { month: "2026-03-01", value: "120.00", deposited: "75.00" },
      { month: "2026-04-01", value: "170.00", deposited: "75.00" },
    ]);
  });
});
