import { describe, expect, it } from "vitest";
import { VersionMismatchError } from "../application/errors";
import {
  MemoryContributionsRepository,
  MemoryFundsRepository,
  MemoryIssuesRepository,
  MemoryPlansRepository,
  MemorySchedulesRepository,
} from "./memory-repositories";

const fund = (name: string, slug = name.toLowerCase()) => ({
  userId: "user-1", slug, name, kind: "pension" as const, currency: "EUR", accountId: null,
});

const contribution = (over: Partial<Parameters<MemoryContributionsRepository["create"]>[0]> = {}) => ({
  fundId: "fund-1", typeCode: "employee" as const, accrualPeriodStart: "2026-01-01",
  accrualPeriodEnd: "2026-01-31", postedMonth: "2026-02-01", valueDate: null,
  amount: "250", currency: "EUR", source: "payroll" as const, payrollRecordId: "pay-1",
  note: null, reversesId: null, reconciliationStatus: "received" as const, ...over,
});

describe("MemoryFundsRepository", () => {
  it("orders active funds by name and includes archives only when requested", async () => {
    const repo = new MemoryFundsRepository();
    const zulu = await repo.create(fund("Zulu"));
    await repo.create(fund("Alpha"));
    await repo.update("user-1", zulu.id, 1, { status: "archived", archivedAt: new Date() });
    expect((await repo.list("user-1")).map((row) => row.name)).toEqual(["Alpha"]);
    expect((await repo.list("user-1", { includeArchived: true })).map((row) => row.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("bumps version and throws VersionMismatchError for a stale update", async () => {
    const repo = new MemoryFundsRepository();
    const created = await repo.create(fund("Pension"));
    const updated = await repo.update("user-1", created.id, created.version, { name: "Pension Plus" });
    expect(updated).toMatchObject({ name: "Pension Plus", version: 2 });
    await expect(repo.update("user-1", created.id, 1, { name: "Stale" })).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it("enforces the owner-slug uniqueness constraint", async () => {
    const repo = new MemoryFundsRepository();
    await repo.create(fund("One", "same"));
    await expect(repo.create(fund("Two", "same"))).rejects.toThrow(/unique/i);
  });
});

describe("MemorySchedulesRepository and MemoryPlansRepository", () => {
  it("upserts schedules and plans by fund/effective date and normalizes money", async () => {
    const schedules = new MemorySchedulesRepository();
    const plans = new MemoryPlansRepository();
    const schedule = { fundId: "fund-1", frequency: "monthly" as const, periodAnchorMonth: 1, postingLagMonths: 1, feePerPosting: "2", effectiveFrom: "2026-01-01" };
    const first = await schedules.add(schedule);
    const replaced = await schedules.add({ ...schedule, feePerPosting: "3.5" });
    expect(replaced).toMatchObject({ id: first.id, feePerPosting: "3.50" });
    const plan = { fundId: "fund-1", effectiveFrom: "2026-02-01", initialCapital: "100", fixedMonthlyAmount: "25.5", note: null };
    const firstPlan = await plans.add(plan);
    const replacedPlan = await plans.add({ ...plan, initialCapital: "150" });
    expect(replacedPlan).toMatchObject({ id: firstPlan.id, initialCapital: "150.00", fixedMonthlyAmount: "25.50" });
  });
});

describe("MemoryContributionsRepository", () => {
  it("deletes every matching payroll contribution and returns the count", async () => {
    const repo = new MemoryContributionsRepository();
    await repo.create(contribution());
    await repo.create(contribution({ typeCode: "employer" }));
    await repo.create(contribution({ payrollRecordId: "pay-2" }));
    await expect(repo.deleteByPayrollRecord("fund-1", "pay-1")).resolves.toBe(2);
    expect(await repo.listForFund("fund-1")).toHaveLength(1);
  });

  it("detects a system fee and normalizes its amount", async () => {
    const repo = new MemoryContributionsRepository();
    const created = await repo.create(contribution({ typeCode: "fee", source: "system", payrollRecordId: null, amount: "2.5" }));
    expect(created.amount).toBe("2.50");
    await expect(repo.hasSystemFee("fund-1", "2026-02-01")).resolves.toBe(true);
    await expect(repo.hasSystemFee("fund-1", "2026-03-01")).resolves.toBe(false);
  });

  it("enforces payroll and system-fee partial uniqueness", async () => {
    const repo = new MemoryContributionsRepository();
    await repo.create(contribution());
    await expect(repo.create(contribution())).rejects.toThrow(/unique/i);
    await repo.create(contribution({ typeCode: "fee", source: "system", payrollRecordId: null }));
    await expect(repo.create(contribution({ typeCode: "fee", source: "system", payrollRecordId: null }))).rejects.toThrow(/unique/i);
  });
});

describe("MemoryIssuesRepository", () => {
  const issue = { userId: "user-1", domain: "funds", entityType: "fund", entityId: "fund-1:2026-01-01", kind: "missing", severity: "warning" as const, detail: { month: "2026-01-01" } };

  it("keeps acknowledged status while refreshing an open issue", async () => {
    const repo = new MemoryIssuesRepository();
    const created = await repo.upsertOpen(issue);
    await repo.setStatus("user-1", created.id, "acknowledged", "reviewer", new Date());
    const updated = await repo.upsertOpen({ ...issue, severity: "error", detail: { refreshed: true } });
    expect(updated).toMatchObject({ id: created.id, status: "acknowledged", severity: "error", detail: { refreshed: true } });
  });

  it("resolveMissing resolves only live issues absent from keep", async () => {
    const repo = new MemoryIssuesRepository();
    const kept = await repo.upsertOpen(issue);
    const resolved = await repo.upsertOpen({ ...issue, entityId: "fund-1:2026-02-01" });
    await repo.upsertOpen({ ...issue, entityId: "other:2026-02-01" });
    const count = await repo.resolveMissing("user-1", "funds", "fund-1:", [{ entityType: kept.entityType, entityId: kept.entityId, kind: kept.kind }], "reviewer", new Date());
    expect(count).toBe(1);
    expect((await repo.listOpen("user-1", "funds")).map((row) => row.id)).not.toContain(resolved.id);
  });

  it("treats resolved issues as terminal", async () => {
    const repo = new MemoryIssuesRepository();
    const created = await repo.upsertOpen(issue);
    const resolvedAt = new Date("2026-03-01T00:00:00Z");
    await expect(repo.setStatus("user-1", created.id, "resolved", "reviewer", resolvedAt)).resolves.toMatchObject({ status: "resolved" });
    await expect(repo.setStatus("user-1", created.id, "acknowledged", "reviewer", new Date("2026-03-02T00:00:00Z"))).resolves.toBeNull();
    await expect(repo.resolveMissing("user-1", "funds", "fund-1:", [], "reviewer", new Date("2026-03-03T00:00:00Z"))).resolves.toBe(0);
  });
});
