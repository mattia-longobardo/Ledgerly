import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError, NotFoundError } from "./errors";
import type { FundContribution, UseCaseDeps } from "./ports";
import { formatCents, moneyCents, parseInput } from "./validation";

const noteSchema = z.string().max(2000).nullable().optional();

export function reverseContribution(deps: UseCaseDeps) {
  return async (principal: Principal, fundId: string, contributionId: string, note?: string | null): Promise<FundContribution> => {
    assertPermission(principal, "funds.write");
    const parsedNote = parseInput(noteSchema, note);
    if (!contributionId) throw new InvalidInputError("Invalid contribution id.");
    const fund = await deps.funds.lock(principal.userId, fundId);
    if (!fund) throw new NotFoundError();
    const original = await deps.contributions.get(fund.id, contributionId);
    if (!original) throw new NotFoundError("Contribution not found");
    if (original.typeCode === "reversal") throw new InvalidInputError("A reversal cannot be reversed.");
    const existing = await deps.contributions.listForFund(fund.id);
    if (existing.some((row) => row.reversesId === original.id)) throw new InvalidInputError("This contribution is already reversed.");
    const reversal = await deps.contributions.create({
      fundId: fund.id,
      typeCode: "reversal",
      accrualPeriodStart: original.accrualPeriodStart,
      accrualPeriodEnd: original.accrualPeriodEnd,
      postedMonth: original.postedMonth,
      valueDate: original.valueDate,
      amount: formatCents(-moneyCents(original.amount)),
      currency: original.currency,
      source: "manual",
      payrollRecordId: null,
      note: parsedNote ?? null,
      reversesId: original.id,
      reconciliationStatus: "received",
    });
    await deps.audit({ actorUserId: principal.userId, action: "funds.contribution_reversed", entityType: "fund_contribution", entityId: reversal.id, before: original, after: reversal });
    return reversal;
  };
}
