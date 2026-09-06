import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { UseCaseDeps } from "./ports";
import { summarizeFund, type FundSummary } from "./summary";

export type { FundSummary } from "./summary";

export function listFunds(deps: UseCaseDeps) {
  return async (principal: Principal, opts?: { includeArchived?: boolean }): Promise<FundSummary[]> => {
    assertPermission(principal, "funds.read");
    const funds = await deps.funds.list(principal.userId, opts);
    return Promise.all(funds.map((fund) => summarizeFund(deps, principal.userId, fund)));
  };
}
