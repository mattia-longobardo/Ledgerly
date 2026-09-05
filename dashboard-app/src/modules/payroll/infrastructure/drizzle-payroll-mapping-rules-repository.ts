import { asc, eq, isNull, or } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollMappingRules, type PayrollMappingRuleRow } from "@/lib/db/schema";
import type {
  MappingTarget,
  PayrollComponentKind,
  PayrollMappingRule,
  PayrollMappingRulesRepository,
} from "../application/ports";

function toRule(row: PayrollMappingRuleRow): PayrollMappingRule {
  return {
    id: row.id,
    userId: row.userId,
    matchCode: row.matchCode,
    matchLabel: row.matchLabel,
    componentKind: row.componentKind as PayrollComponentKind,
    target: row.target as MappingTarget,
    priority: row.priority,
  };
}

export class DrizzlePayrollMappingRulesRepository implements PayrollMappingRulesRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Global rules (`user_id IS NULL`) plus this user's own. The RLS policy
   * already admits exactly this set, but the explicit predicate keeps the
   * intent readable and holds under the system context too.
   */
  async listFor(userId: string): Promise<PayrollMappingRule[]> {
    const rows = await this.db
      .select()
      .from(payrollMappingRules)
      .where(or(isNull(payrollMappingRules.userId), eq(payrollMappingRules.userId, userId)))
      .orderBy(asc(payrollMappingRules.priority), asc(payrollMappingRules.id));
    return rows.map(toRule);
  }
}
