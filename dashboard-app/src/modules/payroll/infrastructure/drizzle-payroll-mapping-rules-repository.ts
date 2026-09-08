import { and, asc, eq, isNull, or } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollMappingRules, type PayrollMappingRuleRow } from "@/lib/db/schema";
import { DEFAULT_MAPPING_RULES } from "../domain/mapping";
import type {
  ManagedMappingRule,
  MappingRulePatch,
  MappingTarget,
  NewMappingRule,
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

function toManaged(row: PayrollMappingRuleRow): ManagedMappingRule {
  return { ...toRule(row), version: row.version, global: false };
}

/** The code-resident catalogue as the editor sees it: readable, never editable. */
const MANAGED_GLOBALS: readonly ManagedMappingRule[] = GLOBAL_MAPPING_RULES.map((rule) => ({
  ...rule,
  version: null,
  global: true,
}));

function byPriorityThenId<T extends { priority: number; id: string }>(a: T, b: T): number {
  return a.priority - b.priority || a.id.localeCompare(b.id);
}

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

  async listManaged(userId: string): Promise<ManagedMappingRule[]> {
    const rows = await this.db
      .select()
      .from(payrollMappingRules)
      .where(eq(payrollMappingRules.userId, userId))
      .orderBy(asc(payrollMappingRules.priority), asc(payrollMappingRules.id));
    return [...MANAGED_GLOBALS, ...rows.map(toManaged)].sort(byPriorityThenId);
  }

  /**
   * `user_id = <caller>` and never `IS NULL`: the four per-command RLS policies
   * on this table already refuse to hand a global row to an UPDATE or DELETE
   * (see the comment in `drizzle/0015_payroll.sql`), and this predicate says
   * the same thing where a reader of the use case can see it.
   */
  async get(userId: string, id: string): Promise<ManagedMappingRule | null> {
    const [row] = await this.db
      .select()
      .from(payrollMappingRules)
      .where(and(eq(payrollMappingRules.userId, userId), eq(payrollMappingRules.id, id)))
      .limit(1);
    return row ? toManaged(row) : null;
  }

  async create(input: NewMappingRule): Promise<ManagedMappingRule> {
    const [row] = await this.db.insert(payrollMappingRules).values(input).returning();
    return toManaged(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: MappingRulePatch,
  ): Promise<ManagedMappingRule | "version_mismatch" | null> {
    const [row] = await this.db
      .update(payrollMappingRules)
      .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(payrollMappingRules.userId, userId),
          eq(payrollMappingRules.id, id),
          eq(payrollMappingRules.version, expectedVersion),
        ),
      )
      .returning();
    if (row) return toManaged(row);
    // Nothing updated: either the row is not the caller's, or the version moved.
    return (await this.get(userId, id)) ? "version_mismatch" : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(payrollMappingRules)
      .where(and(eq(payrollMappingRules.userId, userId), eq(payrollMappingRules.id, id)))
      .returning({ id: payrollMappingRules.id });
    return rows.length > 0;
  }
}
