import { asc, eq, isNull, or } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollMappingRules, type PayrollMappingRuleRow } from "@/lib/db/schema";
import { DEFAULT_MAPPING_RULES } from "../domain/mapping";
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

/**
 * No migration seeds `payroll_mapping_rules` with the global catalogue: it
 * lives in code as `DEFAULT_MAPPING_RULES` and is merged in here, at the
 * repository, so `listFor` genuinely returns "global rules and this user's
 * own" as documented on the port (`application/ports.ts`) — the same thing
 * `MemoryPayrollMappingRulesRepository` already does, with the same
 * `global-NNN` id scheme, so both backends honor the contract identically for
 * the same input and a caller never has to know which one it's talking to.
 */
const GLOBAL_MAPPING_RULES: readonly PayrollMappingRule[] = DEFAULT_MAPPING_RULES.map((rule, i) => ({
  ...rule,
  id: `global-${String(i).padStart(3, "0")}`,
  userId: null,
}));

export class DrizzlePayrollMappingRulesRepository implements PayrollMappingRulesRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Global rules plus this user's own, `priority asc, id asc` — matching
   * `MemoryPayrollMappingRulesRepository.listFor`'s order exactly.
   *
   * The query still asks for `user_id IS NULL` rows too (the RLS policy
   * already admits exactly this set, and the predicate keeps the intent
   * readable under the system context as well), but any such row is excluded
   * from the merge below: `GLOBAL_MAPPING_RULES` is the one source of the
   * global catalogue, so a future migration that does seed global rows can
   * never double them up here.
   */
  async listFor(userId: string): Promise<PayrollMappingRule[]> {
    const rows = await this.db
      .select()
      .from(payrollMappingRules)
      .where(or(isNull(payrollMappingRules.userId), eq(payrollMappingRules.userId, userId)))
      .orderBy(asc(payrollMappingRules.priority), asc(payrollMappingRules.id));
    const userRules = rows.filter((row) => row.userId !== null).map(toRule);
    return [...GLOBAL_MAPPING_RULES, ...userRules].sort(
      (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
    );
  }
}
