import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { ReconciliationIssue, UseCaseDeps } from "./ports";

/**
 * Closes an issue for good. The counterpart of Phase 5's `acknowledgeIssue`
 * ("seen, still true"); this one says "dealt with", stamps who and when, and
 * takes the row out of the partial unique index that keeps one live issue per
 * (entity, kind) — so if the underlying condition recurs, reconciliation opens
 * a fresh issue rather than silently reusing this one.
 *
 * Already-resolved is a 404, not a no-op: `setStatus` refuses a resolved row, so
 * a second resolve would otherwise report success while stamping nothing.
 */
export function resolveIssue(deps: UseCaseDeps) {
  return async (principal: Principal, issueId: string): Promise<ReconciliationIssue> => {
    assertPermission(principal, "finance.manage");
    const before = await deps.issues.get(principal.userId, issueId);
    if (!before || before.status === "resolved") throw new NotFoundError("Reconciliation issue not found");
    const after = await deps.issues.setStatus(principal.userId, issueId, "resolved", principal.userId, deps.clock.now());
    if (!after) throw new NotFoundError("Reconciliation issue not found");
    await deps.audit({
      actorUserId: principal.userId,
      action: "funds.issue_resolved",
      entityType: "reconciliation_issue",
      entityId: after.id,
      before,
      after,
    });
    return after;
  };
}
