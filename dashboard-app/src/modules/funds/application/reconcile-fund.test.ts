import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { reconcileFund } from "./reconcile-fund";
import { fundHarness, seedFund } from "./test-support";

describe("reconcileFund", () => {
  it("denies viewers and ignores unrelated payroll for manual funds", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps, { slug: "manual" });
    h.records.push({ id: "payroll-1", month: "2026-01-01" });
    await expect(reconcileFund(h.deps)(testPrincipal({ roles: ["viewer"] }), fund.id)).rejects.toThrow(PermissionDeniedError);
    await expect(reconcileFund(h.deps)(testPrincipal(), fund.id)).resolves.toEqual({ detected: [], resolved: 0 });
  });

  it("detects mapped missing payroll, enriches exact records, qualifies ids, resolves disappeared issues, and audits", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    h.expectedBySlug.set("cometa", ["2026-01-01"]);
    h.records.push({ id: "payroll-1", month: "2026-01-01" });
    const first = await reconcileFund(h.deps)(testPrincipal(), fund.id);
    expect(first.detected).toEqual([expect.objectContaining({ entityId: `${fund.id}:2026-01-01` })]);
    await h.deps.contributions.create({
      fundId: fund.id, typeCode: "employee", accrualPeriodStart: "2026-01-01", accrualPeriodEnd: "2026-03-01",
      postedMonth: "2026-04-01", valueDate: null, amount: "100.00", currency: "EUR", source: "payroll",
      payrollRecordId: "payroll-1", note: null, reversesId: null, reconciliationStatus: "received",
    });
    await expect(reconcileFund(h.deps)(testPrincipal(), fund.id)).resolves.toEqual({ detected: [], resolved: 1 });
    expect(h.audits.at(-1)).toMatchObject({ action: "funds.reconciled", entityId: fund.id });
  });

  it("qualifies contribution issue ids and preserves acknowledged issues on upsert", async () => {
    const h = fundHarness();
    const fund = await seedFund(h.deps);
    let jumpId: string | undefined;
    for (let index = 1; index <= 7; index += 1) {
      const month = `2026-${String(index).padStart(2, "0")}-01`;
      const payrollRecordId = `payroll-${index}`;
      h.records.push({ id: payrollRecordId, month });
      const row = await h.deps.contributions.create({
        fundId: fund.id, typeCode: "employee", accrualPeriodStart: month, accrualPeriodEnd: month,
        postedMonth: month, valueDate: null, amount: index === 7 ? "500.00" : "100.00", currency: "EUR", source: "payroll",
        payrollRecordId, note: null, reversesId: null, reconciliationStatus: "received",
      });
      if (index === 7) jumpId = row.id;
    }
    const [detected] = (await reconcileFund(h.deps)(testPrincipal(), fund.id)).detected;
    expect(detected).toMatchObject({ kind: "anomalous", entityId: `${fund.id}:${jumpId}` });
    const [issue] = await h.deps.issues.listOpen(testPrincipal().userId, "funds", `${fund.id}:`);
    expect(issue?.entityId).toBe(`${fund.id}:${jumpId}`);
    if (!issue) throw new Error("setup failed");
    await h.deps.issues.setStatus(testPrincipal().userId, issue.id, "acknowledged", testPrincipal().userId, h.deps.clock.now());
    await reconcileFund(h.deps)(testPrincipal(), fund.id);
    expect((await h.deps.issues.listOpen(testPrincipal().userId, "funds", `${fund.id}:`))[0]?.status).toBe("acknowledged");
  });
});
