import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  accountBalances,
  accounts,
  organizations,
  payrollImports,
  payrollRecords,
  users,
} from "@/lib/db/schema";
import type { DbClient } from "@/lib/db/client";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import { VersionMismatchError } from "../application/errors";
import type {
  ContributionsRepository,
  FundsRepository,
  IssuesRepository,
  PlansRepository,
  SchedulesRepository,
} from "../application/ports";
import { drizzleAccountLinkSource } from "./account-link-source";
import { drizzleAccountValuationSource } from "./account-valuation-source";
import { DrizzleContributionsRepository } from "./drizzle-contributions-repository";
import { DrizzleFundsRepository } from "./drizzle-funds-repository";
import { DrizzleIssuesRepository } from "./drizzle-issues-repository";
import { DrizzlePlansRepository, DrizzleSchedulesRepository } from "./drizzle-schedules-plans-repository";
import {
  MemoryContributionsRepository,
  MemoryFundsRepository,
  MemoryIssuesRepository,
  MemoryPlansRepository,
  MemorySchedulesRepository,
} from "./memory-repositories";
import { drizzlePayrollMonthsSource } from "./payroll-months-source";

interface Repositories {
  funds: FundsRepository;
  schedules: SchedulesRepository;
  plans: PlansRepository;
  contributions: ContributionsRepository;
  issues: IssuesRepository;
}

async function seedUser(displayName: string): Promise<string> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: `${displayName} org` }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName }).returning();
  return user!.id;
}

async function seedPayrollRecords(tx: DbClient, userId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const [payrollImport] = await tx.insert(payrollImports).values({
      userId,
      fileName: `payroll-${index}.pdf`,
      sizeBytes: 100,
      sha256: String(index + 1).repeat(64),
      retentionUntil: new Date("2027-01-01T00:00:00Z"),
    }).returning();
    const month = `2026-0${index + 1}-01`;
    const [record] = await tx.insert(payrollRecords).values({
      userId,
      importId: payrollImport!.id,
      periodStart: month,
      periodEnd: `2026-0${index + 1}-28`,
    }).returning();
    ids.push(record!.id);
  }
  return ids;
}

function memoryRepositories(): Repositories {
  return {
    funds: new MemoryFundsRepository(),
    schedules: new MemorySchedulesRepository(),
    plans: new MemoryPlansRepository(),
    contributions: new MemoryContributionsRepository(),
    issues: new MemoryIssuesRepository(),
  };
}

function drizzleRepositories(tx: DbClient): Repositories {
  return {
    funds: new DrizzleFundsRepository(tx),
    schedules: new DrizzleSchedulesRepository(tx),
    plans: new DrizzlePlansRepository(tx),
    contributions: new DrizzleContributionsRepository(tx),
    issues: new DrizzleIssuesRepository(tx),
  };
}

async function runWithRepositories(
  backend: "memory" | "drizzle",
  test: (repos: Repositories, fixture: {
    userId: string;
    payrollRecordIds: string[];
    withSavepoint<T>(run: (repos: Repositories) => Promise<T>): Promise<T>;
  }) => Promise<void>,
): Promise<void> {
  const userId = await seedUser(`${backend} user`);
  const db = await testDb();
  await withSystemContext(db, async (tx) => {
    const payrollRecordIds = await seedPayrollRecords(tx, userId);
    const repos = backend === "memory" ? memoryRepositories() : drizzleRepositories(tx);
    const withSavepoint = <T>(run: (inner: Repositories) => Promise<T>): Promise<T> =>
      backend === "memory" ? run(repos) : tx.transaction((nested) => run(drizzleRepositories(nested)));
    await test(repos, { userId, payrollRecordIds, withSavepoint });
  });
}

function constraintMessage(error: unknown): string {
  return (error as { cause?: { message?: string } }).cause?.message ?? (error as Error).message;
}

const BACKENDS = [{ backend: "memory" as const }, { backend: "drizzle" as const }];

describe.each(BACKENDS)("$backend funds repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders lists, filters archives, locks by owner, and enforces optimistic versions", async () => {
    await runWithRepositories(backend, async ({ funds }, { userId, withSavepoint }) => {
      const zulu = await funds.create({ userId, slug: "zulu", name: "Zulu", kind: "pension", currency: "EUR", accountId: null });
      const alpha = await funds.create({ userId, slug: "alpha", name: "Alpha", kind: "savings", currency: "EUR", accountId: null });
      const archived = await funds.update(userId, zulu.id, 1, { status: "archived", archivedAt: new Date("2026-01-01T00:00:00Z") });
      expect(archived?.version).toBe(2);
      expect((await funds.list(userId)).map((row) => row.id)).toEqual([alpha.id]);
      expect((await funds.list(userId, { includeArchived: true })).map((row) => row.name)).toEqual(["Alpha", "Zulu"]);
      expect(await funds.lock(userId, alpha.id)).toMatchObject({ id: alpha.id });
      expect(await funds.lock(crypto.randomUUID(), alpha.id)).toBeNull();
      await expect(funds.update(userId, alpha.id, 2, { name: "Stale" })).rejects.toBeInstanceOf(VersionMismatchError);
      const duplicateError = await withSavepoint(({ funds: isolated }) =>
        isolated.create({ userId, slug: "alpha", name: "Duplicate", kind: "other", currency: "EUR", accountId: null }),
      ).catch((error: unknown) => error);
      expect(constraintMessage(duplicateError)).toContain("funds_user_slug_uq");
    });
  });
});

describe.each(BACKENDS)("$backend schedules and plans repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders by effective date and upserts the unique fund/date row", async () => {
    await runWithRepositories(backend, async ({ funds, schedules, plans }, { userId }) => {
      const fund = await funds.create({ userId, slug: "pension", name: "Pension", kind: "pension", currency: "EUR", accountId: null });
      const laterSchedule = await schedules.add({ fundId: fund.id, frequency: "quarterly", periodAnchorMonth: 1, postingLagMonths: 1, feePerPosting: "2", effectiveFrom: "2026-04-01" });
      await schedules.add({ fundId: fund.id, frequency: "monthly", periodAnchorMonth: 1, postingLagMonths: 0, feePerPosting: "0", effectiveFrom: "2026-01-01" });
      const replacedSchedule = await schedules.add({ fundId: fund.id, frequency: "annual", periodAnchorMonth: 1, postingLagMonths: 2, feePerPosting: "3.5", effectiveFrom: "2026-04-01" });
      expect(replacedSchedule).toMatchObject({ id: laterSchedule.id, feePerPosting: "3.50" });
      expect((await schedules.listForFund(fund.id)).map((row) => row.effectiveFrom)).toEqual(["2026-01-01", "2026-04-01"]);

      const laterPlan = await plans.add({ fundId: fund.id, effectiveFrom: "2026-06-01", initialCapital: "100", fixedMonthlyAmount: "25", note: null });
      await plans.add({ fundId: fund.id, effectiveFrom: "2026-01-01", initialCapital: "0", fixedMonthlyAmount: null, note: null });
      const replacedPlan = await plans.add({ fundId: fund.id, effectiveFrom: "2026-06-01", initialCapital: "150.5", fixedMonthlyAmount: "30", note: "raised" });
      expect(replacedPlan).toMatchObject({ id: laterPlan.id, initialCapital: "150.50" });
      expect((await plans.listForFund(fund.id)).map((row) => row.effectiveFrom)).toEqual(["2026-01-01", "2026-06-01"]);
    });
  });
});

describe.each(BACKENDS)("$backend contributions repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders, filters posted months, deletes payroll rows, and detects system fees", async () => {
    await runWithRepositories(backend, async ({ funds, contributions }, { userId, payrollRecordIds, withSavepoint }) => {
      const fund = await funds.create({ userId, slug: "pension", name: "Pension", kind: "pension", currency: "EUR", accountId: null });
      const input = (over: Partial<Parameters<ContributionsRepository["create"]>[0]> = {}) => ({
        fundId: fund.id, typeCode: "employee" as const, accrualPeriodStart: "2026-01-01", accrualPeriodEnd: "2026-01-31",
        postedMonth: "2026-02-01", valueDate: null, amount: "250", currency: "EUR", source: "payroll" as const,
        payrollRecordId: payrollRecordIds[0]!, note: null, reversesId: null, reconciliationStatus: "received" as const, ...over,
      });
      const march = await contributions.create(input({ accrualPeriodStart: "2026-02-01", accrualPeriodEnd: "2026-02-28", postedMonth: "2026-03-01", payrollRecordId: payrollRecordIds[1] }));
      const feb = await contributions.create(input());
      const employer = await contributions.create(input({ typeCode: "employer", accrualPeriodStart: "2026-01-05", amount: "300", payrollRecordId: payrollRecordIds[0] }));
      const fee = await contributions.create(input({ typeCode: "fee", accrualPeriodStart: "2026-01-10", source: "system", payrollRecordId: null, amount: "2.5" }));

      expect((await contributions.listForFund(fund.id, { from: "2026-03-01", to: "2026-03-01" })).map((row) => row.id)).toEqual([march.id]);
      expect((await contributions.listForFund(fund.id)).map((row) => row.id)).toEqual([feb.id, employer.id, fee.id, march.id]);
      await expect(contributions.hasSystemFee(fund.id, "2026-02-01")).resolves.toBe(true);
      await expect(contributions.hasSystemFee(fund.id, "2026-04-01")).resolves.toBe(false);
      const duplicatePayrollError = await withSavepoint(({ contributions: isolated }) => isolated.create(input())).catch((error: unknown) => error);
      expect(constraintMessage(duplicatePayrollError)).toContain("fund_contributions_payroll_uq");
      const duplicateFeeError = await withSavepoint(({ contributions: isolated }) => isolated.create(input({
        typeCode: "fee", accrualPeriodStart: "2026-01-15", source: "system", payrollRecordId: null, amount: "3",
      }))).catch((error: unknown) => error);
      expect(constraintMessage(duplicateFeeError)).toContain("fund_contributions_system_fee_uq");
      await expect(contributions.deleteByPayrollRecord(fund.id, payrollRecordIds[0]!)).resolves.toBe(2);
    });
  });
});

describe.each(BACKENDS)("$backend issues repository contract", ({ backend }) => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("preserves acknowledgment on upsert and resolves only absent issue keys", async () => {
    await runWithRepositories(backend, async ({ issues }, { userId }) => {
      const issue = { userId, domain: "funds", entityType: "fund", entityId: "fund-1:2026-01-01", kind: "missing", severity: "warning" as const, detail: { month: "2026-01-01" } };
      const kept = await issues.upsertOpen(issue);
      await issues.setStatus(userId, kept.id, "acknowledged", userId, new Date("2026-01-02T00:00:00Z"));
      const refreshed = await issues.upsertOpen({ ...issue, severity: "error", detail: { refreshed: true } });
      expect(refreshed).toMatchObject({ id: kept.id, status: "acknowledged", severity: "error", detail: { refreshed: true } });
      const terminal = await issues.upsertOpen({ ...issue, entityId: "fund-1:2026-02-01" });
      await issues.upsertOpen({ ...issue, entityId: "other:2026-02-01" });
      await expect(issues.resolveMissing(userId, "funds", "fund-1:", [{ entityType: kept.entityType, entityId: kept.entityId, kind: kept.kind }], userId, new Date("2026-03-01T00:00:00Z"))).resolves.toBe(1);
      expect((await issues.listOpen(userId, "funds")).map((row) => row.entityId)).toEqual(["fund-1:2026-01-01", "other:2026-02-01"]);
      await expect(issues.setStatus(userId, terminal.id, "acknowledged", userId, new Date("2026-03-02T00:00:00Z"))).resolves.toBeNull();
      await expect(issues.resolveMissing(userId, "funds", "fund-1:", [{ entityType: kept.entityType, entityId: kept.entityId, kind: kept.kind }], userId, new Date("2026-03-03T00:00:00Z"))).resolves.toBe(0);
    });
  });
});

describe("Drizzle owner-scoped sources", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("cannot get or lock another user's fund, even under system RLS bypass", async () => {
    const userA = await seedUser("A");
    const userB = await seedUser("B");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleFundsRepository(tx);
      const fund = await repo.create({ userId: userA, slug: "mine", name: "Mine", kind: "pension", currency: "EUR", accountId: null });
      await expect(repo.get(userB, fund.id)).resolves.toBeNull();
      await expect(repo.lock(userB, fund.id)).resolves.toBeNull();
    });
  });

  it("account lookup returns owner currency and rejects another owner", async () => {
    const userA = await seedUser("A");
    const userB = await seedUser("B");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId: userA, name: "GBP pension", type: "pension_fund", origin: "manual", currency: "GBP" }).returning();
      const source = drizzleAccountLinkSource(tx);
      await expect(source.get(userA, account!.id)).resolves.toEqual({ currency: "GBP" });
      await expect(source.get(userB, account!.id)).resolves.toBeNull();
    });
  });

  it("returns deterministic latest and monthly valuations for tied as-of dates", async () => {
    const userA = await seedUser("A");
    const userB = await seedUser("B");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [account] = await tx.insert(accounts).values({ userId: userA, name: "Pension", type: "pension_fund", origin: "manual" }).returning();
      await tx.insert(accountBalances).values([
        { accountId: account!.id, asOf: "2026-02-28", balance: "100.00", source: "manual", capturedAt: new Date("2026-02-28T10:00:00Z") },
        { accountId: account!.id, asOf: "2026-02-28", balance: "110.00", source: "provider", capturedAt: new Date("2026-02-28T11:00:00Z") },
        { accountId: account!.id, asOf: "2026-03-15", balance: "120.00", source: "provider", capturedAt: new Date("2026-03-15T10:00:00Z") },
      ]);
      const source = drizzleAccountValuationSource(tx);
      await expect(source.latest(userA, account!.id)).resolves.toEqual({ asOf: "2026-03-15", balance: "120.00" });
      await expect(source.monthly(userA, account!.id)).resolves.toEqual([
        { month: "2026-02-01", balance: "110.00" },
        { month: "2026-03-01", balance: "120.00" },
      ]);
      await expect(source.latest(userB, account!.id)).resolves.toBeNull();
      await expect(source.monthly(userB, account!.id)).resolves.toEqual([]);
    });
  });

  it("returns exact ids and normalized months for live ordinary payroll records", async () => {
    const userId = await seedUser("Payroll user");
    const otherUserId = await seedUser("Other payroll user");
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const [liveId] = await seedPayrollRecords(tx, userId);
      const [otherId] = await seedPayrollRecords(tx, otherUserId);
      const [supersededImport] = await tx.insert(payrollImports).values({
        userId,
        fileName: "superseded.pdf",
        sizeBytes: 100,
        sha256: "9".repeat(64),
        retentionUntil: new Date("2027-01-01T00:00:00Z"),
      }).returning();
      const [superseded] = await tx.insert(payrollRecords).values({
        userId,
        importId: supersededImport!.id,
        periodStart: "2026-04-01",
        periodEnd: "2026-04-30",
        supersededAt: new Date("2026-05-01T00:00:00Z"),
      }).returning();
      const [bonusImport] = await tx.insert(payrollImports).values({
        userId,
        fileName: "bonus.pdf",
        sizeBytes: 100,
        sha256: "8".repeat(64),
        retentionUntil: new Date("2027-01-01T00:00:00Z"),
      }).returning();
      const [bonus] = await tx.insert(payrollRecords).values({
        userId,
        importId: bonusImport!.id,
        periodStart: "2026-04-01",
        periodEnd: "2026-04-30",
        kind: "bonus",
      }).returning();
      const source = drizzlePayrollMonthsSource(tx);
      const live = await source.liveRecords(userId);
      expect(live).toHaveLength(3);
      expect(live[0]).toEqual({ id: liveId, month: "2026-01-01" });
      expect(live.map((row) => row.id)).not.toContain(otherId);
      expect(live.map((row) => row.id)).not.toContain(superseded!.id);
      expect(live.map((row) => row.id)).not.toContain(bonus!.id);
      await expect(source.liveMonths(userId)).resolves.toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    });
  });
});
