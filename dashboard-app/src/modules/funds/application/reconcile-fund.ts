import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { detectIssues, type DetectedIssue } from "../domain/reconcile";
import { NotFoundError } from "./errors";
import type { UseCaseDeps } from "./ports";

function qualified(fundId: string, issue: DetectedIssue): DetectedIssue {
  return issue.entityId.startsWith(`${fundId}:`) ? issue : { ...issue, entityId: `${fundId}:${issue.entityId}` };
}

export function reconcileFund(deps: UseCaseDeps) {
  return async (principal: Principal, fundId: string): Promise<{ detected: DetectedIssue[]; resolved: number }> => {
    assertPermission(principal, "funds.write");
    const fund = await deps.funds.lock(principal.userId, fundId);
    if (!fund) throw new NotFoundError();
    const [rows, payrollMonths, liveRecords] = await Promise.all([
      deps.contributions.listForFund(fund.id),
      deps.payrollMonths.expectedMonths(principal.userId, fund.slug),
      deps.payrollMonths.liveRecords(principal.userId, true),
    ]);
    const monthByRecord = new Map(liveRecords.map((row) => [row.id, row.month]));
    const enriched = rows.map((row) => row.payrollRecordId === null
      ? row
      : { ...row, payrollAccrualMonth: monthByRecord.get(row.payrollRecordId) });
    const detected = detectIssues({ fundId: fund.id, payrollMonths, rows: enriched }).map((issue) => qualified(fund.id, issue));
    for (const issue of detected) {
      await deps.issues.upsertOpen({
        userId: principal.userId,
        domain: "funds",
        entityType: issue.entityType,
        entityId: issue.entityId,
        kind: issue.kind,
        severity: issue.severity,
        detail: issue.detail,
      });
    }
    const resolved = await deps.issues.resolveMissing(
      principal.userId,
      "funds",
      `${fund.id}:`,
      detected.map(({ entityType, entityId, kind }) => ({ entityType, entityId, kind })),
      principal.userId,
      deps.clock.now(),
    );
    await deps.audit({ actorUserId: principal.userId, action: "funds.reconciled", entityType: "fund", entityId: fund.id, after: { detected, resolved } });
    return { detected, resolved };
  };
}
