// The records of a rule every part of the service reads: the rule, its bands, and the refusal of its
// use cases. No use case lives here.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Tier } from "../rules";
import { interestAccruals, interestEntries, interestRules, interestRuleTiers } from "../schema";

export type InterestRule = typeof interestRules.$inferSelect;
export type InterestEntry = typeof interestEntries.$inferSelect;
export type InterestAccrual = typeof interestAccruals.$inferSelect;

type InterestErrorCode =
  "not_found" | "invalid_account" | "invalid_tiers" | "mode_retired" | "invalid_category" | "not_manual";

export class InterestError extends Error {
  constructor(readonly code: InterestErrorCode) {
    super(code);
    this.name = "InterestError";
  }
}

export async function requireRule(ctx: Pick<Ctx, "userId">, id: string): Promise<InterestRule> {
  const [row] = await getDb()
    .select()
    .from(interestRules)
    .where(and(eq(interestRules.id, id), userScoped(ctx).owns(interestRules)));
  if (!row) throw new InterestError("not_found");
  return row;
}

export async function tiersOf(
  ctx: Pick<Ctx, "userId">,
  ruleIds: readonly string[],
): Promise<Map<string, Tier[]>> {
  if (ruleIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(interestRuleTiers)
    .where(and(userScoped(ctx).owns(interestRuleTiers), inArray(interestRuleTiers.ruleId, [...ruleIds])))
    .orderBy(asc(interestRuleTiers.ruleId), asc(interestRuleTiers.position));
  const byRule = new Map<string, Tier[]>();
  for (const row of rows) {
    byRule.set(row.ruleId, [
      ...(byRule.get(row.ruleId) ?? []),
      { upToCents: row.upToCents, annualRate: row.annualRate },
    ]);
  }
  return byRule;
}

/** A rule's bands, written anew in the caller's transaction (INT-7: one way for create and update). */
export async function replaceTiers(
  tx: Tx,
  ctx: Pick<Ctx, "userId">,
  ruleId: string,
  tiers: readonly Tier[],
): Promise<void> {
  await tx
    .delete(interestRuleTiers)
    .where(and(eq(interestRuleTiers.ruleId, ruleId), userScoped(ctx).owns(interestRuleTiers)));
  await tx
    .insert(interestRuleTiers)
    .values(tiers.map((tier, position) => userScoped(ctx).stamp({ ruleId, position, ...tier })));
}
