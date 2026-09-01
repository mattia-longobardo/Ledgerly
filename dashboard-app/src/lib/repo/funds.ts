import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { fundDeposits, fundSettings, funds } from "@/lib/db/schema";

export async function listFunds() {
  return db.select().from(funds).orderBy(asc(funds.id));
}

export async function fundBySlug(slug: string) {
  const [row] = await db.select().from(funds).where(eq(funds.slug, slug)).limit(1);
  return row ?? null;
}

export async function settingsFor(fundId: number) {
  return db
    .select()
    .from(fundSettings)
    .where(eq(fundSettings.fundId, fundId))
    .orderBy(asc(fundSettings.effectiveFrom));
}

export async function allSettings() {
  return db.select().from(fundSettings).orderBy(asc(fundSettings.fundId), asc(fundSettings.effectiveFrom));
}

/** A mode switch is a new effective-dated row; history is never rewritten. */
export async function addSetting(input: {
  fundId: number;
  effectiveFrom: string;
  initialCapital: string;
  depositMode: "fixed" | "payroll";
  fixedMonthlyAmount: string | null;
}) {
  const [row] = await db
    .insert(fundSettings)
    .values(input)
    .onConflictDoUpdate({
      target: [fundSettings.fundId, fundSettings.effectiveFrom],
      set: {
        initialCapital: input.initialCapital,
        depositMode: input.depositMode,
        fixedMonthlyAmount: input.fixedMonthlyAmount,
      },
    })
    .returning();
  return row;
}

export async function effectiveSettingAt(fundId: number, month: string) {
  const [row] = await db
    .select()
    .from(fundSettings)
    .where(and(eq(fundSettings.fundId, fundId), lte(fundSettings.effectiveFrom, month)))
    .orderBy(desc(fundSettings.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export async function depositsFor(fundId: number) {
  return db
    .select()
    .from(fundDeposits)
    .where(eq(fundDeposits.fundId, fundId))
    .orderBy(asc(fundDeposits.month));
}

export async function allDeposits() {
  return db.select().from(fundDeposits).orderBy(asc(fundDeposits.fundId), asc(fundDeposits.month));
}

/** Both modes write here, so totals never branch on mode. One row per month. */
export async function upsertDeposit(input: {
  fundId: number;
  month: string;
  amount: string;
  employeePart?: string | null;
  employerPart?: string | null;
  source: "fixed" | "payroll" | "manual";
  payslipId?: number | null;
}) {
  const [row] = await db
    .insert(fundDeposits)
    .values({
      fundId: input.fundId,
      month: input.month,
      amount: input.amount,
      employeePart: input.employeePart ?? null,
      employerPart: input.employerPart ?? null,
      source: input.source,
      payslipId: input.payslipId ?? null,
    })
    .onConflictDoUpdate({
      target: [fundDeposits.fundId, fundDeposits.month],
      set: {
        amount: input.amount,
        employeePart: input.employeePart ?? null,
        employerPart: input.employerPart ?? null,
        source: input.source,
        payslipId: input.payslipId ?? null,
      },
    })
    .returning();
  return row;
}
