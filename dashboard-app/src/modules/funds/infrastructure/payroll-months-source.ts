import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { payrollRecords } from "@/lib/db/schema";
import { monthKeyOf } from "@/lib/time";
import type { PayrollMonthsSource } from "../application/ports";

export function drizzlePayrollMonthsSource(db: DbClient): PayrollMonthsSource {
  async function records(userId: string): Promise<{ id: string; month: string }[]> {
    const rows = await db
      .select({ id: payrollRecords.id, periodStart: payrollRecords.periodStart })
      .from(payrollRecords)
      .where(and(
        eq(payrollRecords.userId, userId),
        eq(payrollRecords.kind, "ordinary"),
        isNull(payrollRecords.supersededAt),
      ))
      .orderBy(asc(payrollRecords.periodStart), asc(payrollRecords.id));
    return rows.map((row) => ({ id: row.id, month: monthKeyOf(row.periodStart) }));
  }

  return {
    async liveMonths(userId) {
      return [...new Set((await records(userId)).map((row) => row.month))];
    },
    liveRecords: records,
  };
}
