/**
 * The interests' side of moving an account to another source (rewrite plan N4, specification §9.4):
 * the settlements are not published on the source of before any more — the bank brings the credit.
 * "Undo switch" gives no rule its publishing back: no rule publishes since R5c (decision H37). Every
 * write takes the caller's transaction.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import type { Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { interestRules } from "../schema";

type Who = Pick<Ctx, "userId">;

/**
 * The rules of an account that publish or credit, turned to "analysis only"; returns what each was.
 * A rule that credits stops too: on the new source the bank brings the credit.
 */
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
        ne(interestRules.mode, "analyze_only"),
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
