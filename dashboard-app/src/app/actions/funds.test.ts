import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fundHarness, seedFund } from "@/modules/funds/application/test-support";
import type { Fund, UseCaseDeps } from "@/modules/funds/application/ports";
import { setFundDepsFactoryForTests, setPrincipalForTests } from "@/modules/funds/ui/deps";
import { testPrincipal } from "@/test/principal";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { addContributionAction, setPlanAction, setScheduleAction } = await import("./funds");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

let deps: UseCaseDeps;
let fund: Fund;

describe("funds server actions", () => {
  beforeEach(async () => {
    deps = fundHarness().deps;
    fund = await seedFund(deps);
    setFundDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
  });

  afterEach(() => {
    setFundDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  it("preserves exact cents at every Funds monetary action boundary", async () => {
    const contribution = await addContributionAction(form({
      fundId: fund.id,
      typeCode: "adjustment",
      accrualMonth: "2026-09",
      amount: "99999999999998.99",
    }));
    expect(contribution.ok && contribution.data.amount).toBe("99999999999998.99");

    const plan = await setPlanAction(form({
      fundId: fund.id,
      effectiveFrom: "2026-09",
      initialCapital: "90000000000000.01",
      fixedMonthlyAmount: "1.234,56",
    }));
    expect(plan.ok && plan.data).toMatchObject({
      initialCapital: "90000000000000.01",
      fixedMonthlyAmount: "1234.56",
    });

    const schedule = await setScheduleAction(form({
      fundId: fund.id,
      frequency: "monthly",
      periodAnchorMonth: "1",
      postingLagMonths: "0",
      feePerPosting: "90000000000000.01",
      effectiveFrom: "2026-09",
    }));
    expect(schedule.ok && schedule.data.feePerPosting).toBe("90000000000000.01");
  });

  it("keeps a blank optional monthly plan amount null", async () => {
    const result = await setPlanAction(form({
      fundId: fund.id,
      effectiveFrom: "2026-09",
      initialCapital: "0",
      fixedMonthlyAmount: "   ",
    }));

    expect(result.ok && result.data.fixedMonthlyAmount).toBeNull();
  });
});
