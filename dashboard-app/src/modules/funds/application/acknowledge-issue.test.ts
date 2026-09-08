import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { acknowledgeIssue } from "./acknowledge-issue";
import { fundHarness } from "./test-support";

describe("acknowledgeIssue", () => {
  it("denies viewers, restricts owner and domain, and audits funds issues", async () => {
    const h = fundHarness();
    const fundsIssue = await h.deps.issues.upsertOpen({ userId: testPrincipal().userId, domain: "funds", entityType: "fund_month", entityId: "fund:2026-01-01", kind: "missing", severity: "warning", detail: {} });
    const payrollIssue = await h.deps.issues.upsertOpen({ userId: testPrincipal().userId, domain: "payroll", entityType: "record", entityId: "record-1", kind: "missing", severity: "warning", detail: {} });
    await expect(acknowledgeIssue(h.deps)(testPrincipal({ roles: ["viewer"] }), fundsIssue.id)).rejects.toThrow(PermissionDeniedError);
    await expect(acknowledgeIssue(h.deps)(testPrincipal(), payrollIssue.id)).rejects.toThrow(/not found/i);
    const acknowledged = await acknowledgeIssue(h.deps)(testPrincipal(), fundsIssue.id);
    expect(acknowledged.status).toBe("acknowledged");
    expect(h.audits).toEqual([expect.objectContaining({ action: "funds.issue_acknowledged", entityId: fundsIssue.id })]);
  });
});
