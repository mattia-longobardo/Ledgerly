import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
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
import { figures, type AllocationLike, type AmountVersionLike, type UsageLike } from "@/modules/budgets/domain/figures";
import { withSystemContext } from "@/platform/db/context";

/**
 * Independent, zero-tolerance validator for scripts/migrate-vacation-budget.ts.
 *
 * Run in source checkouts:
 *   DATABASE_URL=... npm run migrate:vacation:validate
 *
 * The expected balance is rebuilt directly from the frozen legacy tables
 * using bigint cents: initial + accruals + adjustments − withdrawals,
 * exactly reproducing the deleted src/lib/calc/vacation-fund.ts calculator
 * inline. This file deliberately imports only `figures` (the new system
 * under test) from the budgets domain — never a vacation-specific
 * calculator — so a bug shared between the migration and the domain cannot
 * hide from this check.
 *
 * Known limitation (left for the exit-task runbook, not fixed here): the
 * `cents`/`lastDayOfMonth`/`dateOf` helpers below are intentionally
 * copy-paste identical to the migration's own, so a date-attribution bug
 * shared between the two files would be invisible to this validator.
 *
 * The month loop only checks `figures().remaining` against the legacy
 * balance through the last month the ledger has an `accrual` row (see
 * `horizon` below) — the same horizon the migration uses for its R6-4
 * reconciliation, and for the same reason: past that month the migrated
 * budget is expected to diverge from the frozen ledger by design (it keeps
 * accruing; the ledger does not), so comparing further would be
 * meaningless. It separately asserts a structural, horizon-independent
 * property: exactly one `monthly` allocation per `vacation_accrual_rate`
 * row, with the rate's own amount and dates — because R6-4's reconciliation
 * is computed from those very allocations, an error in one would otherwise
 * be silently absorbed by a compensating "migration adjustment" and the
 * balance check alone would still print OK.
 */

class ValidationError extends Error {}

interface Owner {
  id: string;
  currency: string;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function cents(value: string): bigint {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new ValidationError(`Invalid decimal value: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  if (fraction.length > 2) throw new ValidationError(`Money has more than two decimals: ${value}`);
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

function show(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
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

async function resolveOwner(tx: DbClient): Promise<Owner> {
  const rows = await tx
    .selectDistinct({ id: users.id, currency: users.currency })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.roleCode, "owner")))
    .limit(2);
  if (rows.length !== 1) throw new ValidationError(`Expected exactly one owner, found ${rows.length}`);
  return rows[0]!;
}

async function findMigratedBudget(tx: DbClient, owner: Owner) {
  const rows = await tx
    .select()
    .from(budgets)
    .where(and(
      eq(budgets.userId, owner.id),
      eq(budgets.name, "Holidays"),
      sql`${budgets.labels} @> '["migrated"]'::jsonb`,
    ))
    .limit(2);
  if (rows.length !== 1) throw new ValidationError(`Expected one migrated Holidays budget, found ${rows.length}`);
  return rows[0]!;
}

/**
 * Important 4: structural, horizon-independent check that R6-4's
 * reconciliation cannot mask. Exactly one `monthly` allocation per rate row,
 * with the rate's own amount (string equality) and dates.
 */
function checkRateAllocations(
  rateRows: readonly { effectiveFrom: string; monthlyAmount: string }[],
  allocationRows: readonly { amount: string; recurrence: string; effectiveFrom: string; effectiveTo: string | null }[],
): void {
  const monthlyAllocations = allocationRows.filter((row) => row.recurrence === "monthly");
  if (monthlyAllocations.length !== rateRows.length) {
    throw new ValidationError(
      `Expected ${rateRows.length} monthly allocation(s) (one per accrual rate), found ${monthlyAllocations.length}`,
    );
  }
  for (let i = 0; i < rateRows.length; i++) {
    const rate = rateRows[i]!;
    const expectedEffectiveTo = i < rateRows.length - 1 ? subtractOneDay(rateRows[i + 1]!.effectiveFrom) : null;
    const matches = monthlyAllocations.filter((row) => row.effectiveFrom === rate.effectiveFrom);
    if (matches.length !== 1) {
      throw new ValidationError(
        `Expected exactly one monthly allocation effective ${rate.effectiveFrom}, found ${matches.length}`,
      );
    }
    const allocation = matches[0]!;
    if (allocation.amount !== rate.monthlyAmount) {
      throw new ValidationError(
        `Rate ${rate.effectiveFrom}: allocation amount ${allocation.amount} does not equal rate monthly_amount ${rate.monthlyAmount}`,
      );
    }
    if (allocation.effectiveTo !== expectedEffectiveTo) {
      throw new ValidationError(
        `Rate ${rate.effectiveFrom}: allocation effective_to ${String(allocation.effectiveTo)} does not equal expected ${String(expectedEffectiveTo)}`,
      );
    }
  }
}

export async function validate(tx: DbClient, asOf: string): Promise<{ examined: number }> {
  const owner = await resolveOwner(tx);
  const ledgerRows = await tx.select().from(vacationLedger).orderBy(asc(vacationLedger.id));
  const rateRows = await tx.select().from(vacationAccrualRate).orderBy(asc(vacationAccrualRate.effectiveFrom));
  if (ledgerRows.length === 0 && rateRows.length === 0) {
    throw new ValidationError("Examined 0 legacy rows: nothing to validate");
  }

  const budget = await findMigratedBudget(tx, owner);
  // Sequential, not Promise.all: `tx` is a single client, and node-postgres
  // does not support concurrent queries on one client/transaction.
  const versionRows = await tx.select().from(budgetAmountVersions).where(eq(budgetAmountVersions.budgetId, budget.id));
  const allocationRows = await tx.select().from(budgetAllocations).where(eq(budgetAllocations.budgetId, budget.id));
  const usageRows = await tx.select().from(budgetUsages).where(eq(budgetUsages.budgetId, budget.id));
  if (versionRows.length === 0) throw new ValidationError("Migrated budget has no amount version");

  checkRateAllocations(rateRows, allocationRows);

  const versions: AmountVersionLike[] = versionRows.map((row) => ({
    initialAmount: row.initialAmount,
    effectiveFrom: row.effectiveFrom,
  }));
  const allocations: AllocationLike[] = allocationRows.map((row) => ({
    id: row.id,
    amount: row.amount,
    recurrence: row.recurrence as AllocationLike["recurrence"],
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    sourceKind: row.sourceKind as AllocationLike["sourceKind"],
    sourceId: row.sourceId,
  }));
  const usages: UsageLike[] = usageRows.map((row) => ({ amount: row.amount, occurredAt: row.occurredAt }));

  const initialRows = ledgerRows.filter((row) => row.entryType === "initial");
  if (initialRows.length > 1) {
    throw new ValidationError(`Multiple 'initial' vacation_ledger rows found (${initialRows.length})`);
  }
  const initialRow = initialRows[0] ?? null;
  const accrualRows = ledgerRows.filter((row) => row.entryType === "accrual");
  const withdrawalRows = ledgerRows.filter((row) => row.entryType === "withdrawal");
  const adjustmentRows = ledgerRows.filter((row) => row.entryType === "adjustment");
  const legacyInitialCents = initialRow ? cents(initialRow.amount) : 0n;

  // Same horizon rule as the migration's R6-4 step, derived independently from
  // the ledger's own accrual rows — see the file-level comment.
  const accrualMonths = accrualRows.map((row) => monthKeyOf(dateOf(row)));
  const lastAccrualMonth = accrualMonths.length > 0
    ? accrualMonths.reduce((max, m) => (m > max ? m : max))
    : monthKeyOf(asOf);
  const horizon = lastAccrualMonth < monthKeyOf(asOf) ? lastAccrualMonth : monthKeyOf(asOf);
  const months = monthRange(monthKeyOf(budget.startDate), horizon);
  if (months.length === 0) throw new ValidationError("Examined 0 months");

  for (const month of months) {
    const lastDay = lastDayOfMonth(month);
    const accrualSum = accrualRows
      .filter((row) => dateOf(row) <= lastDay)
      .reduce((sum, row) => sum + cents(row.amount), 0n);
    const adjustmentSum = adjustmentRows
      .filter((row) => dateOf(row) <= lastDay)
      .reduce((sum, row) => sum + cents(row.amount), 0n);
    const withdrawalSum = withdrawalRows
      .filter((row) => dateOf(row) <= lastDay)
      .reduce((sum, row) => {
        const value = cents(row.amount);
        return sum + (value < 0n ? -value : value);
      }, 0n);
    const legacyBalanceCents = legacyInitialCents + accrualSum + adjustmentSum - withdrawalSum;

    const actual = figures({ versions, allocations, usages, goalAmount: budget.goalAmount }, lastDay);
    const actualCents = cents(actual.remaining);

    if (actualCents !== legacyBalanceCents) {
      throw new ValidationError(
        `${month}: legacy balance ${show(legacyBalanceCents)}, migrated remaining ${show(actualCents)}`,
      );
    }
  }

  console.log(
    `CHECK Holidays: ${ledgerRows.length} legacy ledger rows, ${rateRows.length} accrual rate(s), `
    + `${allocationRows.length} migrated allocation(s), ${usageRows.length} migrated usage(s)`,
  );
  return { examined: months.length };
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
    const result = await withSystemContext(db, (tx) => validate(tx, romeDate()));
    if (result.examined <= 0) throw new ValidationError("Examined 0 months");
    console.log(`OK (${result.examined} months examined)`);
  } catch (error) {
    console.error(`FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
