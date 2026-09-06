import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { FundPlan, UseCaseDeps } from "./ports";
import { moneyCents, monthSchema, nonNegativeMoneySchema, parseInput } from "./validation";

const schema = z.object({
  effectiveFrom: monthSchema,
  initialCapital: nonNegativeMoneySchema,
  fixedMonthlyAmount: nonNegativeMoneySchema.nullable(),
  note: z.string().max(2000).nullable(),
}).strict();

export type SetPlanInput = Omit<FundPlan, "id" | "fundId" | "createdAt">;

export function setPlan(deps: UseCaseDeps) {
  return async (principal: Principal, fundId: string, input: SetPlanInput): Promise<FundPlan> => {
    assertPermission(principal, "funds.write");
    const value = parseInput(schema, input);
    const fund = await deps.funds.lock(principal.userId, fundId);
    if (!fund) throw new NotFoundError();
    const existing = await deps.plans.listForFund(fund.id);
    const plan = await deps.plans.add({ fundId: fund.id, ...value });
    let openingContributionId: string | null = null;
    if (existing.length === 0 && moneyCents(value.initialCapital) !== 0n) {
      const opening = await deps.contributions.create({
        fundId: fund.id,
        typeCode: "adjustment",
        accrualPeriodStart: value.effectiveFrom,
        accrualPeriodEnd: value.effectiveFrom,
        postedMonth: value.effectiveFrom,
        valueDate: value.effectiveFrom,
        amount: value.initialCapital,
        currency: fund.currency,
        source: "manual",
        payrollRecordId: null,
        note: value.note ?? "Opening capital",
        reversesId: null,
        reconciliationStatus: "received",
      });
      openingContributionId = opening.id;
    }
    await deps.audit({
      actorUserId: principal.userId,
      action: "funds.plan_set",
      entityType: "fund_plan",
      entityId: plan.id,
      after: { plan, openingContributionId },
    });
    return plan;
  };
}
