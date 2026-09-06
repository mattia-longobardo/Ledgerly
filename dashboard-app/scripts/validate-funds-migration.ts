import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbClient } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  accountBalances,
  accounts,
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
import { monthKey, romeDate } from "@/lib/time";
import { withSystemContext } from "@/platform/db/context";

/**
 * Independent, zero-tolerance validator for scripts/migrate-funds.ts.
 *
 * Run in source checkouts:
 *   DATABASE_URL=... npm run migrate:funds:validate
 * Run from the standalone image:
 *   node /app/validate-funds-migration.mjs
 *
 * Expected values are rebuilt directly from frozen legacy tables using bigint
 * cents. This file deliberately imports neither the migration nor funds domain
 * calculators. For Cometa it proves two timelines separately: money actually
 * posted at quarter-end +1, and the legacy chart visibility at quarter-end +2.
 */

class ValidationError extends Error {}

interface LegacyFundInput {
  id: number;
  slug: string;
  name: string;
}

interface LegacySettingInput {
  id: number;
  fundId: number;
  effectiveFrom: string;
  initialCapital: string;
  depositMode: string;
  fixedMonthlyAmount: string | null;
}

interface LegacyDepositInput {
  id: number;
  fundId: number;
  month: string;
  amount: string;
  employeePart: string | null;
  employerPart: string | null;
  source: string;
}

interface NewContributionInput {
  id: string;
  typeCode: string;
  accrualPeriodStart: string;
  accrualPeriodEnd: string;
  postedMonth: string;
  amount: string;
  currency: string;
  source: string;
  payrollRecordId: string | null;
  note: string | null;
}

interface CanonicalSnapshot extends Record<string, unknown> {
  accountKey: string;
  month: string;
  balance: string;
  capturedAt: Date | string;
}

interface AccountHistoryRow {
  id: string;
  asOf: string;
  balance: string;
  source: string;
  capturedAt: Date;
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

/** Month arithmetic is kept here, independent from the migration/domain schedule helpers. */
function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const total = year * 12 + monthIndex + delta;
  const shiftedYear = Math.floor(total / 12);
  const shiftedMonth = ((total % 12) + 12) % 12;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth + 1).padStart(2, "0")}-01`;
}

function monthSpan(from: string, to: string): string[] {
  const out: string[] = [];
  for (let current = from; current <= to; current = shiftMonth(current, 1)) out.push(current);
  return out;
}

function quarterPeriod(month: string): { start: string; end: string } {
  const calendarMonth = Number(month.slice(5, 7));
  const startMonth = Math.floor((calendarMonth - 1) / 3) * 3 + 1;
  const start = `${month.slice(0, 4)}-${String(startMonth).padStart(2, "0")}-01`;
  return { start, end: shiftMonth(start, 2) };
}

function independentPeriod(slug: string, month: string): { start: string; end: string; posted: string } {
  if (slug !== "cometa") return { start: month, end: month, posted: month };
  const period = quarterPeriod(month);
  return { ...period, posted: shiftMonth(period.end, 1) };
}

function sumThrough(rows: ReadonlyArray<{ month: string; amount: bigint }>, month: string): bigint {
  return rows.reduce((total, row) => row.month <= month ? total + row.amount : total, 0n);
}

function failSource(slug: string, detail: string): never {
  throw new ValidationError(`${slug}: source completeness mismatch — ${detail}`);
}

async function resolveOwner(tx: DbClient): Promise<{ id: string; currency: string }> {
  const rows = await tx
    .selectDistinct({ id: users.id, currency: users.currency })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.roleCode, "owner")))
    .limit(2);
  if (rows.length !== 1) throw new ValidationError(`Expected exactly one owner, found ${rows.length}`);
  return rows[0]!;
}

async function canonicalSnapshots(
  tx: DbClient,
  legacy: LegacyFundInput,
): Promise<CanonicalSnapshot[]> {
  const keys = await tx
    .selectDistinct({ accountKey: balanceSnapshots.accountKey })
    .from(balanceSnapshots)
    .where(sql`lower(${balanceSnapshots.accountKey}) IN (lower(${legacy.slug}), lower(${legacy.name}))`);
  if (keys.length !== 1) {
    throw new ValidationError(
      `${legacy.slug}: expected one balance_snapshots account key, found ${keys.length}`,
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
  if (result.rows.length === 0) throw new ValidationError(`${legacy.slug}: canonical valuation history is empty`);
  return result.rows;
}

async function validateValuation(
  tx: DbClient,
  owner: { id: string; currency: string },
  legacy: LegacyFundInput,
  accountId: string | null,
): Promise<number> {
  if (!accountId) throw new ValidationError(`${legacy.slug}: migrated fund has no account_id`);
  const [account] = await tx
    .select({ id: accounts.id, userId: accounts.userId, currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account || account.userId !== owner.id || account.currency !== owner.currency) {
    throw new ValidationError(`${legacy.slug}: valuation account owner/currency mismatch`);
  }
  const history = await tx
    .select({
      id: accountBalances.id,
      asOf: accountBalances.asOf,
      balance: accountBalances.balance,
      source: accountBalances.source,
      capturedAt: accountBalances.capturedAt,
    })
    .from(accountBalances)
    .where(eq(accountBalances.accountId, accountId))
    .orderBy(asc(accountBalances.asOf), asc(accountBalances.capturedAt), asc(accountBalances.id));
  if (history.length === 0) throw new ValidationError(`${legacy.slug}: valuation account has no latest balance`);

  const canonical = await canonicalSnapshots(tx, legacy);
  for (const expected of canonical) {
    const capturedAt = expected.capturedAt instanceof Date
      ? expected.capturedAt
      : new Date(expected.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new ValidationError(`${legacy.slug}: invalid legacy snapshot timestamp ${expected.capturedAt}`);
    }
    const expectedAsOf = romeDate(capturedAt);
    const exact = (history as AccountHistoryRow[]).filter((row) =>
      row.asOf === expectedAsOf
      && row.capturedAt.getTime() === capturedAt.getTime()
      && cents(row.balance) === cents(expected.balance));
    if (exact.length !== 1) {
      throw new ValidationError(
        `${legacy.slug}: valuation ${expected.month} expected ${expected.balance} at ${expectedAsOf}/${capturedAt.toISOString()}, found ${exact.length}`,
      );
    }
  }
  return canonical.length;
}

function expectSinglePart(
  slug: string,
  deposit: LegacyDepositInput,
  actual: NewContributionInput[],
  expected: {
    typeCode: string;
    amount: string;
    period: { start: string; end: string; posted: string };
    payrollRecordId: string | null;
    currency: string;
  },
): void {
  const row = actual.find((candidate) => candidate.typeCode === expected.typeCode);
  if (!row) failSource(slug, `fund_deposits#${deposit.id} has no ${expected.typeCode} row`);
  if (
    cents(row.amount) !== cents(expected.amount)
    || row.accrualPeriodStart !== expected.period.start
    || row.accrualPeriodEnd !== expected.period.end
    || row.postedMonth !== expected.period.posted
    || row.source !== "migration"
    || row.payrollRecordId !== expected.payrollRecordId
    || row.currency !== expected.currency
  ) {
    failSource(slug, `fund_deposits#${deposit.id} ${expected.typeCode} amount/timing/provenance differs`);
  }
}

async function validateFund(
  tx: DbClient,
  owner: { id: string; currency: string },
  legacy: LegacyFundInput,
  settings: LegacySettingInput[],
  deposits: LegacyDepositInput[],
  currentMonth: string,
): Promise<{ examined: number; timingDifferences: number }> {
  const matches = await tx
    .select()
    .from(funds)
    .where(and(eq(funds.userId, owner.id), eq(funds.slug, legacy.slug)))
    .limit(2);
  if (matches.length !== 1) throw new ValidationError(`${legacy.slug}: expected one migrated fund, found ${matches.length}`);
  const fund = matches[0]!;
  if (fund.currency !== owner.currency) throw new ValidationError(`${legacy.slug}: fund currency mismatch`);
  const valuationMonths = await validateValuation(tx, owner, legacy, fund.accountId);

  if (deposits.length === 0) throw new ValidationError(`${legacy.slug}: examined 0 legacy deposits`);
  const earliestSetting = [...settings].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id - b.id)[0] ?? null;
  const plans = await tx.select().from(fundPlans).where(eq(fundPlans.fundId, fund.id));
  for (const setting of settings) {
    if (!plans.some((plan) => plan.effectiveFrom === setting.effectiveFrom)) {
      failSource(legacy.slug, `missing plan for fund_settings#${setting.id}`);
    }
  }
  const schedules = await tx
    .select()
    .from(fundContributionSchedules)
    .where(eq(fundContributionSchedules.fundId, fund.id));
  const scheduleFrom = earliestSetting?.effectiveFrom ?? deposits[0]!.month;
  const schedule = schedules.find((row) => row.effectiveFrom === scheduleFrom);
  if (!schedule) failSource(legacy.slug, `missing schedule effective ${scheduleFrom}`);
  if (legacy.slug === "cometa") {
    if (
      schedule.frequency !== "quarterly"
      || schedule.periodAnchorMonth !== 1
      || schedule.postingLagMonths !== 1
      || cents(schedule.feePerPosting) !== 300n
    ) failSource(legacy.slug, "schedule rule differs from quarterly/anchor 1/lag 1/3.00");
  } else if (
    schedule.frequency !== "monthly"
    || schedule.postingLagMonths !== 0
    || cents(schedule.feePerPosting) !== 0n
  ) failSource(legacy.slug, "schedule rule differs from monthly/lag 0/0.00");

  const rows = (await tx
    .select({
      id: fundContributions.id,
      typeCode: fundContributions.typeCode,
      accrualPeriodStart: fundContributions.accrualPeriodStart,
      accrualPeriodEnd: fundContributions.accrualPeriodEnd,
      postedMonth: fundContributions.postedMonth,
      amount: fundContributions.amount,
      currency: fundContributions.currency,
      source: fundContributions.source,
      payrollRecordId: fundContributions.payrollRecordId,
      note: fundContributions.note,
    })
    .from(fundContributions)
    .where(eq(fundContributions.fundId, fund.id))) as NewContributionInput[];

  const livePayroll = await tx
    .select({ id: payrollRecords.id, periodStart: payrollRecords.periodStart })
    .from(payrollRecords)
    .where(and(
      eq(payrollRecords.userId, owner.id),
      eq(payrollRecords.kind, "ordinary"),
      isNull(payrollRecords.supersededAt),
    ));
  const payrollByMonth = new Map(livePayroll.map((row) => [row.periodStart, row.id]));
  const expectedDepositNotes = new Set<string>();

  for (const deposit of deposits) {
    const note = `migrated from fund_deposits#${deposit.id}`;
    expectedDepositNotes.add(note);
    const actual = rows.filter((row) => row.note === note);
    const period = independentPeriod(legacy.slug, deposit.month);
    const payrollRecordId = deposit.source === "payroll"
      ? (payrollByMonth.get(deposit.month) ?? null)
      : null;
    if (deposit.source === "payroll" && deposit.employeePart !== null && deposit.employerPart !== null) {
      if (cents(deposit.employeePart) + cents(deposit.employerPart) !== cents(deposit.amount)) {
        failSource(legacy.slug, `fund_deposits#${deposit.id} split does not equal amount`);
      }
      if (actual.length !== 2) failSource(legacy.slug, `fund_deposits#${deposit.id} expected two split rows, found ${actual.length}`);
      expectSinglePart(legacy.slug, deposit, actual, {
        typeCode: "employee", amount: deposit.employeePart, period, payrollRecordId, currency: owner.currency,
      });
      expectSinglePart(legacy.slug, deposit, actual, {
        typeCode: "employer", amount: deposit.employerPart, period, payrollRecordId, currency: owner.currency,
      });
    } else {
      if (actual.length !== 1) failSource(legacy.slug, `fund_deposits#${deposit.id} expected one row, found ${actual.length}`);
      expectSinglePart(legacy.slug, deposit, actual, {
        typeCode: deposit.source === "payroll" ? "employee" : "voluntary",
        amount: deposit.amount,
        period,
        payrollRecordId,
        currency: owner.currency,
      });
    }
  }
  const orphanDepositRows = rows.filter((row) =>
    row.source === "migration"
    && row.note?.startsWith("migrated from fund_deposits#")
    && !expectedDepositNotes.has(row.note));
  if (orphanDepositRows.length > 0) failSource(legacy.slug, `${orphanDepositRows.length} orphan deposit migration row(s)`);

  const openingRows = rows.filter((row) => row.note?.startsWith("migrated opening from fund_settings#"));
  const openingCents = earliestSetting ? cents(earliestSetting.initialCapital) : 0n;
  if (openingCents === 0n) {
    if (openingRows.length !== 0) failSource(legacy.slug, "unexpected zero-capital opening row");
  } else {
    if (openingRows.length !== 1 || !earliestSetting) failSource(legacy.slug, `expected one opening row, found ${openingRows.length}`);
    const opening = openingRows[0]!;
    if (
      opening.typeCode !== "adjustment"
      || cents(opening.amount) !== openingCents
      || opening.postedMonth !== earliestSetting.effectiveFrom
      || opening.accrualPeriodStart !== earliestSetting.effectiveFrom
      || opening.accrualPeriodEnd !== earliestSetting.effectiveFrom
      || opening.source !== "migration"
      || opening.payrollRecordId !== null
      || opening.currency !== owner.currency
    ) failSource(legacy.slug, "opening amount/date/provenance differs from earliest setting");
  }

  const payrollPeriods = new Map<string, { start: string; end: string }>();
  for (const deposit of deposits.filter((row) => row.source === "payroll")) {
    const period = independentPeriod(legacy.slug, deposit.month);
    payrollPeriods.set(period.posted, { start: period.start, end: period.end });
  }
  const feePeriods = legacy.slug === "cometa"
    ? payrollPeriods
    : new Map<string, { start: string; end: string }>();
  const systemFees = rows.filter((row) => row.typeCode === "fee" && row.source === "system");
  if (systemFees.length !== feePeriods.size) {
    failSource(legacy.slug, `expected ${feePeriods.size} system fees, found ${systemFees.length}`);
  }
  for (const [posted, period] of feePeriods) {
    const fees = systemFees.filter((row) => row.postedMonth === posted);
    if (
      fees.length !== 1
      || cents(fees[0]!.amount) !== -300n
      || fees[0]!.accrualPeriodStart !== period.start
      || fees[0]!.accrualPeriodEnd !== period.end
      || fees[0]!.currency !== owner.currency
      || fees[0]!.payrollRecordId !== null
    ) failSource(legacy.slug, `system fee for ${posted} amount/period/provenance differs`);
  }
  const joiningRows = rows.filter((row) => row.typeCode === "fee" && row.source === "migration" && row.note === "joining fee");
  if (legacy.slug === "cometa" && payrollPeriods.size > 0) {
    const firstPosting = [...payrollPeriods.keys()].sort()[0]!;
    if (joiningRows.length !== 1 || cents(joiningRows[0]!.amount) !== -1032n || joiningRows[0]!.postedMonth !== firstPosting) {
      failSource(legacy.slug, "joining fee count/amount/posting differs");
    }
  } else if (joiningRows.length !== 0) failSource(legacy.slug, "unexpected joining fee");

  const migratedActual: Array<{ month: string; amount: bigint }> = rows
    .filter((row) =>
      row.source === "migration"
      || (row.typeCode === "fee" && row.source === "system" && feePeriods.has(row.postedMonth)))
    .map((row) => ({ month: row.postedMonth, amount: cents(row.amount) }));
  const migratedVisible: Array<{ month: string; amount: bigint }> = rows
    .filter((row) =>
      row.source === "migration"
      || (row.typeCode === "fee" && row.source === "system" && feePeriods.has(row.postedMonth)))
    .map((row) => ({
      month: legacy.slug === "cometa" && row.note?.startsWith("migrated opening") !== true
        ? shiftMonth(row.accrualPeriodEnd, 2)
        : row.postedMonth,
      amount: cents(row.amount),
    }));

  const expectedActual: Array<{ month: string; amount: bigint }> = [];
  const expectedVisible: Array<{ month: string; amount: bigint }> = [];
  if (earliestSetting && openingCents !== 0n) {
    expectedActual.push({ month: earliestSetting.effectiveFrom, amount: openingCents });
    expectedVisible.push({ month: earliestSetting.effectiveFrom, amount: openingCents });
  }
  if (legacy.slug === "cometa") {
    const allQuarterGross = new Map<string, bigint>();
    for (const deposit of deposits) {
      const period = independentPeriod(legacy.slug, deposit.month);
      allQuarterGross.set(period.end, (allQuarterGross.get(period.end) ?? 0n) + cents(deposit.amount));
      expectedActual.push({ month: period.posted, amount: cents(deposit.amount) });
    }
    for (const posted of payrollPeriods.keys()) expectedActual.push({ month: posted, amount: -300n });
    if (payrollPeriods.size > 0) expectedActual.push({ month: [...payrollPeriods.keys()].sort()[0]!, amount: -1032n });

    const orderedQuarters = [...allQuarterGross].sort(([a], [b]) => a.localeCompare(b));
    for (const [quarterEnd, gross] of orderedQuarters) {
      expectedVisible.push({ month: shiftMonth(quarterEnd, 2), amount: gross - 300n });
    }
    if (orderedQuarters.length > 0) expectedVisible.push({ month: shiftMonth(orderedQuarters[0]![0], 2), amount: -1032n });
  } else {
    for (const deposit of deposits) {
      expectedActual.push({ month: deposit.month, amount: cents(deposit.amount) });
      expectedVisible.push({ month: deposit.month, amount: cents(deposit.amount) });
    }
  }

  const earliestMonth = [...deposits].sort((a, b) => a.month.localeCompare(b.month))[0]!.month;
  const lastActual = expectedActual.map((row) => row.month).sort().at(-1) ?? currentMonth;
  const lastVisible = expectedVisible.map((row) => row.month).sort().at(-1) ?? currentMonth;
  const endMonth = [currentMonth, lastActual, lastVisible].sort().at(-1)!;
  let timingDifferences = 0;
  const months = monthSpan(earliestMonth, endMonth);
  for (const month of months) {
    const expectedActualCents = sumThrough(expectedActual, month);
    const actualCents = sumThrough(migratedActual, month);
    if (expectedActualCents !== actualCents) {
      throw new ValidationError(
        `${legacy.slug} ${month}: actual-posting legacy ${show(expectedActualCents)}, new ${show(actualCents)}`,
      );
    }
    const expectedVisibleCents = sumThrough(expectedVisible, month);
    const projectedVisibleCents = sumThrough(migratedVisible, month);
    if (expectedVisibleCents !== projectedVisibleCents) {
      throw new ValidationError(
        `${legacy.slug} ${month}: legacy-visible expected ${show(expectedVisibleCents)}, migrated projection ${show(projectedVisibleCents)}`,
      );
    }
    if (expectedVisibleCents !== expectedActualCents) {
      timingDifferences += 1;
      console.log(
        `TIMING ${legacy.slug} ${month}: actual +1 ${show(expectedActualCents)}; legacy visible +2 ${show(expectedVisibleCents)} (intentional)`,
      );
    }
  }
  console.log(
    `CHECK ${legacy.slug}: ${deposits.length} legacy deposits, ${valuationMonths} canonical valuations, `
    + `${rows.filter((row) => row.source === "migration" || row.source === "system").length} migrated/system financial rows`,
  );
  return { examined: months.length, timingDifferences };
}

async function validate(tx: DbClient): Promise<{ funds: number; examined: number; timingDifferences: number }> {
  const owner = await resolveOwner(tx);
  const legacy = (await tx.select().from(legacyFunds).orderBy(asc(legacyFunds.id))) as LegacyFundInput[];
  if (legacy.length === 0) throw new ValidationError("Examined 0 legacy funds");
  if (!legacy.some((row) => row.slug === "fideuram") || !legacy.some((row) => row.slug === "cometa")) {
    throw new ValidationError("Both fideuram and cometa legacy funds must be present and valued");
  }
  const settings = (await tx.select().from(fundSettings).orderBy(asc(fundSettings.effectiveFrom))) as LegacySettingInput[];
  const deposits = (await tx.select().from(fundDeposits).orderBy(asc(fundDeposits.month))) as LegacyDepositInput[];
  const currentMonth = monthKey(new Date());
  let examined = 0;
  let timingDifferences = 0;
  for (const fund of legacy) {
    const result = await validateFund(
      tx,
      owner,
      fund,
      settings.filter((row) => row.fundId === fund.id),
      deposits.filter((row) => row.fundId === fund.id),
      currentMonth,
    );
    examined += result.examined;
    timingDifferences += result.timingDifferences;
  }
  if (examined === 0) throw new ValidationError("Examined 0 fund-months");
  return { funds: legacy.length, examined, timingDifferences };
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
    console.log(
      `OK (${result.funds} funds, ${result.examined} months examined); `
      + `${result.timingDifferences} intentional Cometa monthly timing difference(s) proved`,
    );
  } catch (error) {
    console.error(`FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
