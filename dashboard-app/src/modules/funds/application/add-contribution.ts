import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { accrualPeriodFor, effectiveRule, postedMonthFor } from "../domain/schedule";
import { InvalidInputError, NotFoundError } from "./errors";
import type { ContributionTypeCode, FundContribution, UseCaseDeps } from "./ports";
import { CONTRIBUTION_TYPES, dateSchema, moneyCents, moneySchema, monthSchema, parseInput } from "./validation";

const schema = z.object({
  typeCode: z.enum(CONTRIBUTION_TYPES),
  accrualMonth: monthSchema,
  amount: moneySchema,
  valueDate: dateSchema.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  postedMonth: monthSchema.optional(),
}).strict();

export interface AddContributionInput {
  typeCode: Exclude<ContributionTypeCode, "reversal">;
  accrualMonth: string;
  amount: string;
  valueDate?: string | null;
  note?: string | null;
  postedMonth?: string;
}

export function addContribution(deps: UseCaseDeps) {
  return async (principal: Principal, fundId: string, input: AddContributionInput): Promise<FundContribution> => {
    assertPermission(principal, "funds.write");
    const value = parseInput(schema, input);
    const amount = moneyCents(value.amount);
    const validSign = value.typeCode === "fee" ? amount < 0n
      : value.typeCode === "adjustment" ? amount !== 0n
        : amount > 0n;
    if (!validSign) throw new InvalidInputError("Invalid contribution amount sign.");
    const fund = await deps.funds.lock(principal.userId, fundId);
    if (!fund) throw new NotFoundError();
    const schedules = await deps.schedules.listForFund(fund.id);
    const rule = effectiveRule(schedules, value.accrualMonth);
    const period = rule ? accrualPeriodFor(value.accrualMonth, rule) : { start: value.accrualMonth, end: value.accrualMonth };
    const contribution = await deps.contributions.create({
      fundId: fund.id,
      typeCode: value.typeCode,
      accrualPeriodStart: period.start,
      accrualPeriodEnd: period.end,
      postedMonth: value.postedMonth ?? (rule ? postedMonthFor(value.accrualMonth, rule) : value.accrualMonth),
      valueDate: value.valueDate ?? null,
      amount: value.amount,
      currency: fund.currency,
      source: "manual",
      payrollRecordId: null,
      note: value.note ?? null,
      reversesId: null,
      reconciliationStatus: "received",
    });
    await deps.audit({ actorUserId: principal.userId, action: "funds.contribution_added", entityType: "fund_contribution", entityId: contribution.id, after: contribution });
    return contribution;
  };
}
