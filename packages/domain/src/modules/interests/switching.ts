/**
 * The interests' side of moving an account to another source (rewrite plan N4, specification §9.4):
 * the settlements are not published on the source of before any more — the bank brings the credit —
 * and "Undo switch" gives each rule its mode back. Settlements closed in between are not published
 * by themselves. Every write takes the caller's transaction.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../platform/context";
import type { Tx } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import { RULE_MODES, type RuleMode } from "./rules";
import { interestRules } from "./schema";

type Who = Pick<Ctx, "userId">;

/** The rules of an account that publish, turned to "analysis only"; returns what each was. */
export async function stopPublishing(
  tx: Tx,
  ctx: Who,
  accountId: string,
): Promise<{ ruleId: string; mode: string }[]> {
  const rules = await tx
    .select({ id: interestRules.id, mode: interestRules.mode })
    .from(interestRules)
    .where(
      and(
        eq(interestRules.accountId, accountId),
        eq(interestRules.mode, "post_to_provider"),
        userScoped(ctx).owns(interestRules),
      ),
    )
    .orderBy(asc(interestRules.id));
  if (rules.length === 0) return [];
  await tx
    .update(interestRules)
    .set({ mode: "analyze_only" })
    .where(
      and(
        inArray(
          interestRules.id,
          rules.map((rule) => rule.id),
        ),
        userScoped(ctx).owns(interestRules),
      ),
    );
  return rules.map((rule) => ({ ruleId: rule.id, mode: rule.mode }));
}

/** "Undo switch": each rule gets back the mode it had. An unknown mode is left as it is. */
export async function restorePublishing(
  tx: Tx,
  ctx: Who,
  modes: readonly { ruleId: string; mode: string }[],
): Promise<void> {
  for (const { ruleId, mode } of modes) {
    const known = RULE_MODES.find((one): one is RuleMode => one === mode);
    if (known === undefined) continue;
    await tx
      .update(interestRules)
      .set({ mode: known })
      .where(and(eq(interestRules.id, ruleId), userScoped(ctx).owns(interestRules)));
  }
}
