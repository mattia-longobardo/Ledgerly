import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { vacationAccrualRate, vacationLedger } from "@/lib/db/schema";

export async function ledger() {
  return db.select().from(vacationLedger).orderBy(asc(vacationLedger.occurredAt));
}

export async function recentLedger(limit = 50) {
  return db.select().from(vacationLedger).orderBy(desc(vacationLedger.occurredAt)).limit(limit);
}

export async function balance(): Promise<number> {
  const result = await db.execute<{ total: string | null }>(
    sql`SELECT COALESCE(SUM(amount), 0)::text AS total FROM vacation_ledger`,
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function addEntry(input: {
  entryType: "initial" | "accrual" | "withdrawal" | "adjustment";
  amount: string;
  month?: string | null;
  note?: string | null;
  occurredAt?: Date;
}) {
  const [row] = await db
    .insert(vacationLedger)
    .values({
      entryType: input.entryType,
      amount: input.amount,
      month: input.month ?? null,
      note: input.note ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  return row;
}

/** Undo for the 10 s toast: withdrawals are the only reversible entry type. */
export async function deleteEntry(id: number) {
  await db.delete(vacationLedger).where(eq(vacationLedger.id, id));
}

export async function rates() {
  return db.select().from(vacationAccrualRate).orderBy(asc(vacationAccrualRate.effectiveFrom));
}

/** "Change X going forward" — a new row; past accruals stay untouched. */
export async function setRate(effectiveFrom: string, monthlyAmount: string) {
  const [row] = await db
    .insert(vacationAccrualRate)
    .values({ effectiveFrom, monthlyAmount })
    .onConflictDoUpdate({
      target: vacationAccrualRate.effectiveFrom,
      set: { monthlyAmount },
    })
    .returning();
  return row;
}
