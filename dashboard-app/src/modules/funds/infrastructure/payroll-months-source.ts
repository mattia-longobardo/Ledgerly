import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollRecords } from "@/lib/db/schema";
import { monthKeyOf } from "@/lib/time";
import type { PayrollMonthsSource } from "../application/ports";

export function drizzlePayrollMonthsSource(db: DbClient): PayrollMonthsSource {
  async function records(userId: string, includeExtraordinary = false): Promise<{ id: string; month: string }[]> {
    const predicates = [eq(payrollRecords.userId, userId), isNull(payrollRecords.supersededAt)];
    if (!includeExtraordinary) predicates.push(eq(payrollRecords.kind, "ordinary"));
    const rows = await db
      .select({ id: payrollRecords.id, periodStart: payrollRecords.periodStart })
      .from(payrollRecords)
      .where(and(...predicates))
      .orderBy(asc(payrollRecords.periodStart), asc(payrollRecords.id));
    return rows.map((row) => ({ id: row.id, month: monthKeyOf(row.periodStart) }));
  }

  return {
    async liveMonths(userId) {
      return [...new Set((await records(userId)).map((row) => row.month))];
    },
    liveRecords: records,
    async expectedMonths(userId, fundSlug) {
      const result = await db.execute<{ month: string }>(sql`
        SELECT DISTINCT date_trunc('month', r.period_start)::date::text AS month
        FROM payroll_records r
        WHERE r.user_id = ${userId}
          AND r.kind = 'ordinary'
          AND r.superseded_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM payroll_components c
            WHERE c.record_id = r.id
              AND c.mapped_to ->> 'kind' = 'fund_contribution'
              AND c.mapped_to ->> 'fundSlug' = ${fundSlug}
          )
        ORDER BY month`);
      return result.rows.map((row) => row.month);
    },
  };
}
