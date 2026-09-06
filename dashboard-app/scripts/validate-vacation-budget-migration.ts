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

async function validate(tx: DbClient): Promise<{ examined: number }> {
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

  const initialRow = ledgerRows.find((row) => row.entryType === "initial") ?? null;
  const accrualRows = ledgerRows.filter((row) => row.entryType === "accrual");
  const withdrawalRows = ledgerRows.filter((row) => row.entryType === "withdrawal");
  const adjustmentRows = ledgerRows.filter((row) => row.entryType === "adjustment");
  const legacyInitialCents = initialRow ? cents(initialRow.amount) : 0n;

  const today = romeDate();
  const months = monthRange(monthKeyOf(budget.startDate), monthKeyOf(today));
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
    const result = await withSystemContext(db, validate);
    if (result.examined <= 0) throw new ValidationError("Examined 0 months");
    console.log(`OK (${result.examined} months examined)`);
  } catch (error) {
    console.error(`FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
