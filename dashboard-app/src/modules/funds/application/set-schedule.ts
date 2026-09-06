import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { FundSchedule, UseCaseDeps } from "./ports";
import { moneyCents, monthSchema, nonNegativeMoneySchema, parseInput } from "./validation";

const schema = z.object({
  frequency: z.enum(["monthly", "quarterly", "annual"]),
  periodAnchorMonth: z.number().int().min(1).max(12),
  postingLagMonths: z.number().int().min(0).max(12),
  feePerPosting: nonNegativeMoneySchema,
  effectiveFrom: monthSchema,
}).strict();

export type SetScheduleInput = Omit<FundSchedule, "id" | "fundId" | "createdAt">;

export function setSchedule(deps: UseCaseDeps) {
  return async (principal: Principal, fundId: string, input: SetScheduleInput): Promise<FundSchedule> => {
    assertPermission(principal, "funds.write");
    const value = parseInput(schema, input);
    if (moneyCents(value.feePerPosting) < 0n) throw new Error("unreachable");
    const fund = await deps.funds.lock(principal.userId, fundId);
    if (!fund) throw new NotFoundError();
    const schedule = await deps.schedules.add({ fundId: fund.id, ...value });
    await deps.audit({ actorUserId: principal.userId, action: "funds.schedule_set", entityType: "fund_schedule", entityId: schedule.id, after: schedule });
    return schedule;
  };
}
