import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { interestRules, type InterestRuleRow } from "@/lib/db/schema";
import type { InterestRule, InterestRulePatch, InterestRulesRepository, NewInterestRule } from "../application/ports";

function toRule(row: InterestRuleRow): InterestRule {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    annualRate: row.annualRate,
    taxRate: row.taxRate,
    dayCount: (row.dayCount === "actual" ? "actual" : Number(row.dayCount)) as InterestRule["dayCount"],
    compounding: row.compounding as InterestRule["compounding"],
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    postingMode: row.postingMode as InterestRule["postingMode"],
    providerCategoryRef: row.providerCategoryRef,
    noteMarker: row.noteMarker,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed interest rules store. Every method assumes the client is a
 * transaction carrying the caller's RLS context (see `withUserContext`); the
 * explicit `user_id` predicates keep the intent readable and hold even under
 * the system context, where RLS lets everything through — matching
 * `DrizzleAccountsRepository`'s precedent. `listActiveForAllUsers` is the one
 * exception: it is meant to run under `withSystemContext` for the daily
 * accrual job and deliberately has no user filter, matching its name and the
 * memory repository's fake exactly.
 */
export class DrizzleInterestRulesRepository implements InterestRulesRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<InterestRule[]> {
    const rows = await this.db.select().from(interestRules).where(eq(interestRules.userId, userId));
    return rows.map(toRule);
  }

  async get(userId: string, id: string): Promise<InterestRule | null> {
    const [row] = await this.db
      .select()
      .from(interestRules)
      .where(and(eq(interestRules.userId, userId), eq(interestRules.id, id)))
      .limit(1);
    return row ? toRule(row) : null;
  }

  async listActiveForAllUsers(asOf: string): Promise<InterestRule[]> {
    const rows = await this.db
      .select()
      .from(interestRules)
      .where(and(lte(interestRules.effectiveFrom, asOf), or(isNull(interestRules.effectiveTo), gte(interestRules.effectiveTo, asOf))));
    return rows.map(toRule);
  }

  async create(input: NewInterestRule): Promise<InterestRule> {
    const [row] = await this.db
      .insert(interestRules)
      .values({ ...input, dayCount: String(input.dayCount) })
      .returning();
    return toRule(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: InterestRulePatch,
  ): Promise<InterestRule | "version_mismatch" | null> {
    const [row] = await this.db
      .update(interestRules)
      .set({
        ...patch,
        dayCount: patch.dayCount !== undefined ? String(patch.dayCount) : undefined,
        version: sql`${interestRules.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(interestRules.userId, userId), eq(interestRules.id, id), eq(interestRules.version, expectedVersion)))
      .returning();
    if (row) return toRule(row);
    // Nothing matched: either the rule is gone, or somebody else moved the version on.
    return (await this.get(userId, id)) ? "version_mismatch" : null;
  }
}
