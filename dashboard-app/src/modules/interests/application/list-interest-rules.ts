import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { InterestRule, UseCaseDeps } from "./ports";

export function listInterestRules(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<InterestRule[]> => {
    assertPermission(principal, "interests.read");
    return deps.rules.list(principal.userId);
  };
}
