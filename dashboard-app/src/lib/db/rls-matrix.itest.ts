/**
 * One RLS proof for the whole schema (Phase 7 reduced conventions).
 *
 * `CASES` lists every user-owned table the schema has. For each of them the
 * matrix does the same four things:
 *
 *   1. seed one row owned by user A (in system context, so FORCE RLS cannot
 *      get in the way of the fixture);
 *   2. read it back **as A** — a policy that admitted nothing would make the
 *      next step pass vacuously, so this step is the one that proves the seed
 *      landed and is visible to its owner;
 *   3. read the same table **as B** and expect zero rows;
 *   4. have B attempt the write that ownership must forbid — a row carrying
 *      A's `user_id` for a table that has one, or a child row hanging off A's
 *      parent for a table reached through an `EXISTS` policy.
 *
 * A read on the pool-bound `db` with no context set returns zero rows
 * silently, so every read here runs inside `withUserContext`.
 *
 * Constraint proofs that are not plain isolation (uniqueness, CHECKs, the
 * four-policy `payroll_mapping_rules` shape) live at the bottom of this file:
 * they were ported here from the per-domain `*-rls.itest.ts` files this
 * matrix replaced.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { DbClient } from "@/lib/db/client";
import {
  accountBalances,
  accountGroups,
  accounts,
  auditEvents,
  budgetAllocations,
  budgetAmountVersions,
  budgetEvents,
  budgetScopes,
  budgetUsages,
  budgets,
  fundContributionSchedules,
  fundContributionTypes,
  fundContributions,
  fundPlans,
  funds,
  idempotencyKeys,
  integrationConnections,
  interestAccruals,
  interestEntries,
  interestRules,
  organizations,
  payrollComponents,
  payrollImports,
  payrollMappingRules,
  payrollRecords,
  providerLinks,
  rateLimitWindows,
  reconciliationIssues,
  recurringPatterns,
  syncJobs,
  syncRuns,
  timeoffBalances,
  timeoffEvents,
  timeoffTypes,
  transactionCategories,
  transactionLabelLinks,
  transactionLabels,
  transactions,
  users,
  webhookDeliveries,
} from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

/** Ids the seed created for user A, so `foreign` can aim B's write at them. */
type Ids = Record<string, string>;

interface Case {
  /** Physical table name — the test title. */
  table: string;
  /** Inserts exactly one row owned by `userId`, plus any parents it needs. */
  seed: (tx: DbClient, userId: string) => Promise<Ids>;
  /** Reads the table under test. */
  read: (tx: DbClient) => Promise<unknown[]>;
  /** The write B must not be allowed to make: A's `user_id`, or A's parent. */
  foreign: (tx: DbClient, ids: Ids) => Promise<unknown>;
}

const A_UUID = "00000000-0000-7000-8000-0000000000a1";
const RETENTION = new Date("2036-01-01T00:00:00Z");
const OCCURRED = new Date("2026-01-05T10:00:00Z");

/** Drizzle wraps pg errors; the constraint (or policy) name is on `cause`. */
async function rejectsWith(query: PromiseLike<unknown>, message: string): Promise<void> {
  await expect(query).rejects.toMatchObject({ cause: { message: expect.stringContaining(message) } });
}

const REJECTED_BY_RLS = "row-level security";

async function twoUsers(): Promise<{ db: DbClient; a: string; b: string }> {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const created = await db
    .insert(users)
    .values([
      { organizationId: org!.id, displayName: "A" },
      { organizationId: org!.id, displayName: "B" },
    ])
    .returning();
  return { db, a: created[0]!.id, b: created[1]!.id };
}

// ---------------------------------------------------------------------------
// Parent helpers, so a child case can reach its own parent in one line.
// ---------------------------------------------------------------------------

async function anAccount(tx: DbClient, userId: string): Promise<string> {
  const [row] = await tx
    .insert(accounts)
    .values({ userId, name: "Cash", type: "cash", origin: "manual" })
    .returning();
  return row!.id;
}

async function aConnection(tx: DbClient, userId: string): Promise<string> {
  const [row] = await tx
    .insert(integrationConnections)
    .values({ userId, provider: "wallet", status: "connected" })
    .returning();
  return row!.id;
}

async function aTransaction(tx: DbClient, userId: string): Promise<string> {
  const accountId = await anAccount(tx, userId);
  const [row] = await tx
    .insert(transactions)
    .values({ userId, accountId, occurredAt: OCCURRED, amount: "-10.00", type: "expense" })
    .returning();
  return row!.id;
}

function anImport(userId: string, sha: string) {
  return {
    userId,
    fileName: "busta.pdf",
    sizeBytes: 1234,
    sha256: sha,
    storageProvider: "local" as const,
    retentionUntil: RETENTION,
  };
}

async function aPayrollRecord(tx: DbClient, userId: string, sha: string): Promise<string> {
  const [imp] = await tx.insert(payrollImports).values(anImport(userId, sha)).returning();
  const [rec] = await tx
    .insert(payrollRecords)
    .values({ userId, importId: imp!.id, periodStart: "2026-08-01", periodEnd: "2026-08-31" })
    .returning();
  return rec!.id;
}

async function aFund(tx: DbClient, userId: string): Promise<string> {
  const [row] = await tx
    .insert(funds)
    .values({ userId, slug: "pension", name: "Pension", kind: "pension" })
    .returning();
  return row!.id;
}

async function aBudget(tx: DbClient, userId: string): Promise<string> {
  const [row] = await tx
    .insert(budgets)
    .values({ userId, name: "Groceries", startDate: "2026-01-01" })
    .returning();
  return row!.id;
}

async function aTimeoffType(tx: DbClient, userId: string): Promise<string> {
  const [row] = await tx
    .insert(timeoffTypes)
    .values({ userId, code: "vacation", label: "Ferie" })
    .returning();
  return row!.id;
}

const contribution = (fundId: string) => ({
  fundId,
  typeCode: "employee",
  accrualPeriodStart: "2026-01-01",
  accrualPeriodEnd: "2026-03-01",
  postedMonth: "2026-04-01",
  amount: "100.00",
  source: "manual",
});

// ---------------------------------------------------------------------------
// The matrix.
// ---------------------------------------------------------------------------

const CASES: Case[] = [
  // ---- accounts ----------------------------------------------------------
  {
    table: "account_groups",
    seed: async (tx, userId) => {
      await tx.insert(accountGroups).values({ userId, name: "Everyday" });
      return { userId };
    },
    read: (tx) => tx.select().from(accountGroups),
    foreign: (tx, ids) => tx.insert(accountGroups).values({ userId: ids.userId!, name: "Stolen" }),
  },
  {
    table: "accounts",
    seed: async (tx, userId) => ({ userId, accountId: await anAccount(tx, userId) }),
    read: (tx) => tx.select().from(accounts),
    foreign: (tx, ids) =>
      tx.insert(accounts).values({ userId: ids.userId!, name: "Stolen", type: "cash", origin: "manual" }),
  },
  {
    // Child of `accounts`: no `user_id`, reached through an EXISTS policy.
    table: "account_balances",
    seed: async (tx, userId) => {
      const accountId = await anAccount(tx, userId);
      await tx
        .insert(accountBalances)
        .values({ accountId, asOf: "2026-01-31", balance: "10.00", source: "manual" });
      return { userId, accountId };
    },
    read: (tx) => tx.select().from(accountBalances),
    foreign: (tx, ids) =>
      tx
        .insert(accountBalances)
        .values({ accountId: ids.accountId!, asOf: "2026-02-28", balance: "99.00", source: "manual" }),
  },
  {
    table: "provider_links",
    seed: async (tx, userId) => {
      const accountId = await anAccount(tx, userId);
      await tx.insert(providerLinks).values({
        userId,
        provider: "wallet",
        entityType: "account",
        entityId: accountId,
        externalId: "ext-1",
      });
      return { userId, accountId };
    },
    read: (tx) => tx.select().from(providerLinks),
    foreign: (tx, ids) =>
      tx.insert(providerLinks).values({
        userId: ids.userId!,
        provider: "wallet",
        entityType: "account",
        entityId: ids.accountId!,
        externalId: "ext-2",
      }),
  },

  // ---- integrations ------------------------------------------------------
  {
    table: "integration_connections",
    seed: async (tx, userId) => ({ userId, connectionId: await aConnection(tx, userId) }),
    read: (tx) => tx.select().from(integrationConnections),
    foreign: (tx, ids) =>
      tx.insert(integrationConnections).values({ userId: ids.userId!, provider: "trek", status: "connected" }),
  },
  {
    table: "sync_jobs",
    seed: async (tx, userId) => {
      const connectionId = await aConnection(tx, userId);
      await tx.insert(syncJobs).values({ connectionId, kind: "accounts", schedule: "daily" });
      return { userId, connectionId };
    },
    read: (tx) => tx.select().from(syncJobs),
    foreign: (tx, ids) =>
      tx.insert(syncJobs).values({ connectionId: ids.connectionId!, kind: "transactions", schedule: "hourly" }),
  },
  {
    table: "sync_runs",
    seed: async (tx, userId) => {
      const connectionId = await aConnection(tx, userId);
      await tx
        .insert(syncRuns)
        .values({ connectionId, kind: "accounts", status: "queued", trigger: "cron" });
      return { userId, connectionId };
    },
    read: (tx) => tx.select().from(syncRuns),
    foreign: (tx, ids) =>
      tx
        .insert(syncRuns)
        .values({ connectionId: ids.connectionId!, kind: "accounts", status: "running", trigger: "manual" }),
  },
  {
    table: "webhook_deliveries",
    seed: async (tx, userId) => {
      const connectionId = await aConnection(tx, userId);
      await tx.insert(webhookDeliveries).values({
        connectionId,
        provider: "wallet",
        event: "sync.finished",
        payloadHash: "h1",
        status: "accepted",
      });
      return { userId, connectionId };
    },
    read: (tx) => tx.select().from(webhookDeliveries),
    foreign: (tx, ids) =>
      tx.insert(webhookDeliveries).values({
        connectionId: ids.connectionId!,
        provider: "wallet",
        event: "sync.finished",
        payloadHash: "h2",
        status: "accepted",
      }),
  },

  // ---- transactions ------------------------------------------------------
  {
    table: "transaction_categories",
    seed: async (tx, userId) => {
      await tx.insert(transactionCategories).values({ userId, name: "Food" });
      return { userId };
    },
    read: (tx) => tx.select().from(transactionCategories),
    foreign: (tx, ids) => tx.insert(transactionCategories).values({ userId: ids.userId!, name: "Stolen" }),
  },
  {
    table: "transaction_labels",
    seed: async (tx, userId) => {
      const [row] = await tx.insert(transactionLabels).values({ userId, name: "Trip" }).returning();
      return { userId, labelId: row!.id };
    },
    read: (tx) => tx.select().from(transactionLabels),
    foreign: (tx, ids) => tx.insert(transactionLabels).values({ userId: ids.userId!, name: "Stolen" }),
  },
  {
    table: "transactions",
    seed: async (tx, userId) => {
      const accountId = await anAccount(tx, userId);
      await tx
        .insert(transactions)
        .values({ userId, accountId, occurredAt: OCCURRED, amount: "-10.00", type: "expense" });
      return { userId, accountId };
    },
    read: (tx) => tx.select().from(transactions),
    foreign: (tx, ids) =>
      tx.insert(transactions).values({
        userId: ids.userId!,
        accountId: ids.accountId!,
        occurredAt: OCCURRED,
        amount: "-1.00",
        type: "expense",
      }),
  },
  {
    table: "transaction_label_links",
    seed: async (tx, userId) => {
      const transactionId = await aTransaction(tx, userId);
      const [label] = await tx.insert(transactionLabels).values({ userId, name: "Trip" }).returning();
      await tx.insert(transactionLabelLinks).values({ transactionId, labelId: label!.id });
      return { userId, transactionId, labelId: label!.id };
    },
    read: (tx) => tx.select().from(transactionLabelLinks),
    foreign: (tx, ids) =>
      tx.insert(transactionLabelLinks).values({ transactionId: ids.transactionId!, labelId: ids.labelId! }),
  },
  {
    table: "recurring_patterns",
    seed: async (tx, userId) => {
      await tx.insert(recurringPatterns).values({
        userId,
        payee: "Gym",
        cadence: "monthly",
        amountLow: "-30.00",
        amountHigh: "-30.00",
        sign: "-",
        lastSeenAt: OCCURRED,
      });
      return { userId };
    },
    read: (tx) => tx.select().from(recurringPatterns),
    foreign: (tx, ids) =>
      tx.insert(recurringPatterns).values({
        userId: ids.userId!,
        payee: "Stolen",
        cadence: "monthly",
        amountLow: "-1.00",
        amountHigh: "-1.00",
        sign: "-",
        lastSeenAt: OCCURRED,
      }),
  },

  // ---- interests ---------------------------------------------------------
  {
    table: "interest_rules",
    seed: async (tx, userId) => {
      const accountId = await anAccount(tx, userId);
      const [rule] = await tx
        .insert(interestRules)
        .values({ userId, accountId, annualRate: "0.0225", taxRate: "0.26", effectiveFrom: "2026-01-01" })
        .returning();
      return { userId, accountId, ruleId: rule!.id };
    },
    read: (tx) => tx.select().from(interestRules),
    foreign: (tx, ids) =>
      tx.insert(interestRules).values({
        userId: ids.userId!,
        accountId: ids.accountId!,
        annualRate: "0.01",
        taxRate: "0.26",
        effectiveFrom: "2026-02-01",
      }),
  },
  {
    table: "interest_accruals",
    seed: async (tx, userId) => {
      const accountId = await anAccount(tx, userId);
      const [rule] = await tx
        .insert(interestRules)
        .values({ userId, accountId, annualRate: "0.0225", taxRate: "0.26", effectiveFrom: "2026-01-01" })
        .returning();
      await tx.insert(interestAccruals).values({
        ruleId: rule!.id,
        accrualDate: "2026-01-02",
        balanceBasis: "1000.00",
        gross: "0.061644",
        tax: "0.016027",
        net: "0.05",
        carryAfter: "0.000000",
      });
      return { userId, ruleId: rule!.id };
    },
    read: (tx) => tx.select().from(interestAccruals),
    foreign: (tx, ids) =>
      tx.insert(interestAccruals).values({
        ruleId: ids.ruleId!,
        accrualDate: "2026-01-03",
        balanceBasis: "1000.00",
        gross: "0.061644",
        tax: "0.016027",
        net: "0.05",
        carryAfter: "0.000000",
      }),
  },
  {
    table: "interest_entries",
    seed: async (tx, userId) => {
      const accountId = await anAccount(tx, userId);
      await tx
        .insert(interestEntries)
        .values({ userId, accountId, occurredAt: OCCURRED, gross: "1.00", net: "0.74", kind: "projected" });
      return { userId, accountId };
    },
    read: (tx) => tx.select().from(interestEntries),
    foreign: (tx, ids) =>
      tx.insert(interestEntries).values({
        userId: ids.userId!,
        accountId: ids.accountId!,
        occurredAt: OCCURRED,
        gross: "2.00",
        net: "1.48",
        kind: "projected",
      }),
  },

  // ---- payroll -----------------------------------------------------------
  {
    table: "payroll_imports",
    seed: async (tx, userId) => {
      await tx.insert(payrollImports).values(anImport(userId, "a".repeat(64)));
      return { userId };
    },
    read: (tx) => tx.select().from(payrollImports),
    foreign: (tx, ids) => tx.insert(payrollImports).values(anImport(ids.userId!, "b".repeat(64))),
  },
  {
    table: "payroll_records",
    seed: async (tx, userId) => {
      const recordId = await aPayrollRecord(tx, userId, "c".repeat(64));
      const [imp] = await tx.insert(payrollImports).values(anImport(userId, "d".repeat(64))).returning();
      return { userId, recordId, spareImportId: imp!.id };
    },
    read: (tx) => tx.select().from(payrollRecords),
    foreign: (tx, ids) =>
      tx.insert(payrollRecords).values({
        userId: ids.userId!,
        importId: ids.spareImportId!,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      }),
  },
  {
    table: "payroll_components",
    seed: async (tx, userId) => {
      const recordId = await aPayrollRecord(tx, userId, "e".repeat(64));
      await tx
        .insert(payrollComponents)
        .values({ recordId, code: "RETRIB", labelRaw: "Retribuzione", kind: "earning" });
      return { userId, recordId };
    },
    read: (tx) => tx.select().from(payrollComponents),
    foreign: (tx, ids) =>
      tx
        .insert(payrollComponents)
        .values({ recordId: ids.recordId!, code: "STOLEN", labelRaw: "Stolen", kind: "earning" }),
  },
  {
    /**
     * Mixed global/per-user table: `user_id IS NULL` marks a global rule that
     * everybody may SELECT. The matrix therefore models A's row as a *private*
     * one — the "B reads zero" step only holds for private rows, and the
     * migration's global seeds are truncated by `resetDb`. The four-policy
     * shape (global rows readable, never writable by a user) is proved
     * separately at the bottom of this file.
     */
    table: "payroll_mapping_rules",
    seed: async (tx, userId) => {
      await tx.insert(payrollMappingRules).values({
        userId,
        matchCode: "PRIVATE",
        componentKind: "earning",
        target: { kind: "category", ref: "salary" },
      });
      return { userId };
    },
    read: (tx) => tx.select().from(payrollMappingRules),
    foreign: (tx, ids) =>
      tx.insert(payrollMappingRules).values({
        userId: ids.userId!,
        matchCode: "HIJACK",
        componentKind: "earning",
        target: { kind: "category", ref: "salary" },
      }),
  },

  // ---- funds -------------------------------------------------------------
  {
    table: "funds",
    seed: async (tx, userId) => ({ userId, fundId: await aFund(tx, userId) }),
    read: (tx) => tx.select().from(funds),
    foreign: (tx, ids) =>
      tx.insert(funds).values({ userId: ids.userId!, slug: "stolen", name: "Stolen", kind: "pension" }),
  },
  {
    table: "fund_contribution_schedules",
    seed: async (tx, userId) => {
      const fundId = await aFund(tx, userId);
      await tx
        .insert(fundContributionSchedules)
        .values({ fundId, frequency: "monthly", effectiveFrom: "2026-01-01" });
      return { userId, fundId };
    },
    read: (tx) => tx.select().from(fundContributionSchedules),
    foreign: (tx, ids) =>
      tx
        .insert(fundContributionSchedules)
        .values({ fundId: ids.fundId!, frequency: "annual", effectiveFrom: "2027-01-01" }),
  },
  {
    table: "fund_plans",
    seed: async (tx, userId) => {
      const fundId = await aFund(tx, userId);
      await tx.insert(fundPlans).values({ fundId, effectiveFrom: "2026-01-01" });
      return { userId, fundId };
    },
    read: (tx) => tx.select().from(fundPlans),
    foreign: (tx, ids) => tx.insert(fundPlans).values({ fundId: ids.fundId!, effectiveFrom: "2027-01-01" }),
  },
  {
    table: "fund_contributions",
    seed: async (tx, userId) => {
      const fundId = await aFund(tx, userId);
      await tx.insert(fundContributions).values(contribution(fundId));
      return { userId, fundId };
    },
    read: (tx) => tx.select().from(fundContributions),
    foreign: (tx, ids) =>
      tx.insert(fundContributions).values({ ...contribution(ids.fundId!), postedMonth: "2026-05-01" }),
  },
  {
    table: "reconciliation_issues",
    seed: async (tx, userId) => {
      await tx.insert(reconciliationIssues).values({
        userId,
        domain: "funds",
        entityType: "fund_month",
        entityId: "2026-01-01",
        kind: "missing",
      });
      return { userId };
    },
    read: (tx) => tx.select().from(reconciliationIssues),
    foreign: (tx, ids) =>
      tx.insert(reconciliationIssues).values({
        userId: ids.userId!,
        domain: "funds",
        entityType: "fund_month",
        entityId: "2026-02-01",
        kind: "missing",
      }),
  },

  // ---- budgets -----------------------------------------------------------
  {
    table: "budgets",
    seed: async (tx, userId) => ({ userId, budgetId: await aBudget(tx, userId) }),
    read: (tx) => tx.select().from(budgets),
    foreign: (tx, ids) =>
      tx.insert(budgets).values({ userId: ids.userId!, name: "Stolen", startDate: "2026-01-01" }),
  },
  {
    table: "budget_amount_versions",
    seed: async (tx, userId) => {
      const budgetId = await aBudget(tx, userId);
      await tx
        .insert(budgetAmountVersions)
        .values({ budgetId, initialAmount: "100.00", effectiveFrom: "2026-01-01" });
      return { userId, budgetId };
    },
    read: (tx) => tx.select().from(budgetAmountVersions),
    foreign: (tx, ids) =>
      tx
        .insert(budgetAmountVersions)
        .values({ budgetId: ids.budgetId!, initialAmount: "1.00", effectiveFrom: "2026-02-01" }),
  },
  {
    table: "budget_allocations",
    seed: async (tx, userId) => {
      const budgetId = await aBudget(tx, userId);
      await tx.insert(budgetAllocations).values({ budgetId, amount: "50.00", effectiveFrom: "2026-01-01" });
      return { userId, budgetId };
    },
    read: (tx) => tx.select().from(budgetAllocations),
    foreign: (tx, ids) =>
      tx.insert(budgetAllocations).values({ budgetId: ids.budgetId!, amount: "1.00", effectiveFrom: "2026-02-01" }),
  },
  {
    table: "budget_scopes",
    seed: async (tx, userId) => {
      const budgetId = await aBudget(tx, userId);
      await tx.insert(budgetScopes).values({ budgetId, kind: "label", refId: A_UUID });
      return { userId, budgetId };
    },
    read: (tx) => tx.select().from(budgetScopes),
    foreign: (tx, ids) =>
      tx.insert(budgetScopes).values({ budgetId: ids.budgetId!, kind: "category", refId: A_UUID }),
  },
  {
    table: "budget_usages",
    seed: async (tx, userId) => {
      const budgetId = await aBudget(tx, userId);
      await tx
        .insert(budgetUsages)
        .values({ budgetId, amount: "10.00", occurredAt: "2026-01-05", matchedBy: "manual" });
      return { userId, budgetId };
    },
    read: (tx) => tx.select().from(budgetUsages),
    foreign: (tx, ids) =>
      tx
        .insert(budgetUsages)
        .values({ budgetId: ids.budgetId!, amount: "1.00", occurredAt: "2026-01-06", matchedBy: "manual" }),
  },
  {
    table: "budget_events",
    seed: async (tx, userId) => {
      const budgetId = await aBudget(tx, userId);
      await tx.insert(budgetEvents).values({ budgetId, kind: "created" });
      return { userId, budgetId };
    },
    read: (tx) => tx.select().from(budgetEvents),
    foreign: (tx, ids) => tx.insert(budgetEvents).values({ budgetId: ids.budgetId!, kind: "archived" }),
  },

  // ---- time off (0018) ---------------------------------------------------
  {
    table: "timeoff_types",
    seed: async (tx, userId) => ({ userId, typeId: await aTimeoffType(tx, userId) }),
    read: (tx) => tx.select().from(timeoffTypes),
    foreign: (tx, ids) => tx.insert(timeoffTypes).values({ userId: ids.userId!, code: "comp", label: "Recupero" }),
  },
  {
    table: "timeoff_balances",
    seed: async (tx, userId) => {
      const typeId = await aTimeoffType(tx, userId);
      await tx.insert(timeoffBalances).values({ userId, typeId, asOf: "2026-01-31", remaining: "80.00" });
      return { userId, typeId };
    },
    read: (tx) => tx.select().from(timeoffBalances),
    foreign: (tx, ids) =>
      tx
        .insert(timeoffBalances)
        .values({ userId: ids.userId!, typeId: ids.typeId!, asOf: "2026-02-28", remaining: "72.00" }),
  },
  {
    table: "timeoff_events",
    seed: async (tx, userId) => {
      const typeId = await aTimeoffType(tx, userId);
      await tx.insert(timeoffEvents).values({ userId, typeId, date: "2026-01-05" });
      return { userId, typeId };
    },
    read: (tx) => tx.select().from(timeoffEvents),
    foreign: (tx, ids) =>
      tx.insert(timeoffEvents).values({ userId: ids.userId!, typeId: ids.typeId!, date: "2026-01-06" }),
  },

  // ---- platform ----------------------------------------------------------
  {
    table: "audit_events",
    seed: async (tx, userId) => {
      await tx
        .insert(auditEvents)
        .values({ actorUserId: userId, action: "accounts.created", entityType: "account" });
      return { userId };
    },
    read: (tx) => tx.select().from(auditEvents),
    foreign: (tx, ids) =>
      tx
        .insert(auditEvents)
        .values({ actorUserId: ids.userId!, action: "accounts.deleted", entityType: "account" }),
  },
  {
    table: "idempotency_keys",
    seed: async (tx, userId) => {
      await tx.insert(idempotencyKeys).values({
        principalId: userId,
        key: "k1",
        requestHash: "h1",
        expiresAt: RETENTION,
      });
      return { userId };
    },
    read: (tx) => tx.select().from(idempotencyKeys),
    foreign: (tx, ids) =>
      tx
        .insert(idempotencyKeys)
        .values({ principalId: ids.userId!, key: "k2", requestHash: "h2", expiresAt: RETENTION }),
  },
  {
    table: "rate_limit_windows",
    seed: async (tx, userId) => {
      await tx.insert(rateLimitWindows).values({ principalId: userId, windowStart: OCCURRED });
      return { userId };
    },
    read: (tx) => tx.select().from(rateLimitWindows),
    foreign: (tx, ids) =>
      tx.insert(rateLimitWindows).values({ principalId: ids.userId!, windowStart: RETENTION }),
  },
];

describe("RLS matrix", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  describe.each(CASES)("$table", (testCase) => {
    it("is visible to its owner, invisible to another user, and refuses that user's write", async () => {
      const { db, a, b } = await twoUsers();
      const ids = await withSystemContext(db, (tx) => testCase.seed(tx, a));

      const asOwner = await withUserContext(db, { userId: a }, (tx) => testCase.read(tx));
      expect(asOwner.length).toBeGreaterThan(0);

      const asOther = await withUserContext(db, { userId: b }, (tx) => testCase.read(tx));
      expect(asOther).toEqual([]);

      await rejectsWith(
        withUserContext(db, { userId: b }, (tx) => testCase.foreign(tx, ids)),
        REJECTED_BY_RLS,
      );
    });
  });

  /**
   * `pg_policies` is the source of truth: a user-owned table added later
   * without a matrix entry fails here rather than shipping unproven. The
   * catalogues (`integration_providers`, `fund_contribution_types`, `roles`)
   * carry no policy, so they never appear.
   */
  it("covers every table the schema puts an ownership policy on", async () => {
    const db = await testDb();
    const res = await db.execute<{ tablename: string }>(
      sql`SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public' ORDER BY 1`,
    );
    const policed = res.rows.map((r) => r.tablename);
    const covered = new Set(CASES.map((c) => c.table));
    expect(policed.filter((t) => !covered.has(t))).toEqual([]);
    expect(policed.length).toBe(CASES.length);
  });
});

// ---------------------------------------------------------------------------
// Constraint proofs ported from the per-domain `*-rls.itest.ts` files this
// matrix replaced. Isolation is the matrix's job; these are the checks that
// carry business meaning on their own.
// ---------------------------------------------------------------------------

describe("timeoff constraints", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("rejects a second event on the same day for the same user, and allows the same day for another user", async () => {
    const { db, a, b } = await twoUsers();
    const typeA = await withSystemContext(db, (tx) => aTimeoffType(tx, a));
    const typeB = await withSystemContext(db, (tx) => aTimeoffType(tx, b));

    await withUserContext(db, { userId: a }, (tx) =>
      tx.insert(timeoffEvents).values({ userId: a, typeId: typeA, date: "2026-03-02" }),
    );
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(timeoffEvents).values({ userId: a, typeId: typeA, date: "2026-03-02", fraction: "0.50" }),
      ),
      "timeoff_events_user_date_uq",
    );
    await withUserContext(db, { userId: b }, (tx) =>
      tx.insert(timeoffEvents).values({ userId: b, typeId: typeB, date: "2026-03-02" }),
    );
    expect(
      await withUserContext(db, { userId: b }, (tx) => tx.select().from(timeoffEvents)),
    ).toHaveLength(1);
  });

  it("rejects a second balance for the same (type, payroll record) and allows one with no record", async () => {
    const { db, a } = await twoUsers();
    const { typeId, recordId } = await withSystemContext(db, async (tx) => ({
      typeId: await aTimeoffType(tx, a),
      recordId: await aPayrollRecord(tx, a, "9".repeat(64)),
    }));
    const balance = { userId: a, typeId, payrollRecordId: recordId, asOf: "2026-08-31", remaining: "80.00" };

    await withUserContext(db, { userId: a }, (tx) => tx.insert(timeoffBalances).values(balance));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) => tx.insert(timeoffBalances).values(balance)),
      "timeoff_balances_type_record_uq",
    );
    // The index is partial: a manual balance with no record does not collide.
    await withUserContext(db, { userId: a }, (tx) =>
      tx.insert(timeoffBalances).values({ userId: a, typeId, asOf: "2026-08-31", source: "manual" }),
    );
    expect(await withUserContext(db, { userId: a }, (tx) => tx.select().from(timeoffBalances))).toHaveLength(2);
  });

  it("rejects a quarter day — Trek's domain is a half day or a whole one", async () => {
    const { db, a } = await twoUsers();
    const typeId = await withSystemContext(db, (tx) => aTimeoffType(tx, a));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(timeoffEvents).values({ userId: a, typeId, date: "2026-03-03", fraction: "0.25" }),
      ),
      "timeoff_events_fraction_ck",
    );
  });
});

describe("payroll constraints", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("(user_id, sha256) is unique — the same file cannot be imported twice", async () => {
    const { db, a } = await twoUsers();
    await withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(a, "e".repeat(64))));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(a, "e".repeat(64)))),
      "payroll_imports_user_sha_uq",
    );
  });

  it("(user_id, idempotency_key) is unique, and null keys do not collide", async () => {
    const { db, a } = await twoUsers();
    await withUserContext(db, { userId: a }, async (tx) => {
      await tx.insert(payrollImports).values({ ...anImport(a, "f".repeat(64)), idempotencyKey: "k1" });
      await tx.insert(payrollImports).values({ ...anImport(a, "0".repeat(64)), idempotencyKey: null });
      await tx.insert(payrollImports).values({ ...anImport(a, "1".repeat(64)), idempotencyKey: null });
    });
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(payrollImports).values({ ...anImport(a, "2".repeat(64)), idempotencyKey: "k1" }),
      ),
      "payroll_imports_user_idem_uq",
    );
  });

  it("one import yields at most one record, and one live record per (user, period, kind)", async () => {
    const { db, a } = await twoUsers();
    const importIds = await withSystemContext(db, async (tx) => {
      const rows = await tx
        .insert(payrollImports)
        .values([anImport(a, "3".repeat(64)), anImport(a, "4".repeat(64))])
        .returning();
      return rows.map((r) => r.id);
    });
    const period = { periodStart: "2026-08-01", periodEnd: "2026-08-31", kind: "ordinary" as const };
    const firstRecordId = await withUserContext(db, { userId: a }, async (tx) => {
      const [rec] = await tx
        .insert(payrollRecords)
        .values({ userId: a, importId: importIds[0]!, ...period })
        .returning();
      return rec!.id;
    });
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(payrollRecords).values({
          userId: a,
          importId: importIds[0]!,
          ...period,
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
        }),
      ),
      "payroll_records_import_uq",
    );
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(payrollRecords).values({ userId: a, importId: importIds[1]!, ...period }),
      ),
      "payroll_records_period_uq",
    );
    // Superseding the first frees the period: the partial index only covers live rows.
    await withUserContext(db, { userId: a }, async (tx) => {
      await tx
        .update(payrollRecords)
        .set({ supersededAt: new Date() })
        .where(eq(payrollRecords.id, firstRecordId));
      await tx.insert(payrollRecords).values({ userId: a, importId: importIds[1]!, ...period });
    });
    const live = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollRecords));
    expect(live.filter((r) => r.supersededAt === null).length).toBe(1);
  });
});

/**
 * `payroll_mapping_rules` mixes global (`user_id IS NULL`) and private rows,
 * so it carries four per-command policies rather than one USING/WITH CHECK
 * pair. WITH CHECK is never evaluated for DELETE, and a single pair would let
 * any user delete a global rule or hijack one by re-owning it via UPDATE.
 */
describe("payroll_mapping_rules — the four-policy shape", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  const aMappingRule = (userId: string | null, matchCode: string) => ({
    userId,
    matchCode,
    componentKind: "earning" as const,
    target: { kind: "category" as const, ref: "salary" },
  });

  it("a user can SELECT a NULL-owned global rule but not another user's private rule", async () => {
    const { db, a, b } = await twoUsers();
    const [globalRule, privateRule] = await withSystemContext(db, (tx) =>
      tx
        .insert(payrollMappingRules)
        .values([aMappingRule(null, "GLOBAL"), aMappingRule(b, "PRIVATE")])
        .returning(),
    );
    const asA = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollMappingRules));
    expect(asA.map((r) => r.id)).toEqual([globalRule!.id]);
    const asB = await withUserContext(db, { userId: b }, (tx) => tx.select().from(payrollMappingRules));
    expect(asB.map((r) => r.id).sort()).toEqual([globalRule!.id, privateRule!.id].sort());
  });

  it("a user's UPDATE/DELETE targeting a NULL-owned global rule affects zero rows, including an attempted ownership hijack", async () => {
    const { db, a } = await twoUsers();
    const [globalRule] = await withSystemContext(db, (tx) =>
      tx.insert(payrollMappingRules).values(aMappingRule(null, "GLOBAL2")).returning(),
    );
    const updateResult = await withUserContext(db, { userId: a }, (tx) =>
      tx
        .update(payrollMappingRules)
        .set({ userId: a, priority: 1 })
        .where(eq(payrollMappingRules.id, globalRule!.id)),
    );
    expect(updateResult.rowCount).toBe(0);
    const deleteResult = await withUserContext(db, { userId: a }, (tx) =>
      tx.delete(payrollMappingRules).where(eq(payrollMappingRules.id, globalRule!.id)),
    );
    expect(deleteResult.rowCount).toBe(0);
    const stillThereAndUnowned = await withSystemContext(db, (tx) => tx.select().from(payrollMappingRules));
    expect(stillThereAndUnowned.map((r) => ({ id: r.id, userId: r.userId }))).toEqual([
      { id: globalRule!.id, userId: null },
    ]);
  });

  it("a user's UPDATE/DELETE targeting another user's private rule affects zero rows", async () => {
    const { db, a, b } = await twoUsers();
    const [privateRule] = await withSystemContext(db, (tx) =>
      tx.insert(payrollMappingRules).values(aMappingRule(b, "PRIVATE2")).returning(),
    );
    const updateResult = await withUserContext(db, { userId: a }, (tx) =>
      tx.update(payrollMappingRules).set({ priority: 1 }).where(eq(payrollMappingRules.id, privateRule!.id)),
    );
    expect(updateResult.rowCount).toBe(0);
    const deleteResult = await withUserContext(db, { userId: a }, (tx) =>
      tx.delete(payrollMappingRules).where(eq(payrollMappingRules.id, privateRule!.id)),
    );
    expect(deleteResult.rowCount).toBe(0);
  });

  it("system context can read, write, and delete any mapping rule regardless of owner", async () => {
    const { db, b } = await twoUsers();
    const [rule] = await withSystemContext(db, (tx) =>
      tx.insert(payrollMappingRules).values(aMappingRule(b, "SYS")).returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.update(payrollMappingRules).set({ priority: 5 }).where(eq(payrollMappingRules.id, rule!.id)),
    );
    const afterUpdate = await withSystemContext(db, (tx) => tx.select().from(payrollMappingRules));
    expect(afterUpdate.find((r) => r.id === rule!.id)?.priority).toBe(5);
    const deleteResult = await withSystemContext(db, (tx) =>
      tx.delete(payrollMappingRules).where(eq(payrollMappingRules.id, rule!.id)),
    );
    expect(deleteResult.rowCount).toBe(1);
  });
});

describe("funds constraints", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("rejects duplicate payroll contributions but allows different component types", async () => {
    const { db, a } = await twoUsers();
    const { fundId, recordId } = await withSystemContext(db, async (tx) => ({
      fundId: await aFund(tx, a),
      recordId: await aPayrollRecord(tx, a, "5".repeat(64)),
    }));
    const input = { ...contribution(fundId), source: "payroll", payrollRecordId: recordId };
    await withUserContext(db, { userId: a }, (tx) => tx.insert(fundContributions).values(input));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) => tx.insert(fundContributions).values(input)),
      "fund_contributions_payroll_uq",
    );
    await withUserContext(db, { userId: a }, (tx) =>
      tx.insert(fundContributions).values({ ...input, typeCode: "employer" }),
    );
    expect(await withUserContext(db, { userId: a }, (tx) => tx.select().from(fundContributions))).toHaveLength(2);
  });

  it("allows only one system fee per posting month while permitting manual fees", async () => {
    const { db, a } = await twoUsers();
    const fundId = await withSystemContext(db, (tx) => aFund(tx, a));
    const input = { ...contribution(fundId), typeCode: "fee", source: "system", amount: "-3.00" };
    await withUserContext(db, { userId: a }, (tx) => tx.insert(fundContributions).values(input));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) => tx.insert(fundContributions).values(input)),
      "fund_contributions_system_fee_uq",
    );
    await withUserContext(db, { userId: a }, (tx) =>
      tx
        .insert(fundContributions)
        .values([{ ...input, source: "manual" }, { ...input, postedMonth: "2026-07-01" }]),
    );
    expect(await withUserContext(db, { userId: a }, (tx) => tx.select().from(fundContributions))).toHaveLength(3);
  });

  it("allows a repeated reconciliation issue key only after the first is resolved", async () => {
    const { db, a } = await twoUsers();
    const fundId = await withSystemContext(db, (tx) => aFund(tx, a));
    const input = {
      userId: a,
      domain: "funds",
      entityType: "fund_month",
      entityId: `${fundId}:2026-01-01`,
      kind: "missing",
    };
    const [issue] = await withUserContext(db, { userId: a }, (tx) =>
      tx.insert(reconciliationIssues).values(input).returning(),
    );
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) => tx.insert(reconciliationIssues).values(input)),
      "reconciliation_issues_live_uq",
    );
    await withUserContext(db, { userId: a }, (tx) =>
      tx
        .update(reconciliationIssues)
        .set({ status: "acknowledged" })
        .where(eq(reconciliationIssues.id, issue!.id)),
    );
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) => tx.insert(reconciliationIssues).values(input)),
      "reconciliation_issues_live_uq",
    );
    await withUserContext(db, { userId: a }, (tx) =>
      tx
        .update(reconciliationIssues)
        .set({ status: "resolved", resolvedBy: a, resolvedAt: new Date() })
        .where(eq(reconciliationIssues.id, issue!.id)),
    );
    await withUserContext(db, { userId: a }, (tx) => tx.insert(reconciliationIssues).values(input));
    expect(await withUserContext(db, { userId: a }, (tx) => tx.select().from(reconciliationIssues))).toHaveLength(2);
  });

  it("retains the contribution catalogue across database resets", async () => {
    const db = await testDb();
    await resetDb();
    expect(
      await db
        .select({ code: fundContributionTypes.code, sign: fundContributionTypes.sign })
        .from(fundContributionTypes)
        .orderBy(fundContributionTypes.code),
    ).toEqual([
      { code: "adjustment", sign: 0 },
      { code: "employee", sign: 1 },
      { code: "employer", sign: 1 },
      { code: "fee", sign: -1 },
      { code: "reversal", sign: -1 },
      { code: "voluntary", sign: 1 },
    ]);
  });
});

describe("budgets constraints", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("rejects a second scope-matched usage for the same transaction", async () => {
    const { db, a } = await twoUsers();
    const { budgetId, transactionId } = await withSystemContext(db, async (tx) => ({
      budgetId: await aBudget(tx, a),
      transactionId: await aTransaction(tx, a),
    }));
    const usage = {
      budgetId,
      transactionId,
      amount: "10.00",
      occurredAt: "2026-01-05",
      matchedBy: "scope" as const,
    };
    await withUserContext(db, { userId: a }, (tx) => tx.insert(budgetUsages).values(usage));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) => tx.insert(budgetUsages).values(usage)),
      "budget_usages_tx_uq",
    );
  });

  it("rejects an account-sourced allocation with no source id", async () => {
    const { db, a } = await twoUsers();
    const budgetId = await withSystemContext(db, (tx) => aBudget(tx, a));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(budgetAllocations).values({
          budgetId,
          sourceKind: "account",
          sourceId: null,
          amount: "50.00",
          effectiveFrom: "2026-01-01",
        }),
      ),
      "budget_allocations_source_id_ck",
    );
  });

  it("rejects a manual usage that carries a transaction id", async () => {
    const { db, a } = await twoUsers();
    const { budgetId, transactionId } = await withSystemContext(db, async (tx) => ({
      budgetId: await aBudget(tx, a),
      transactionId: await aTransaction(tx, a),
    }));
    await rejectsWith(
      withUserContext(db, { userId: a }, (tx) =>
        tx.insert(budgetUsages).values({
          budgetId,
          transactionId,
          amount: "10.00",
          occurredAt: "2026-01-05",
          matchedBy: "manual",
        }),
      ),
      "budget_usages_tx_ck",
    );
  });
});

describe("interests constraints", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("rejects a second accrual for the same rule and day", async () => {
    const { db, a } = await twoUsers();
    const ruleId = await withSystemContext(db, async (tx) => {
      const accountId = await anAccount(tx, a);
      const [rule] = await tx
        .insert(interestRules)
        .values({ userId: a, accountId, annualRate: "0.0225", taxRate: "0.26", effectiveFrom: "2026-01-01" })
        .returning();
      return rule!.id;
    });
    const accrual = {
      ruleId,
      accrualDate: "2026-01-02",
      balanceBasis: "1000.00",
      gross: "0.061644",
      tax: "0.016027",
      net: "0.05",
      carryAfter: "0.000000",
    };
    await withSystemContext(db, (tx) => tx.insert(interestAccruals).values(accrual));
    await rejectsWith(
      withSystemContext(db, (tx) => tx.insert(interestAccruals).values(accrual)),
      "interest_accruals_rule_date_uq",
    );
  });
});

describe("integrations constraints", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("accepts a queued run and a job carrying a cursor", async () => {
    const { db, a } = await twoUsers();
    const { run, job } = await withSystemContext(db, async (tx) => {
      const connectionId = await aConnection(tx, a);
      const [createdJob] = await tx
        .insert(syncJobs)
        .values({ connectionId, kind: "accounts", schedule: "daily", cursor: { page: 3 } })
        .returning();
      const [createdRun] = await tx
        .insert(syncRuns)
        .values({ connectionId, jobId: createdJob!.id, kind: "accounts", status: "queued", trigger: "webhook" })
        .returning();
      return { run: createdRun!, job: createdJob! };
    });

    expect(run.status).toBe("queued");
    expect(run.jobId).toBe(job.id);
    expect(job.cursor).toEqual({ page: 3 });
    expect(job.enabled).toBe(true);
  });
});
