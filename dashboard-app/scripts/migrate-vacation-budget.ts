import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import type { DbClient } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  budgetAllocations,
  budgetAmountVersions,
  budgetEvents,
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
 * Idempotency for every row this script writes on a legacy row's behalf
 * (rate allocations, withdrawal usages, adjustment allocations, R6-4
 * reconciliation allocations) is keyed on a `budget_events` row, never on
 * `note` text: `AllocationsRepository.update` lets a user edit an
 * allocation's `note` (spec-supported), so a note-keyed re-run would
 * silently double-write real money the moment someone tidies a migrated
 * note. `budget_events` has no update endpoint, so it is safe to key on.
 * Notes on the written rows are purely descriptive.
 *
 * The *budget itself* is resolved the same way: `BudgetPatch` lets a user
 * rename it or edit its labels, so `name = "Holidays" AND labels @>
 * '["migrated"]'` is not a safe idempotency key on its own — the brief
 * mandates it as the migration's identifying shape, but re-running must not
 * trust it blindly. `findExistingMigratedBudget` resolves the budget from
 * `budget_events` first (every budget this script creates gets a "root"
 * migrated event at creation, so this always finds it once one exists,
 * regardless of what a user later does to the budget's name or labels).
 * The name+labels lookup is used only to discover a database that has
 * *never* been migrated; if it instead matches a budget with no migration
 * events, the script aborts rather than guessing whether that budget is an
 * unrelated user budget or the output of the original (pre-`budget_events`)
 * version of this script — silently treating it as "ours" would double
 * every legacy row into it.
 *
 * R6-4: `vacation_ledger` `accrual` rows are the recorded, historical result
 * of the accrual rates; they are not copied. Instead each rate becomes a
 * `monthly` allocation (R6-2), and for every month from `start_date` through
 * the **last month with a legacy `accrual` row** (not "today" — see below),
 * the running total that `allocatedThrough` derives from those rate
 * allocations is compared with the running total of the ledger's own
 * `accrual` rows. Any incremental gap is inserted as a `once` "migration
 * adjustment" allocation dated on that month, so the budget's `remaining`
 * matches the legacy balance to the cent at every historical month up to
 * cutover.
 *
 * The reconciliation horizon is anchored to the last legacy `accrual`
 * month, not to `asOf`/today: past cutover the migrated budget is expected
 * to keep accruing via the real monthly allocation while the frozen ledger
 * does not, so comparing beyond that month is meaningless — and anchoring
 * to frozen data (rather than the wall clock) is what keeps a re-run
 * idempotent a month, or a year, after the first run.
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

/** Idempotency check for a row migrated 1:1 from a legacy row (never keyed on user-editable `note`). */
async function migratedEventExists(tx: DbClient, budgetId: string, table: string, legacyId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: budgetEvents.id })
    .from(budgetEvents)
    .where(and(
      eq(budgetEvents.budgetId, budgetId),
      eq(budgetEvents.kind, "migrated"),
      sql`${budgetEvents.detail} ->> 'table' = ${table}`,
      sql`${budgetEvents.detail} ->> 'legacyId' = ${legacyId}`,
    ))
    .limit(1);
  return rows.length > 0;
}

async function recordMigratedEvent(tx: DbClient, budgetId: string, table: string, legacyId: string): Promise<void> {
  await tx.insert(budgetEvents).values({ budgetId, kind: "migrated", detail: { table, legacyId } });
}

/**
 * Resolves the budget this migration owns without trusting `name`/`labels`,
 * which a user can edit. Primary path: any budget owned by `ownerId` that
 * has at least one `kind: "migrated"` event pointing at it (every budget
 * this script creates gets one immediately, at creation — see the "root"
 * event below — so this is reliable regardless of later renames/relabels).
 * Falls back to name+labels only to discover a database that has never been
 * migrated; a name+labels match with no migration events aborts rather than
 * guessing.
 */
async function findExistingMigratedBudget(tx: DbClient, ownerId: string) {
  const eventRows = await tx
    .select({ budget: budgets })
    .from(budgetEvents)
    .innerJoin(budgets, eq(budgets.id, budgetEvents.budgetId))
    .where(and(eq(budgets.userId, ownerId), eq(budgetEvents.kind, "migrated")));
  const byId = new Map(eventRows.map((row) => [row.budget.id, row.budget]));
  if (byId.size > 1) {
    throw new MigrationInputError(`Migration events point at ${byId.size} different budgets; refusing to guess`);
  }
  if (byId.size === 1) return [...byId.values()][0]!;

  const nameMatches = await tx
    .select()
    .from(budgets)
    .where(and(
      eq(budgets.userId, ownerId),
      eq(budgets.name, "Holidays"),
      sql`${budgets.labels} @> '["migrated"]'::jsonb`,
    ))
    .limit(2);
  if (nameMatches.length > 1) {
    throw new MigrationInputError(`Ambiguous Holidays budget: found ${nameMatches.length}`);
  }
  if (nameMatches.length === 1) {
    throw new MigrationInputError(
      `Found a budget named "Holidays" with labels containing "migrated" (id ${nameMatches[0]!.id}), but no migration `
      + "events point at it. This is either a user-created budget that happens to match, or the output of the "
      + "original (pre-budget_events) version of this migration. Refusing to guess: back up, confirm which, and "
      + "either rename/relabel the budget or attach the missing 'migrated' budget_events rows before re-running.",
    );
  }
  return null;
}

export async function migrate(tx: DbClient, asOf: string): Promise<Counts | null> {
  const ledgerRows = await tx.select().from(vacationLedger).orderBy(asc(vacationLedger.id));
  const rateRows = await tx.select().from(vacationAccrualRate).orderBy(asc(vacationAccrualRate.effectiveFrom));
  if (ledgerRows.length === 0 && rateRows.length === 0) return null;

  const counts = { ...ZERO_COUNTS };
  const owner = await resolveOwner(tx);

  const initialRows = ledgerRows.filter((row) => row.entryType === "initial");
  if (initialRows.length > 1) {
    throw new MigrationInputError(
      `Multiple 'initial' vacation_ledger rows found (${initialRows.length}); refusing to guess which is authoritative`,
    );
  }
  const initialRow = initialRows[0] ?? null;
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

  // Step 2: upsert the "Holidays" budget. Discovery is name "Holidays" + labels
  // containing "migrated" only for a never-migrated database; re-runs resolve the
  // budget from budget_events instead — see findExistingMigratedBudget.
  let budget = await findExistingMigratedBudget(tx, owner.id);
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
    // Every budget this script creates gets this event immediately, even when
    // the legacy data has no rate/withdrawal/adjustment rows to migrate (e.g.
    // an initial-only ledger) — otherwise a re-run would find zero "migrated"
    // events for this budget and, per findExistingMigratedBudget, abort.
    await recordMigratedEvent(tx, budget.id, "vacation_budget", "root");
  }

  // Step 3: the initial amount version. Versions are append-only (no update endpoint),
  // so the table's own (budget_id, effective_from) unique index is a safe idempotency key.
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
    const legacyId = rate.effectiveFrom;
    if (await migratedEventExists(tx, budget.id, "vacation_accrual_rate", legacyId)) continue;
    await tx.insert(budgetAllocations).values({
      budgetId: budget.id,
      sourceKind: "none",
      sourceId: null,
      amount: rate.amount,
      recurrence: "monthly",
      effectiveFrom: rate.effectiveFrom,
      effectiveTo: rate.effectiveTo,
      note: "migrated accrual rate",
    });
    await recordMigratedEvent(tx, budget.id, "vacation_accrual_rate", legacyId);
    counts.rateAllocations += 1;
  }

  // Step 5a: `withdrawal` rows become manual usages. `amount = |amount|` because usages are
  // always positive spend (figures.usedThrough subtracts them); the legacy ledger amount is
  // signed. `note` is the legacy row's own note, carried through as-is.
  for (const withdrawal of withdrawalRows) {
    const legacyId = String(withdrawal.id);
    if (await migratedEventExists(tx, budget.id, "vacation_ledger", legacyId)) continue;
    const occurredAt = dateOf(withdrawal);
    const amount = formatCents(absCents(cents(withdrawal.amount)));
    await tx.insert(budgetUsages).values({
      budgetId: budget.id,
      transactionId: null,
      amount,
      occurredAt,
      matchedBy: "manual",
      note: withdrawal.note,
    });
    await recordMigratedEvent(tx, budget.id, "vacation_ledger", legacyId);
    counts.withdrawalUsages += 1;
  }

  // Step 5b: `adjustment` rows become `once` allocations with the signed amount.
  for (const adjustment of adjustmentRows) {
    const legacyId = String(adjustment.id);
    if (await migratedEventExists(tx, budget.id, "vacation_ledger", legacyId)) continue;
    const effectiveFrom = dateOf(adjustment);
    await tx.insert(budgetAllocations).values({
      budgetId: budget.id,
      sourceKind: "none",
      sourceId: null,
      amount: adjustment.amount,
      recurrence: "once",
      effectiveFrom,
      effectiveTo: null,
      note: "migrated adjustment",
    });
    await recordMigratedEvent(tx, budget.id, "vacation_ledger", legacyId);
    counts.adjustmentAllocations += 1;
  }

  // Step 6 (R6-4): reconcile the rate-derived monthly total against the ledger's actual
  // accrual total, month by month, inserting only the incremental gap so re-running never
  // duplicates a correction already on record. Idempotency is a `budget_events` row per
  // month (kind "migration_reconciliation"), never the allocation's note; the seeded
  // running total sums by month (rather than overwriting) in case more than one event
  // were ever recorded for the same month.
  const reconciliationEvents = await tx
    .select({ detail: budgetEvents.detail })
    .from(budgetEvents)
    .where(and(eq(budgetEvents.budgetId, budget.id), eq(budgetEvents.kind, "migration_reconciliation")));
  const existingReconciliationByMonth = new Map<string, bigint>();
  for (const row of reconciliationEvents) {
    const detail = row.detail as { month?: unknown; amountCents?: unknown };
    if (typeof detail.month !== "string" || typeof detail.amountCents !== "string") {
      throw new MigrationInputError("Malformed migration_reconciliation event detail");
    }
    existingReconciliationByMonth.set(
      detail.month,
      (existingReconciliationByMonth.get(detail.month) ?? 0n) + BigInt(detail.amountCents),
    );
  }

  // The horizon is the last month with a legacy `accrual` row, not `asOf` itself —
  // see the file-level comment on why. A future-dated accrual row (relative to
  // asOf) is a data integrity problem, not something to silently clamp away: a
  // clamp would put the horizon back on the wall clock, narrowly reopening the
  // wall-clock idempotency bug this horizon exists to close.
  const accrualMonths = accrualRows.map((row) => monthKeyOf(dateOf(row)));
  let horizon: string;
  if (accrualMonths.length > 0) {
    horizon = accrualMonths.reduce((max, m) => (m > max ? m : max));
    if (horizon > monthKeyOf(asOf)) {
      throw new MigrationInputError(
        `A vacation_ledger 'accrual' row is dated in month ${horizon}, after asOf ${asOf}; refusing to guess the reconciliation horizon`,
      );
    }
  } else {
    horizon = monthKeyOf(asOf);
  }

  const months = monthRange(monthKeyOf(startDate), horizon);
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
      await tx.insert(budgetAllocations).values({
        budgetId: budget.id,
        sourceKind: "none",
        sourceId: null,
        amount: formatCents(incremental),
        recurrence: "once",
        effectiveFrom: month,
        effectiveTo: null,
        note: "migration adjustment",
      });
      await tx.insert(budgetEvents).values({
        budgetId: budget.id,
        kind: "migration_reconciliation",
        detail: { month, amountCents: incremental.toString() },
      });
      counts.reconciliationAllocations += 1;
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
    const counts = await withSystemContext(db, (tx) => migrate(tx, romeDate()));
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

// A module import (e.g. this test's own itest importing `migrate`) never has
// this file as argv[1], so it silently skips main() — that is intentional.
// But if argv[1] plausibly *is* this script (same basename) and still
// doesn't match import.meta.url exactly, that is a path-resolution surprise,
// not an import: `npm run migrate:vacation` would otherwise exit 0 having
// printed nothing, silently skipping the migration it was invoked to run.
const invokedAsScript = process.argv[1] === fileURLToPath(import.meta.url);
const invokedPathLooksLikeThisScript = /migrate-vacation-budget\.(ts|js|mjs)$/.test(process.argv[1] ?? "");
if (invokedAsScript) {
  void main();
} else if (invokedPathLooksLikeThisScript) {
  console.error(
    `migrate-vacation-budget.ts: argv[1] (${process.argv[1]}) looks like this script but does not match `
    + `import.meta.url (${fileURLToPath(import.meta.url)}) exactly; refusing to guess and not running the migration.`,
  );
  process.exitCode = 1;
}
