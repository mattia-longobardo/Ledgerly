import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { timeoffBalances, type TimeoffBalanceRow } from "@/lib/db/schema";
import type { BalancesRepository, TimeoffBalance } from "../application/ports";

function toBalance(row: TimeoffBalanceRow): TimeoffBalance {
  return {
    id: row.id,
    userId: row.userId,
    typeId: row.typeId,
    asOf: row.asOf,
    accrued: row.accrued,
    used: row.used,
    remaining: row.remaining,
    pending: row.pending,
    unit: row.unit as TimeoffBalance["unit"],
    source: row.source as TimeoffBalance["source"],
    payrollRecordId: row.payrollRecordId,
    createdAt: row.createdAt,
  };
}

/**
 * Postgres-backed balances. One row per (type, payroll record), written only
 * by the apply step (R7-4) — nothing here ever invents a figure.
 */
export class DrizzleBalancesRepository implements BalancesRepository {
  constructor(private readonly db: DbClient) {}

  async latestPerType(userId: string): Promise<Map<string, TimeoffBalance>> {
    // `as_of` then `id` (uuidv7, so creation-ordered): two payslips stamped
    // with the same period end resolve to the one applied last, never to
    // whichever tuple Postgres happens to return first.
    const rows = await this.db
      .select()
      .from(timeoffBalances)
      .where(eq(timeoffBalances.userId, userId))
      .orderBy(asc(timeoffBalances.asOf), asc(timeoffBalances.id));
    const latest = new Map<string, TimeoffBalance>();
    for (const row of rows) latest.set(row.typeId, toBalance(row));
    return latest;
  }

  async listForYear(userId: string, year: number): Promise<TimeoffBalance[]> {
    const rows = await this.db
      .select()
      .from(timeoffBalances)
      .where(and(
        eq(timeoffBalances.userId, userId),
        gte(timeoffBalances.asOf, `${year}-01-01`),
        lte(timeoffBalances.asOf, `${year}-12-31`),
      ))
      .orderBy(asc(timeoffBalances.asOf), asc(timeoffBalances.id));
    return rows.map(toBalance);
  }

  async upsertForRecord(input: Omit<TimeoffBalance, "id" | "createdAt">): Promise<TimeoffBalance> {
    const [row] = await this.db
      .insert(timeoffBalances)
      .values(input)
      .onConflictDoUpdate({
        target: [timeoffBalances.typeId, timeoffBalances.payrollRecordId],
        targetWhere: sql`payroll_record_id IS NOT NULL`,
        set: {
          asOf: input.asOf,
          accrued: input.accrued,
          used: input.used,
          remaining: input.remaining,
          pending: input.pending,
          unit: input.unit,
          source: input.source,
        },
      })
      .returning();
    return toBalance(row!);
  }

  async deleteByPayrollRecord(userId: string, payrollRecordId: string): Promise<number> {
    const rows = await this.db
      .delete(timeoffBalances)
      .where(and(
        eq(timeoffBalances.userId, userId),
        eq(timeoffBalances.payrollRecordId, payrollRecordId),
      ))
      .returning({ id: timeoffBalances.id });
    return rows.length;
  }
}
