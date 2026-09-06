import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { UseCaseDeps } from "./ports";
import { summarizeFund, type FundSummary } from "./summary";
import { parseInput } from "./validation";

export type { FundSummary } from "./summary";

const optionsSchema = z.object({ includeArchived: z.boolean().optional() }).strict().optional();

export function listFunds(deps: UseCaseDeps) {
  return async (principal: Principal, opts?: { includeArchived?: boolean }): Promise<FundSummary[]> => {
    assertPermission(principal, "funds.read");
    const funds = await deps.funds.list(principal.userId, parseInput(optionsSchema, opts));
    return Promise.all(funds.map((fund) => summarizeFund(deps, principal.userId, fund)));
  };
}
