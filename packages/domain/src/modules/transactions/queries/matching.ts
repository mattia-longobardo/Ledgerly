import type { Ctx } from "../../../platform/context";
import { matchesMovement, type MovementRule } from "../rules";
import { findMovements } from "./candidates";

/**
 * The movement matcher (rewrite plan §10.11, E7): the visible movements of the rule's account, way
 * and window that carry its text or identifier and its amount, oldest first. The amount is positive.
 */
export async function matchMovements(ctx: Pick<Ctx, "userId" | "timeZone">, rule: MovementRule) {
  const found = await findMovements(ctx, {
    from: rule.window.from,
    to: rule.window.to,
    sign: rule.sign,
    types: rule.types,
    accountIds: rule.accountId === null ? undefined : [rule.accountId],
  });
  return found.filter((movement) => matchesMovement(rule, movement));
}
