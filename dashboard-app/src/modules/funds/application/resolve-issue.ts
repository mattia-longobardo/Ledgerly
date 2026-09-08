import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { ReconciliationIssue, UseCaseDeps } from "./ports";

/**
 * The Phase 6 convention (commit `ef7f527`), applied to an audit detail rather
 * than a response DTO: ownership keys are removed recursively, so a shape that
 * grows a nested owner later stays covered without anyone remembering to add a
 * mapper for it.
 *
 * `resolvedBy` goes with them. It is a user id like the others, the audit row
 * already records who acted in its own `actorUserId` column, and
 * `docs/api/README.md` promises fund responses expose neither ownership nor
 * resolver user IDs.
 */
const OWNERSHIP_KEYS = new Set(["userId", "organizationId", "actorUserId", "resolvedBy"]);

function stripOwnership(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOwnership);
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !OWNERSHIP_KEYS.has(key))
      .map(([key, nested]) => [key, stripOwnership(nested)]),
  );
}

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
      before: stripOwnership(before),
      after: stripOwnership(after),
    });
    return after;
  };
}
