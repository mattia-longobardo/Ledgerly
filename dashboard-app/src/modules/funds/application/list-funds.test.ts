import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { listFunds } from "./list-funds";
import { InvalidInputError } from "./errors";
import { fundHarness, seedFund } from "./test-support";

describe("listFunds", () => {
  it("summarizes known values and leaves an unlinked value missing", async () => {
    const h = fundHarness();
    const unlinked = await seedFund(h.deps);
    const linked = await seedFund(h.deps, { slug: "invest", name: "Invest", accountId: "account-1" });
    h.latest.set("account-1", { asOf: "2026-08-31", balance: "125.00" });
    await h.deps.contributions.create({
      fundId: linked.id, typeCode: "employee", accrualPeriodStart: "2026-08-01", accrualPeriodEnd: "2026-08-01",
      postedMonth: "2026-08-01", valueDate: null, amount: "100.00", currency: "EUR", source: "manual",
      payrollRecordId: null, note: null, reversesId: null, reconciliationStatus: "received",
    });

    const result = await listFunds(h.deps)(testPrincipal());
    expect(result.find((row) => row.fund.id === unlinked.id)).toMatchObject({ value: null, valueAsOf: null, absReturn: null });
    expect(result.find((row) => row.fund.id === linked.id)).toMatchObject({ value: "125.00", deposited: "100.00", absReturn: "25.00" });
  });

  it("rejects a non-boolean includeArchived option at runtime", async () => {
    const h = fundHarness();
    await expect(listFunds(h.deps)(testPrincipal(), { includeArchived: "false" } as never))
      .rejects.toThrow(InvalidInputError);
  });
});
