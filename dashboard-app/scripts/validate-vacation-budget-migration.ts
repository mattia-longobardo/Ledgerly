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
import { allocatedThrough, figures, type AllocationLike, type AmountVersionLike, type UsageLike } from "@/modules/budgets/domain/figures";
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
 * inline. This file deliberately imports only `figures`/`allocatedThrough`
 * (the new system under test) from the budgets domain — never a
 * vacation-specific calculator — so a bug shared between the migration and
 * the domain cannot hide from this check.
 *
 * Known limitation (left for the exit-task runbook, not fixed here): the
 * `cents`/`lastDayOfMonth`/`dateOf`/`buildExpectedRateAllocations` helpers
 * below are intentionally copy-paste identical to the migration's own, so a
 * date-attribution or rate-allocation-shape bug shared between the two
 * files would be invisible to this validator.
 *
 * The budget under test is resolved from `budget_events`, not from
 * `name`/`labels` — see `findMigratedBudget` for why (a user can rename a
 * budget or edit its labels; `budget_events` is not user-writable).
 *
 * Two independent checks, run every time:
 *
 * - Structural, horizon-independent: `checkRateAllocations` (exactly one
 *   `monthly` allocation per accrual rate, with its exact amount and
 *   dates), `checkWithdrawalUsages` (exactly one manual usage per
 *   `withdrawal` row, `amount = |legacy amount|`, `occurred_at =
 *   dateOf(row)`, no `transaction_id`), `checkAdjustmentAllocations`
 *   (exactly one `once` allocation per `adjustment` row carrying the
 *   signed amount at `dateOf(row)`). These exist because the month-by-month
 *   balance check below can silently absorb a broken row: R6-4's
 *   reconciliation is computed *from* the rate allocations, and a
 *   wrong-signed or misdated withdrawal/adjustment shifts the same balance
 *   on both sides of the comparison. Round 1 of this validator had exactly
 *   this blind spot for withdrawal/adjustment rows dated after the last
 *   accrual month.
 * - Balance, month by month, through the later of two horizons: the last
 *   month with a legacy `accrual` row (`lastAccrualMonth`, call it M_a —
 *   R6-4's reconciliation freezes there, same as the migration) and the
 *   last month with *any* legacy ledger row (covers a withdrawal or
 *   adjustment dated after M_a). For a month M ≤ M_a the check is the plain
 *   legacy formula. For M > M_a, the migrated budget is expected to keep
 *   accruing via the real monthly rate allocation while the frozen ledger's
 *   `accrual` total does not, so the expectation adds back exactly that
 *   divergence:
 *
 *     expected(M) = legacyBalance(M) + [allocatedThrough(rateAllocs, lastDay(M))
 *                                        − allocatedThrough(rateAllocs, lastDay(M_a))]
 *
 *   `legacyBalance(M)` already freezes its accrual term at M_a on its own
 *   (there are no more `accrual` rows past M_a to add), so no special case
 *   is needed there — only the bracketed rate-allocation delta is added for
 *   M > M_a. This is provably correct because the migrated budget's actual
 *   `allocatedThrough` total is `rateAllocs(M) + reconciliation(M_a)` (the
 *   reconciliation total is frozen at M_a and never grows again), and
 *   `reconciliation(M_a) = legacyAccrual(M_a) − rateAllocs(M_a)` by
 *   construction — substituting that in and cancelling terms gives exactly
 *   the formula above.
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

async function resolveOwner(tx: DbClient): Promise<Owner> {
  const rows = await tx
    .selectDistinct({ id: users.id, currency: users.currency })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.roleCode, "owner")))
    .limit(2);
  if (rows.length !== 1) throw new ValidationError(`Expected exactly one owner, found ${rows.length}`);
  return rows[0]!;
}

/**
 * Resolves the migrated budget from `budget_events`, not `name`/`labels` —
 * mirrors `findExistingMigratedBudget` in the migration script exactly (see
 * that file for the rationale). A name+labels match with no migration
 * events aborts rather than guessing.
 */
async function findMigratedBudget(tx: DbClient, owner: Owner) {
  const eventRows = await tx
    .select({ budget: budgets })
    .from(budgetEvents)
    .innerJoin(budgets, eq(budgets.id, budgetEvents.budgetId))
    .where(and(eq(budgets.userId, owner.id), eq(budgetEvents.kind, "migrated")));
  const byId = new Map(eventRows.map((row) => [row.budget.id, row.budget]));
  if (byId.size > 1) {
    throw new ValidationError(`Migration events point at ${byId.size} different budgets; refusing to guess`);
  }
  if (byId.size === 1) return [...byId.values()][0]!;

  const nameMatches = await tx
    .select()
    .from(budgets)
    .where(and(
      eq(budgets.userId, owner.id),
      eq(budgets.name, "Holidays"),
      sql`${budgets.labels} @> '["migrated"]'::jsonb`,
    ))
    .limit(2);
  if (nameMatches.length > 1) {
    throw new ValidationError(`Ambiguous Holidays budget: found ${nameMatches.length}`);
  }
  if (nameMatches.length === 1) {
    throw new ValidationError(
      `Found a budget named "Holidays" with labels containing "migrated" (id ${nameMatches[0]!.id}), but no migration `
      + "events point at it; refusing to guess whether it is an unrelated user budget or the output of the original "
      + "(pre-budget_events) migration script",
    );
  }
  throw new ValidationError("Expected one migrated Holidays budget, found 0");
}

/** Independently reconstructs R6-2's expected monthly allocations from the legacy rates. */
function buildExpectedRateAllocations(
  rateRows: readonly { effectiveFrom: string; monthlyAmount: string }[],
): AllocationLike[] {
  return rateRows.map((rate, i) => ({
    id: "",
    amount: rate.monthlyAmount,
    recurrence: "monthly",
    effectiveFrom: rate.effectiveFrom,
    effectiveTo: i < rateRows.length - 1 ? subtractOneDay(rateRows[i + 1]!.effectiveFrom) : null,
    sourceKind: "none",
    sourceId: null,
  }));
}

/**
 * Structural, horizon-independent check that R6-4's reconciliation cannot
 * mask. Exactly one `monthly` allocation per rate row, with the rate's own
 * amount (string equality) and dates.
 */
function checkRateAllocations(
  expected: readonly AllocationLike[],
  allocationRows: readonly { amount: string; recurrence: string; effectiveFrom: string; effectiveTo: string | null }[],
): void {
  const monthlyAllocations = allocationRows.filter((row) => row.recurrence === "monthly");
  if (monthlyAllocations.length !== expected.length) {
    throw new ValidationError(
      `Expected ${expected.length} monthly allocation(s) (one per accrual rate), found ${monthlyAllocations.length}`,
    );
  }
  for (const rate of expected) {
    const matches = monthlyAllocations.filter((row) => row.effectiveFrom === rate.effectiveFrom);
    if (matches.length !== 1) {
      throw new ValidationError(
        `Expected exactly one monthly allocation effective ${rate.effectiveFrom}, found ${matches.length}`,
      );
    }
    const allocation = matches[0]!;
    if (allocation.amount !== rate.amount) {
      throw new ValidationError(
        `Rate ${rate.effectiveFrom}: allocation amount ${allocation.amount} does not equal rate monthly_amount ${rate.amount}`,
      );
    }
    if (allocation.effectiveTo !== rate.effectiveTo) {
      throw new ValidationError(
        `Rate ${rate.effectiveFrom}: allocation effective_to ${String(allocation.effectiveTo)} does not equal expected ${String(rate.effectiveTo)}`,
      );
    }
  }
}

/**
 * Structural, horizon-independent check. Exactly one `matched_by: 'manual'`
 * usage per `withdrawal` row, with `amount = |legacy amount|` (string
 * equality) and `occurred_at = dateOf(row)`, carrying no `transaction_id`.
 * Closes the exact gap the balance check alone cannot: a withdrawal written
 * with the wrong sign, or dated wrong, shifts `remaining` the same way on
 * both sides of a balance comparison for any month before the mistake and
 * is invisible to it for any month examined only before the mistaken date.
 */
function checkWithdrawalUsages(
  withdrawalRows: readonly { id: number; amount: string; month: string | null; occurredAt: Date }[],
  usageRows: readonly { amount: string; occurredAt: string; matchedBy: string; transactionId: string | null }[],
): void {
  const manualUsages = usageRows.filter((row) => row.matchedBy === "manual");
  if (manualUsages.length !== withdrawalRows.length) {
    throw new ValidationError(
      `Expected ${withdrawalRows.length} manual usage(s) (one per withdrawal), found ${manualUsages.length}`,
    );
  }
  for (const withdrawal of withdrawalRows) {
    const expectedAmount = show(absCents(cents(withdrawal.amount)));
    const expectedOccurredAt = dateOf(withdrawal);
    const matches = manualUsages.filter(
      (row) => row.occurredAt === expectedOccurredAt && row.amount === expectedAmount,
    );
    if (matches.length !== 1) {
      throw new ValidationError(
        `Expected exactly one manual usage dated ${expectedOccurredAt} amount ${expectedAmount} `
        + `(vacation_ledger#${withdrawal.id}), found ${matches.length}`,
      );
    }
    if (matches[0]!.transactionId !== null) {
      throw new ValidationError(
        `Manual usage for vacation_ledger#${withdrawal.id} unexpectedly carries a transaction_id`,
      );
    }
  }
}

/**
 * Structural, horizon-independent check. Exactly one `once` allocation per
 * `adjustment` row, carrying the signed legacy amount at `dateOf(row)`.
 */
function checkAdjustmentAllocations(
  adjustmentRows: readonly { id: number; amount: string; month: string | null; occurredAt: Date }[],
  allocationRows: readonly { amount: string; recurrence: string; effectiveFrom: string }[],
): void {
  const onceAllocations = allocationRows.filter((row) => row.recurrence === "once");
  for (const adjustment of adjustmentRows) {
    const expectedEffectiveFrom = dateOf(adjustment);
    const matches = onceAllocations.filter(
      (row) => row.effectiveFrom === expectedEffectiveFrom && row.amount === adjustment.amount,
    );
    if (matches.length !== 1) {
      throw new ValidationError(
        `Expected exactly one once allocation dated ${expectedEffectiveFrom} amount ${adjustment.amount} `
        + `(vacation_ledger#${adjustment.id}), found ${matches.length}`,
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

  const initialRows = ledgerRows.filter((row) => row.entryType === "initial");
  if (initialRows.length > 1) {
    throw new ValidationError(`Multiple 'initial' vacation_ledger rows found (${initialRows.length})`);
  }
  const initialRow = initialRows[0] ?? null;
  const accrualRows = ledgerRows.filter((row) => row.entryType === "accrual");
  const withdrawalRows = ledgerRows.filter((row) => row.entryType === "withdrawal");
  const adjustmentRows = ledgerRows.filter((row) => row.entryType === "adjustment");
  const legacyInitialCents = initialRow ? cents(initialRow.amount) : 0n;

  const expectedRateAllocations = buildExpectedRateAllocations(rateRows);
  checkRateAllocations(expectedRateAllocations, allocationRows);
  checkWithdrawalUsages(withdrawalRows, usageRows);
  checkAdjustmentAllocations(adjustmentRows, allocationRows);

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

  // M_a: the last month with a legacy `accrual` row — same rule, and the same
  // future-date guard, as the migration's R6-4 step (see that file). A
  // future-dated accrual row is a data integrity problem, not something to
  // silently clamp away.
  const accrualMonths = accrualRows.map((row) => monthKeyOf(dateOf(row)));
  let lastAccrualMonth: string;
  if (accrualMonths.length > 0) {
    lastAccrualMonth = accrualMonths.reduce((max, m) => (m > max ? m : max));
    if (lastAccrualMonth > monthKeyOf(asOf)) {
      throw new ValidationError(
        `A vacation_ledger 'accrual' row is dated in month ${lastAccrualMonth}, after asOf ${asOf}`,
      );
    }
  } else {
    lastAccrualMonth = monthKeyOf(asOf);
  }

  // The balance loop's upper bound is the later of M_a and the last month with
  // *any* legacy ledger row (a withdrawal or adjustment can be dated after
  // M_a — see the file-level comment for the M > M_a correction), clamped to
  // asOf.
  const allLedgerMonths = ledgerRows.map((row) => monthKeyOf(dateOf(row)));
  const lastLedgerMonth = allLedgerMonths.length > 0
    ? allLedgerMonths.reduce((max, m) => (m > max ? m : max))
    : lastAccrualMonth;
  const loopBound = lastLedgerMonth < monthKeyOf(asOf) ? lastLedgerMonth : monthKeyOf(asOf);
  const months = monthRange(monthKeyOf(budget.startDate), loopBound);
  if (months.length === 0) throw new ValidationError("Examined 0 months");

  const rateTotalAtHorizon = cents(allocatedThrough(expectedRateAllocations, lastDayOfMonth(lastAccrualMonth)));

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
      .reduce((sum, row) => sum + absCents(cents(row.amount)), 0n);
    const legacyBalanceCents = legacyInitialCents + accrualSum + adjustmentSum - withdrawalSum;

    let expectedCents = legacyBalanceCents;
    if (month > lastAccrualMonth) {
      const rateTotalNow = cents(allocatedThrough(expectedRateAllocations, lastDay));
      expectedCents = legacyBalanceCents + (rateTotalNow - rateTotalAtHorizon);
    }

    const actual = figures({ versions, allocations, usages, goalAmount: budget.goalAmount }, lastDay);
    const actualCents = cents(actual.remaining);

    if (actualCents !== expectedCents) {
      throw new ValidationError(
        `${month}: expected ${show(expectedCents)}, migrated remaining ${show(actualCents)}`,
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

// See migrate-vacation-budget.ts's identical guard for why a plausible-but-
// inexact argv[1] match is treated as loud failure rather than a silent no-op.
const invokedAsScript = process.argv[1] === fileURLToPath(import.meta.url);
const invokedPathLooksLikeThisScript = /validate-vacation-budget-migration\.(ts|js|mjs)$/.test(process.argv[1] ?? "");
if (invokedAsScript) {
  void main();
} else if (invokedPathLooksLikeThisScript) {
  console.error(
    `validate-vacation-budget-migration.ts: argv[1] (${process.argv[1]}) looks like this script but does not match `
    + `import.meta.url (${fileURLToPath(import.meta.url)}) exactly; refusing to guess and not running the validator.`,
  );
  process.exitCode = 1;
}
