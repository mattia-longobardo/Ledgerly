import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { MappingRuleDeps } from "./mapping-rule-deps";

/**
 * Deleting a rule changes how future payslips are classified and nothing else:
 * components already recorded keep the kind and target they were given, because
 * classification is resolved at parse time and written onto the row.
 */
export function deleteMappingRule(deps: MappingRuleDeps) {
  return async (principal: Principal, id: string): Promise<void> => {
    assertPermission(principal, "payroll.review");
    const before = await deps.mappingRules.get(principal.userId, id);
    if (!before) throw new NotFoundError("Mapping rule not found");
    const removed = await deps.mappingRules.remove(principal.userId, id);
    if (!removed) throw new NotFoundError("Mapping rule not found");
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.mapping_rule_deleted",
      entityType: "payroll_mapping_rule",
      entityId: id,
      before: { matchCode: before.matchCode, matchLabel: before.matchLabel, componentKind: before.componentKind, priority: before.priority },
    });
  };
}
