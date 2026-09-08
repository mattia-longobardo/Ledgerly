import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError, VersionMismatchError } from "./errors";
import type { MappingRuleDeps } from "./mapping-rule-deps";
import type { ManagedMappingRule, MappingRulePatch, MappingTarget, PayrollComponentKind } from "./ports";
import { assertMatchable } from "./validate-mapping-rule";

export interface UpdateMappingRuleInput {
  matchCode?: string | null;
  matchLabel?: string | null;
  componentKind?: PayrollComponentKind;
  target?: MappingTarget;
  priority?: number;
}

/**
 * User rules only. A global rule has no database row (`DEFAULT_MAPPING_RULES`
 * lives in code) and its id is not even a uuid, so `get` returns null and this
 * is a 404 — the way to override a global is to add a user rule at a lower
 * priority, not to edit the catalogue.
 */
export function updateMappingRule(deps: MappingRuleDeps) {
  return async (
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: UpdateMappingRuleInput,
  ): Promise<ManagedMappingRule> => {
    assertPermission(principal, "payroll.review");
    const before = await deps.mappingRules.get(principal.userId, id);
    if (!before) throw new NotFoundError("Mapping rule not found");

    const patch: MappingRulePatch = {};
    if (input.matchCode !== undefined) patch.matchCode = input.matchCode;
    if (input.matchLabel !== undefined) patch.matchLabel = input.matchLabel;
    if (input.componentKind !== undefined) patch.componentKind = input.componentKind;
    if (input.target !== undefined) patch.target = input.target;
    if (input.priority !== undefined) patch.priority = input.priority;
    // Validated against the row as it will be, not against the patch alone: a
    // patch that only clears `matchCode` still has to leave one matcher behind,
    // and the table's own CHECK would otherwise be the thing that says so.
    assertMatchable({
      matchCode: patch.matchCode !== undefined ? patch.matchCode : before.matchCode,
      matchLabel: patch.matchLabel !== undefined ? patch.matchLabel : before.matchLabel,
    });

    const updated = await deps.mappingRules.update(principal.userId, id, expectedVersion, patch);
    if (updated === null) throw new NotFoundError("Mapping rule not found");
    if (updated === "version_mismatch") {
      throw new VersionMismatchError("This mapping rule changed since you opened it. Reload and try again.");
    }
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.mapping_rule_updated",
      entityType: "payroll_mapping_rule",
      entityId: id,
      before: { matchCode: before.matchCode, matchLabel: before.matchLabel, componentKind: before.componentKind, priority: before.priority },
      after: { matchCode: updated.matchCode, matchLabel: updated.matchLabel, componentKind: updated.componentKind, priority: updated.priority },
    });
    return updated;
  };
}
