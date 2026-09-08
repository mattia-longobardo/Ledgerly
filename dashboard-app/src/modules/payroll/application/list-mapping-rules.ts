import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { MappingRuleDeps } from "./mapping-rule-deps";
import type { ManagedMappingRule } from "./ports";

/**
 * The global catalogue and the caller's own rules, in the order
 * `classifyComponent` resolves them (`priority asc, id asc`) — so the list on
 * screen reads top to bottom the way the classifier does.
 */
export function listMappingRules(deps: MappingRuleDeps) {
  return async (principal: Principal): Promise<ManagedMappingRule[]> => {
    assertPermission(principal, "payroll.review");
    return deps.mappingRules.listManaged(principal.userId);
  };
}
