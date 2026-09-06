import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { ReconciliationIssue, UseCaseDeps } from "./ports";

export function acknowledgeIssue(deps: UseCaseDeps) {
  return async (principal: Principal, issueId: string): Promise<ReconciliationIssue> => {
    assertPermission(principal, "funds.write");
    const before = (await deps.issues.listOpen(principal.userId, "funds")).find((issue) => issue.id === issueId);
    if (!before) throw new NotFoundError("Reconciliation issue not found");
    const after = await deps.issues.setStatus(principal.userId, before.id, "acknowledged", principal.userId, deps.clock.now());
    if (!after) throw new NotFoundError("Reconciliation issue not found");
    await deps.audit({ actorUserId: principal.userId, action: "funds.issue_acknowledged", entityType: "reconciliation_issue", entityId: after.id, before, after });
    return after;
  };
}
