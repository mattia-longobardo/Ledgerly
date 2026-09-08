import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { MappingRuleDeps } from "./mapping-rule-deps";
import type { ManagedMappingRule, MappingTarget, PayrollComponentKind } from "./ports";
import { assertMatchable } from "./validate-mapping-rule";

export interface CreateMappingRuleInput {
  matchCode?: string | null;
  matchLabel?: string | null;
  componentKind: PayrollComponentKind;
  target: MappingTarget;
  priority?: number;
}

/**
 * The seeded catalogue all sits at priority 100, and `classifyComponent` takes
 * the FIRST match in `priority asc` order — so a user rule left at 100 would
 * tie with the globals and be resolved by id, which is arbitrary. Defaulting to
 * `100 + n` (n = how many rules the user already has) puts each new rule after
 * the globals and after the user's earlier ones, which is the order somebody
 * adding rules one at a time expects. An explicit `priority` overrides it —
 * including below 100, which is how a user rule deliberately shadows a global.
 */
export function createMappingRule(deps: MappingRuleDeps) {
  return async (principal: Principal, input: CreateMappingRuleInput): Promise<ManagedMappingRule> => {
    assertPermission(principal, "payroll.review");
    const matchCode = input.matchCode ?? null;
    const matchLabel = input.matchLabel ?? null;
    assertMatchable({ matchCode, matchLabel });

    let priority = input.priority;
    if (priority === undefined) {
      const existing = await deps.mappingRules.listManaged(principal.userId);
      priority = 100 + existing.filter((rule) => !rule.global).length;
    }

    const created = await deps.mappingRules.create({
      userId: principal.userId,
      matchCode,
      matchLabel,
      componentKind: input.componentKind,
      target: input.target,
      priority,
    });
    await deps.audit({
      actorUserId: principal.userId,
      action: "payroll.mapping_rule_created",
      entityType: "payroll_mapping_rule",
      entityId: created.id,
      after: { matchCode, matchLabel, componentKind: created.componentKind, priority: created.priority },
    });
    return created;
  };
}
