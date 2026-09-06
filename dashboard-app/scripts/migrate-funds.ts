import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbClient } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  accountBalances,
  accounts,
  auditEvents,
  balanceSnapshots,
  fundContributionSchedules,
  fundContributions,
  fundDeposits,
  fundPlans,
  fundSettings,
  funds,
  legacyFunds,
  payrollRecords,
  userRoles,
  users,
} from "@/lib/db/schema";
import { romeDate } from "@/lib/time";
import { accrualPeriodFor, postedMonthFor, type ScheduleRule } from "@/modules/funds/domain/schedule";
import { withSystemContext } from "@/platform/db/context";

/**
 * Idempotent legacy-funds migration. The executable fixture and exact commands
 * live in scripts/funds-migration-fixture.sql.
 *
 * Run in source checkouts:
 *   DATABASE_URL=... npm run migrate:funds
 * Run from the standalone image:
 *   node /app/migrate-funds.mjs
 *
 * The legacy tables are frozen inputs. This script never updates or deletes
 * them, and conflict handling never overwrites an existing new-model row.
 */

class MigrationInputError extends Error {}

interface Counts {
  funds: number;
  fundLinks: number;
  accounts: number;
  accountBalances: number;
  auditEvents: number;
  plans: number;
  schedules: number;
  contributions: number;
}

interface CanonicalSnapshot extends Record<string, unknown> {
  accountKey: string;
  month: string;
  balance: string;
  capturedAt: Date | string;
}

const ZERO_COUNTS: Counts = {
  funds: 0,
  fundLinks: 0,
  accounts: 0,
  accountBalances: 0,
  auditEvents: 0,
  plans: 0,
  schedules: 0,
  contributions: 0,
};

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;
const SNAPSHOT_ACCOUNT_ACTION = "funds.migration.snapshot_account_created";
const LEGACY_SNAPSHOT_NOTE_PREFIX = "created by funds migration from balance_snapshots:";

function moneyCents(value: string): bigint {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new MigrationInputError(`Invalid legacy money value: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  if (fraction.length > 2) throw new MigrationInputError(`Legacy money has more than two decimals: ${value}`);
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

function ruleFor(slug: string): ScheduleRule {
  return slug === "cometa"
    ? { frequency: "quarterly", periodAnchorMonth: 1, postingLagMonths: 1, feePerPosting: "3.00" }
    : { frequency: "monthly", periodAnchorMonth: 1, postingLagMonths: 0, feePerPosting: "0.00" };
}

async function resolveOwner(tx: DbClient): Promise<{ id: string; currency: string }> {
  const rows = await tx
    .selectDistinct({ id: users.id, currency: users.currency })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.roleCode, "owner")))
    .limit(2);
  if (rows.length !== 1) {
    throw new MigrationInputError(`Expected exactly one owner, found ${rows.length}; refusing to guess`);
  }
  return rows[0]!;
}

async function canonicalSnapshots(
  tx: DbClient,
  legacy: { slug: string; name: string },
): Promise<CanonicalSnapshot[]> {
  const keys = await tx
    .selectDistinct({ accountKey: balanceSnapshots.accountKey })
    .from(balanceSnapshots)
    .where(sql`lower(${balanceSnapshots.accountKey}) IN (lower(${legacy.slug}), lower(${legacy.name}))`);
  if (keys.length === 0) {
    throw new MigrationInputError(
      `No balance_snapshots history matches legacy fund ${legacy.slug} (tried slug and name)`,
    );
  }
  if (keys.length > 1) {
    throw new MigrationInputError(
      `Ambiguous balance_snapshots history for ${legacy.slug}: ${keys.map((row) => row.accountKey).join(", ")}`,
    );
  }

  const result = await tx.execute<CanonicalSnapshot>(sql`
    SELECT DISTINCT ON (account_key, month)
      account_key AS "accountKey",
      to_char(date_trunc('month', captured_at AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-01') AS month,
      balance,
      captured_at AS "capturedAt"
    FROM balance_snapshots
    WHERE account_key = ${keys[0]!.accountKey}
    ORDER BY account_key, month,
             (COALESCE(raw->>'kind', '') = 'latest') ASC,
             captured_at DESC, id DESC
  `);
  return result.rows;
}

async function validatedLinkedAccount(
  tx: DbClient,
  owner: { id: string; currency: string },
  accountId: string,
  slug: string,
  counts: Counts,
): Promise<void> {
  const [row] = await tx
    .select({ id: accounts.id, userId: accounts.userId, currency: accounts.currency, notes: accounts.notes })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row || row.userId !== owner.id || row.currency !== owner.currency) {
    throw new MigrationInputError(
      `Fund ${slug} links account ${accountId}, but it is missing, belongs to another owner, or uses another currency`,
    );
  }
  const [latest] = await tx
    .select({ id: accountBalances.id })
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId))
    .limit(1);
  if (!latest) throw new MigrationInputError(`Fund ${slug}'s existing linked account has no valuation history`);
  await backfillSnapshotAccountProvenance(tx, row.id, row.notes, counts);
}

async function recordSnapshotAccountProvenance(
  tx: DbClient,
  accountId: string,
  snapshotAccountKey: string,
  counts: Counts,
): Promise<void> {
  const existing = await tx
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.action, SNAPSHOT_ACCOUNT_ACTION),
      eq(auditEvents.entityType, "account"),
      eq(auditEvents.entityId, accountId),
    ))
    .limit(1);
  if (existing.length > 0) return;
  const inserted = await tx.insert(auditEvents).values({
    actorUserId: null,
    action: SNAPSHOT_ACCOUNT_ACTION,
    entityType: "account",
    entityId: accountId,
    before: null,
    after: { snapshotAccountKey },
    requestId: "migrate-funds",
    ip: null,
  }).returning({ id: auditEvents.id });
  counts.auditEvents += inserted.length;
}

async function backfillSnapshotAccountProvenance(
  tx: DbClient,
  accountId: string,
  notes: string | null,
  counts: Counts,
): Promise<void> {
  if (!notes?.startsWith(LEGACY_SNAPSHOT_NOTE_PREFIX)) return;
  const snapshotAccountKey = notes.slice(LEGACY_SNAPSHOT_NOTE_PREFIX.length);
  if (!snapshotAccountKey) {
    throw new MigrationInputError(`Account ${accountId} has an invalid legacy funds-migration provenance note`);
  }
  const [snapshot] = await tx
    .select({ id: balanceSnapshots.id })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.accountKey, snapshotAccountKey))
    .limit(1);
  if (!snapshot) {
    throw new MigrationInputError(
      `Account ${accountId} claims snapshot key ${snapshotAccountKey}, but that frozen history is missing`,
    );
  }
  await recordSnapshotAccountProvenance(tx, accountId, snapshotAccountKey, counts);
}

async function resolveOrCreateAccount(
  tx: DbClient,
  owner: { id: string; currency: string },
  legacy: { slug: string; name: string },
  counts: Counts,
): Promise<string> {
  const matches = await tx
    .select({ id: accounts.id, currency: accounts.currency, notes: accounts.notes })
    .from(accounts)
    .where(and(eq(accounts.userId, owner.id), sql`lower(${accounts.name}) = lower(${legacy.name})`))
    .limit(2);
  if (matches.length > 1) {
    throw new MigrationInputError(
      `Ambiguous account name for ${legacy.slug}: found ${matches.length} owner accounts named ${legacy.name}`,
    );
  }
  if (matches.length === 1) {
    const match = matches[0]!;
    if (match.currency !== owner.currency) {
      throw new MigrationInputError(
        `Account ${legacy.name} uses ${match.currency}, expected owner currency ${owner.currency}`,
      );
    }
    const [balance] = await tx
      .select({ id: accountBalances.id })
      .from(accountBalances)
      .where(eq(accountBalances.accountId, match.id))
      .limit(1);
    if (!balance) {
      throw new MigrationInputError(`Existing account ${legacy.name} has no valuation history; refusing to fabricate one`);
    }
    await backfillSnapshotAccountProvenance(tx, match.id, match.notes, counts);
    return match.id;
  }

  const snapshots = await canonicalSnapshots(tx, legacy);
  const [created] = await tx
    .insert(accounts)
    .values({
      userId: owner.id,
      groupId: null,
      name: legacy.name,
      type: legacy.slug === "cometa" ? "pension_fund" : "investment",
      currency: owner.currency,
      origin: "manual",
      provider: null,
      status: "active",
      includeInNetWorth: true,
      notes: `${LEGACY_SNAPSHOT_NOTE_PREFIX}${snapshots[0]!.accountKey}`,
      sortOrder: 0,
    })
    .returning({ id: accounts.id });
  if (!created) throw new Error(`Failed to create valuation account for ${legacy.slug}`);
  counts.accounts += 1;
  await recordSnapshotAccountProvenance(tx, created.id, snapshots[0]!.accountKey, counts);

  for (const snapshot of snapshots) {
    const capturedAt = snapshot.capturedAt instanceof Date
      ? snapshot.capturedAt
      : new Date(snapshot.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new MigrationInputError(`Invalid snapshot timestamp for ${legacy.slug}: ${snapshot.capturedAt}`);
    }
    const inserted = await tx
      .insert(accountBalances)
      .values({
        accountId: created.id,
        asOf: romeDate(capturedAt),
        balance: snapshot.balance,
        available: null,
        source: "migration",
        capturedAt,
      })
      .onConflictDoNothing({
        target: [accountBalances.accountId, accountBalances.asOf, accountBalances.source],
      })
      .returning({ id: accountBalances.id });
    counts.accountBalances += inserted.length;
  }
  return created.id;
}

async function migrate(tx: DbClient): Promise<Counts> {
  const counts = { ...ZERO_COUNTS };
  const owner = await resolveOwner(tx);
  const legacyRows = await tx.select().from(legacyFunds).orderBy(asc(legacyFunds.id));
  if (legacyRows.length === 0) throw new MigrationInputError("No legacy_funds rows found");

  const allSettings = await tx.select().from(fundSettings).orderBy(asc(fundSettings.effectiveFrom));
  const allDeposits = await tx.select().from(fundDeposits).orderBy(asc(fundDeposits.month));
  const livePayroll = await tx
    .select({ id: payrollRecords.id, periodStart: payrollRecords.periodStart })
    .from(payrollRecords)
    .where(and(
      eq(payrollRecords.userId, owner.id),
      eq(payrollRecords.kind, "ordinary"),
      isNull(payrollRecords.supersededAt),
    ));
  const payrollByMonth = new Map(livePayroll.map((row) => [row.periodStart, row.id]));

  for (const legacy of legacyRows) {
    const insertedFunds = await tx
      .insert(funds)
      .values({
        userId: owner.id,
        slug: legacy.slug,
        name: legacy.name,
        kind: legacy.slug === "cometa" ? "pension" : "investment",
        currency: owner.currency,
      })
      .onConflictDoNothing({ target: [funds.userId, funds.slug] })
      .returning({ id: funds.id });
    counts.funds += insertedFunds.length;

    const [fund] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.userId, owner.id), eq(funds.slug, legacy.slug)))
      .limit(1);
    if (!fund) throw new Error(`Failed to resolve migrated fund ${legacy.slug}`);
    if (fund.currency !== owner.currency) {
      throw new MigrationInputError(
        `Fund ${legacy.slug} uses ${fund.currency}, expected owner currency ${owner.currency}`,
      );
    }

    if (fund.accountId) {
      await validatedLinkedAccount(tx, owner, fund.accountId, legacy.slug, counts);
    } else {
      const accountId = await resolveOrCreateAccount(tx, owner, legacy, counts);
      const linked = await tx
        .update(funds)
        .set({ accountId })
        .where(and(eq(funds.id, fund.id), isNull(funds.accountId)))
        .returning({ id: funds.id });
      counts.fundLinks += linked.length;
    }

    const settings = allSettings.filter((row) => row.fundId === legacy.id);
    const deposits = allDeposits.filter((row) => row.fundId === legacy.id);
    for (const setting of settings) {
      const inserted = await tx
        .insert(fundPlans)
        .values({
          fundId: fund.id,
          effectiveFrom: setting.effectiveFrom,
          initialCapital: setting.initialCapital,
          fixedMonthlyAmount: setting.depositMode === "fixed" ? setting.fixedMonthlyAmount : null,
          note: `migrated from fund_settings#${setting.id}`,
        })
        .onConflictDoNothing({ target: [fundPlans.fundId, fundPlans.effectiveFrom] })
        .returning({ id: fundPlans.id });
      counts.plans += inserted.length;
    }

    const earliestSetting = settings[0] ?? null;
    const effectiveFrom = earliestSetting?.effectiveFrom ?? deposits[0]?.month ?? null;
    if (!effectiveFrom) {
      console.warn(`warning: ${legacy.slug} has no settings or deposits; no schedule/contributions created`);
      continue;
    }
    const rule = ruleFor(legacy.slug);
    const insertedSchedule = await tx
      .insert(fundContributionSchedules)
      .values({
        fundId: fund.id,
        frequency: rule.frequency,
        periodAnchorMonth: rule.periodAnchorMonth,
        postingLagMonths: rule.postingLagMonths,
        feePerPosting: rule.feePerPosting,
        effectiveFrom,
      })
      .onConflictDoNothing({
        target: [fundContributionSchedules.fundId, fundContributionSchedules.effectiveFrom],
      })
      .returning({ id: fundContributionSchedules.id });
    counts.schedules += insertedSchedule.length;

    if (earliestSetting && moneyCents(earliestSetting.initialCapital) !== 0n) {
      const note = `migrated opening from fund_settings#${earliestSetting.id}`;
      const [existing] = await tx
        .select({ id: fundContributions.id })
        .from(fundContributions)
        .where(and(eq(fundContributions.fundId, fund.id), eq(fundContributions.note, note)))
        .limit(1);
      if (!existing) {
        const inserted = await tx.insert(fundContributions).values({
          fundId: fund.id,
          typeCode: "adjustment",
          accrualPeriodStart: earliestSetting.effectiveFrom,
          accrualPeriodEnd: earliestSetting.effectiveFrom,
          postedMonth: earliestSetting.effectiveFrom,
          valueDate: earliestSetting.effectiveFrom,
          amount: earliestSetting.initialCapital,
          currency: owner.currency,
          source: "migration",
          payrollRecordId: null,
          note,
          reconciliationStatus: "received",
        }).returning({ id: fundContributions.id });
        counts.contributions += inserted.length;
      }
    }

    const payrollPostingPeriods = new Map<string, { start: string; end: string }>();
    for (const deposit of deposits) {
      const note = `migrated from fund_deposits#${deposit.id}`;
      const [existing] = await tx
        .select({ id: fundContributions.id })
        .from(fundContributions)
        .where(and(eq(fundContributions.fundId, fund.id), eq(fundContributions.note, note)))
        .limit(1);
      const period = accrualPeriodFor(deposit.month, rule);
      const postedMonth = postedMonthFor(deposit.month, rule);
      if (deposit.source === "payroll") payrollPostingPeriods.set(postedMonth, period);
      if (existing) continue;

      const payrollRecordId = deposit.source === "payroll"
        ? (payrollByMonth.get(deposit.month) ?? null)
        : null;
      const parts = deposit.source === "payroll" && deposit.employeePart !== null && deposit.employerPart !== null
        ? [
            { typeCode: "employee", amount: deposit.employeePart },
            { typeCode: "employer", amount: deposit.employerPart },
          ]
        : [{ typeCode: deposit.source === "payroll" ? "employee" : "voluntary", amount: deposit.amount }];
      for (const part of parts) {
        const inserted = await tx.insert(fundContributions).values({
          fundId: fund.id,
          typeCode: part.typeCode,
          accrualPeriodStart: period.start,
          accrualPeriodEnd: period.end,
          postedMonth,
          valueDate: null,
          amount: part.amount,
          currency: owner.currency,
          source: "migration",
          payrollRecordId,
          note,
          reconciliationStatus: "received",
        }).returning({ id: fundContributions.id });
        counts.contributions += inserted.length;
      }
    }

    if (legacy.slug === "cometa" && payrollPostingPeriods.size > 0) {
      for (const [postedMonth, period] of [...payrollPostingPeriods].sort(([a], [b]) => a.localeCompare(b))) {
        const [existingFee] = await tx
          .select({ id: fundContributions.id })
          .from(fundContributions)
          .where(and(
            eq(fundContributions.fundId, fund.id),
            eq(fundContributions.postedMonth, postedMonth),
            eq(fundContributions.typeCode, "fee"),
            eq(fundContributions.source, "system"),
          ))
          .limit(1);
        if (!existingFee) {
          const inserted = await tx.insert(fundContributions).values({
            fundId: fund.id,
            typeCode: "fee",
            accrualPeriodStart: period.start,
            accrualPeriodEnd: period.end,
            postedMonth,
            valueDate: null,
            amount: "-3.00",
            currency: owner.currency,
            source: "system",
            payrollRecordId: null,
            note: `migration quarterly fee ${postedMonth}`,
            reconciliationStatus: "received",
          }).returning({ id: fundContributions.id });
          counts.contributions += inserted.length;
        }
      }

      const [joining] = await tx
        .select({ id: fundContributions.id })
        .from(fundContributions)
        .where(and(
          eq(fundContributions.fundId, fund.id),
          eq(fundContributions.typeCode, "fee"),
          eq(fundContributions.source, "migration"),
          eq(fundContributions.note, "joining fee"),
        ))
        .limit(1);
      if (!joining) {
        const [first] = [...payrollPostingPeriods].sort(([a], [b]) => a.localeCompare(b));
        const [postedMonth, period] = first!;
        const inserted = await tx.insert(fundContributions).values({
          fundId: fund.id,
          typeCode: "fee",
          accrualPeriodStart: period.start,
          accrualPeriodEnd: period.end,
          postedMonth,
          valueDate: null,
          amount: "-10.32",
          currency: owner.currency,
          source: "migration",
          payrollRecordId: null,
          note: "joining fee",
          reconciliationStatus: "received",
        }).returning({ id: fundContributions.id });
        counts.contributions += inserted.length;
      }
    }
  }
  return counts;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool, { schema });
    const counts = await withSystemContext(db, migrate);
    const writes = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(JSON.stringify({ ...counts, writes }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof MigrationInputError ? 2 : 1;
  } finally {
    await pool.end();
  }
}

void main();
