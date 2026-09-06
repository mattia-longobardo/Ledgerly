import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbClient } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  budgetAllocations,
  budgetAmountVersions,
  budgetUsages,
  budgets,
  userRoles,
  users,
  vacationAccrualRate,
  vacationLedger,
} from "@/lib/db/schema";
import { monthKeyOf, monthRange, romeDate } from "@/lib/time";
import { allocatedThrough, type AllocationLike } from "@/modules/budgets/domain/figures";
import { withSystemContext } from "@/platform/db/context";

/**
 * Idempotent legacy Vacation-fund migration: converts `vacation_ledger` and
 * `vacation_accrual_rate` into a "Holidays" budget (Phase 6 Task 7).
 *
 * Run in source checkouts:
 *   DATABASE_URL=... npm run migrate:vacation
 *
 * The legacy tables are frozen inputs. This script never updates or deletes
 * them, and conflict handling never overwrites an existing new-model row.
 *
 * R6-4: `vacation_ledger` `accrual` rows are the recorded, historical result
 * of the accrual rates; they are not copied. Instead each rate becomes a
 * `monthly` allocation (R6-2), and for every month from `start_date` through
 * today, the running total that `allocatedThrough` derives from those rate
 * allocations is compared with the running total of the ledger's own
 * `accrual` rows. Any incremental gap is inserted as a `once` "migration
 * adjustment" allocation dated on that month, so the budget's `remaining`
 * matches the legacy balance to the cent at every historical month, not just
 * today.
 */

class MigrationInputError extends Error {}

interface Counts {
  budgets: number;
  versions: number;
  rateAllocations: number;
  withdrawalUsages: number;
  adjustmentAllocations: number;
  reconciliationAllocations: number;
}

const ZERO_COUNTS: Counts = {
  budgets: 0,
  versions: 0,
  rateAllocations: 0,
  withdrawalUsages: 0,
  adjustmentAllocations: 0,
  reconciliationAllocations: 0,
};

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function cents(value: string): bigint {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new MigrationInputError(`Invalid legacy money value: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  if (fraction.length > 2) throw new MigrationInputError(`Legacy money has more than two decimals: ${value}`);
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

function absCents(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Last calendar day of a "YYYY-MM-01" month key, as "YYYY-MM-DD". */
function lastDayOfMonth(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function subtractOneDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/** `month` when present (initial/accrual rows), else the Rome civil date of `occurred_at`. */
function dateOf(entry: { month: string | null; occurredAt: Date }): string {
  return entry.month ?? romeDate(entry.occurredAt);
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

async function migrate(tx: DbClient): Promise<Counts | null> {
  const ledgerRows = await tx.select().from(vacationLedger).orderBy(asc(vacationLedger.id));
  const rateRows = await tx.select().from(vacationAccrualRate).orderBy(asc(vacationAccrualRate.effectiveFrom));
  if (ledgerRows.length === 0 && rateRows.length === 0) return null;

  const counts = { ...ZERO_COUNTS };
  const owner = await resolveOwner(tx);

  const initialRow = ledgerRows.find((row) => row.entryType === "initial") ?? null;
  const accrualRows = ledgerRows.filter((row) => row.entryType === "accrual");
  const withdrawalRows = ledgerRows.filter((row) => row.entryType === "withdrawal");
  const adjustmentRows = ledgerRows.filter((row) => row.entryType === "adjustment");

  // start_date: earliest of the initial entry's month and the first rate's effective_from.
  const initialDate = initialRow ? dateOf(initialRow) : null;
  const firstRateFrom = rateRows[0]?.effectiveFrom ?? null;
  const startCandidates = [initialDate, firstRateFrom].filter((v): v is string => v !== null);
  let startDate: string;
  if (startCandidates.length > 0) {
    startDate = startCandidates.reduce((min, v) => (v < min ? v : min));
  } else {
    // Defensive fallback for a ledger with only withdrawal/adjustment rows and
    // no rates: not covered by the brief's fixture, but avoids fabricating a date.
    const earliest = [...ledgerRows].sort((a, b) => dateOf(a).localeCompare(dateOf(b)))[0];
    if (!earliest) throw new MigrationInputError("No initial entry, rate, or ledger row to derive a start date from");
    startDate = dateOf(earliest);
  }

  // Step 2: upsert the "Holidays" budget. Idempotency key: name "Holidays" + labels containing "migrated".
  const existingBudgets = await tx
    .select()
    .from(budgets)
    .where(and(
      eq(budgets.userId, owner.id),
      eq(budgets.name, "Holidays"),
      sql`${budgets.labels} @> '["migrated"]'::jsonb`,
    ))
    .limit(2);
  if (existingBudgets.length > 1) {
    throw new MigrationInputError(`Ambiguous Holidays budget: found ${existingBudgets.length}`);
  }
  let budget = existingBudgets[0] ?? null;
  if (!budget) {
    const [created] = await tx
      .insert(budgets)
      .values({
        userId: owner.id,
        name: "Holidays",
        description: "Migrated from the Vacation fund",
        currency: owner.currency,
        periodKind: "none",
        startDate,
        labels: ["migrated"],
      })
      .returning();
    if (!created) throw new Error("Failed to create Holidays budget");
    budget = created;
    counts.budgets += 1;
  }

  // Step 3: the initial amount version.
  const versionEffectiveFrom = initialRow ? dateOf(initialRow) : startDate;
  const versionAmount = initialRow ? initialRow.amount : "0.00";
  const insertedVersion = await tx
    .insert(budgetAmountVersions)
    .values({
      budgetId: budget.id,
      initialAmount: versionAmount,
      effectiveFrom: versionEffectiveFrom,
      reason: "migrated",
    })
    .onConflictDoNothing({ target: [budgetAmountVersions.budgetId, budgetAmountVersions.effectiveFrom] })
    .returning({ id: budgetAmountVersions.id });
  counts.versions += insertedVersion.length;

  // Step 4: each accrual rate becomes a `monthly` allocation with sourceKind "none" (R6-1, R6-2).
  // effectiveTo is the next rate's effective_from minus one day, or null for the last rate.
  const rateAllocations: AllocationLike[] = rateRows.map((rate, i) => ({
    id: "", // unused by allocatedThrough; AllocationLike requires the field
    amount: rate.monthlyAmount,
    recurrence: "monthly",
    effectiveFrom: rate.effectiveFrom,
    effectiveTo: i < rateRows.length - 1 ? subtractOneDay(rateRows[i + 1]!.effectiveFrom) : null,
    sourceKind: "none",
    sourceId: null,
  }));
  for (const rate of rateAllocations) {
    const existing = await tx
      .select({ id: budgetAllocations.id })
      .from(budgetAllocations)
      .where(and(
        eq(budgetAllocations.budgetId, budget.id),
        eq(budgetAllocations.recurrence, "monthly"),
        eq(budgetAllocations.effectiveFrom, rate.effectiveFrom),
        eq(budgetAllocations.note, "migrated accrual rate"),
      ))
      .limit(1);
    if (existing.length === 0) {
      const inserted = await tx
        .insert(budgetAllocations)
        .values({
          budgetId: budget.id,
          sourceKind: "none",
          sourceId: null,
          amount: rate.amount,
          recurrence: "monthly",
          effectiveFrom: rate.effectiveFrom,
          effectiveTo: rate.effectiveTo,
          note: "migrated accrual rate",
        })
        .returning({ id: budgetAllocations.id });
      counts.rateAllocations += inserted.length;
    }
  }

  // Step 5a: `withdrawal` rows become manual usages. `amount = |amount|` because usages are
  // always positive spend (figures.usedThrough subtracts them); the legacy ledger amount is
  // signed. The ledger id is folded into the note because budget_usages has no natural
  // unique key for manual rows (unlike scope-matched rows, which key on transaction_id).
  for (const withdrawal of withdrawalRows) {
    const occurredAt = dateOf(withdrawal);
    const amount = formatCents(absCents(cents(withdrawal.amount)));
    const note = withdrawal.note
      ? `${withdrawal.note} (migrated from vacation_ledger#${withdrawal.id})`
      : `migrated from vacation_ledger#${withdrawal.id}`;
    const existing = await tx
      .select({ id: budgetUsages.id })
      .from(budgetUsages)
      .where(and(eq(budgetUsages.budgetId, budget.id), eq(budgetUsages.matchedBy, "manual"), eq(budgetUsages.note, note)))
      .limit(1);
    if (existing.length === 0) {
      const inserted = await tx
        .insert(budgetUsages)
        .values({
          budgetId: budget.id,
          transactionId: null,
          amount,
          occurredAt,
          matchedBy: "manual",
          note,
        })
        .returning({ id: budgetUsages.id });
      counts.withdrawalUsages += inserted.length;
    }
  }

  // Step 5b: `adjustment` rows become `once` allocations with the signed amount.
  for (const adjustment of adjustmentRows) {
    const effectiveFrom = dateOf(adjustment);
    const note = `migrated adjustment (vacation_ledger#${adjustment.id})`;
    const existing = await tx
      .select({ id: budgetAllocations.id })
      .from(budgetAllocations)
      .where(and(eq(budgetAllocations.budgetId, budget.id), eq(budgetAllocations.note, note)))
      .limit(1);
    if (existing.length === 0) {
      const inserted = await tx
        .insert(budgetAllocations)
        .values({
          budgetId: budget.id,
          sourceKind: "none",
          sourceId: null,
          amount: adjustment.amount,
          recurrence: "once",
          effectiveFrom,
          effectiveTo: null,
          note,
        })
        .returning({ id: budgetAllocations.id });
      counts.adjustmentAllocations += inserted.length;
    }
  }

  // Step 6 (R6-4): reconcile the rate-derived monthly total against the ledger's actual
  // accrual total, month by month, inserting only the incremental gap so re-running never
  // duplicates a correction already on record.
  const existingReconciliations = await tx
    .select({ effectiveFrom: budgetAllocations.effectiveFrom, amount: budgetAllocations.amount })
    .from(budgetAllocations)
    .where(and(eq(budgetAllocations.budgetId, budget.id), eq(budgetAllocations.note, "migration adjustment")));
  const existingReconciliationByMonth = new Map(
    existingReconciliations.map((row) => [row.effectiveFrom, cents(row.amount)]),
  );

  const today = romeDate();
  const months = monthRange(monthKeyOf(startDate), monthKeyOf(today));
  let runningReconciliation = 0n;
  for (const month of months) {
    const lastDay = lastDayOfMonth(month);
    const rateTotal = cents(allocatedThrough(rateAllocations, lastDay));
    const legacyAccrualTotal = accrualRows
      .filter((row) => dateOf(row) <= lastDay)
      .reduce((sum, row) => sum + cents(row.amount), 0n);
    const targetReconciliation = legacyAccrualTotal - rateTotal;

    const already = existingReconciliationByMonth.get(month);
    if (already !== undefined) {
      runningReconciliation += already;
      continue;
    }
    const incremental = targetReconciliation - runningReconciliation;
    if (incremental !== 0n) {
      const inserted = await tx
        .insert(budgetAllocations)
        .values({
          budgetId: budget.id,
          sourceKind: "none",
          sourceId: null,
          amount: formatCents(incremental),
          recurrence: "once",
          effectiveFrom: month,
          effectiveTo: null,
          note: "migration adjustment",
        })
        .returning({ id: budgetAllocations.id });
      counts.reconciliationAllocations += inserted.length;
      runningReconciliation += incremental;
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
    if (counts === null) {
      console.log("nothing to migrate");
      return;
    }
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
