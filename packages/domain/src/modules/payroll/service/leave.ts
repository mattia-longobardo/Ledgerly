import { and, asc, eq, sql } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type LeaveKind } from "../fields";
import { leaveBalanceSnapshots, payrollLeaveEvents, payslips } from "../schema";

/* What time off reads from here (plan F7 §3.1) */

/**
 * A leave balance as one applied payslip printed it. `timeoff` reads these through this function
 * rather than the table: the dependency runs one way, and payroll does not know time off exists.
 */
interface LeaveSnapshot {
  kind: LeaveKind;
  /** The payslip's own month. */
  period: string;
  previousYearHours: number | null;
  accruedHours: number | null;
  usedHours: number | null;
  remainingHours: number | null;
}

/** Leave taken, as an applied payslip accounted for it, in the month it was used. */
interface LeaveEvent {
  kind: LeaveKind;
  hours: number;
  /** The payslip's own month. */
  payrollPeriod: string;
  /** The month the hours were used in: the payslip's month minus one (spec §7.8). */
  usagePeriod: string;
}

const hoursOf = (value: string | null): number | null => (value === null ? null : Number(value));

/**
 * Every leave snapshot an **applied** payslip printed, oldest first (spec §7.8); `year` keeps the
 * payslips of one calendar year.
 *
 * Only active payslips count: a superseded one and the rectification that replaced it would
 * otherwise both offer a snapshot for the same month, and the residual would pick whichever came
 * out of the database first. The order is deterministic so the caller can take the last one.
 */
async function appliedLeaveSnapshots(ctx: Pick<Ctx, "userId">, year?: number): Promise<LeaveSnapshot[]> {
  const rows = await getDb()
    .select({
      kind: leaveBalanceSnapshots.kind,
      period: leaveBalanceSnapshots.period,
      previousYear: leaveBalanceSnapshots.previousYear,
      accrued: leaveBalanceSnapshots.accrued,
      used: leaveBalanceSnapshots.used,
      remaining: leaveBalanceSnapshots.remaining,
    })
    .from(leaveBalanceSnapshots)
    .innerJoin(payslips, eq(payslips.id, leaveBalanceSnapshots.payslipId))
    .where(
      and(
        userScoped(ctx).owns(leaveBalanceSnapshots),
        eq(payslips.active, true),
        year === undefined ? undefined : sql`extract(year from ${leaveBalanceSnapshots.period}) = ${year}`,
      ),
    )
    .orderBy(asc(leaveBalanceSnapshots.period), asc(leaveBalanceSnapshots.kind));

  return rows.map((row) => ({
    kind: row.kind,
    period: row.period,
    previousYearHours: hoursOf(row.previousYear),
    accruedHours: hoursOf(row.accrued),
    usedHours: hoursOf(row.used),
    remainingHours: hoursOf(row.remaining),
  }));
}

/** Every leave snapshot an **applied** payslip of `year` printed, oldest first (spec §7.8). */
export function leaveSnapshotsOf(ctx: Pick<Ctx, "userId">, year: number): Promise<LeaveSnapshot[]> {
  return appliedLeaveSnapshots(ctx, year);
}

/**
 * Every leave snapshot of every year, oldest first: what a balance is forecast from. The last
 * payslip may be of the year before the one on the screen, and the monthly accrual is the
 * difference between one payslip's MAT. and the next (`docs/design/timeoff-accrual.md`).
 */
export function leaveSnapshotHistory(ctx: Pick<Ctx, "userId">): Promise<LeaveSnapshot[]> {
  return appliedLeaveSnapshots(ctx);
}

/**
 * Every leave event of `year`, by the month the hours were **used** in, oldest first — which is
 * the year the interface shows them under, not the year of the payslip that reported them. A
 * January payslip reports December, and December belongs to the year before.
 */
export async function leaveEventsOf(ctx: Pick<Ctx, "userId">, year: number): Promise<LeaveEvent[]> {
  const rows = await getDb()
    .select({
      kind: payrollLeaveEvents.kind,
      hours: payrollLeaveEvents.hours,
      payrollPeriod: payrollLeaveEvents.payrollPeriod,
      usagePeriod: payrollLeaveEvents.usagePeriod,
    })
    .from(payrollLeaveEvents)
    .innerJoin(payslips, eq(payslips.id, payrollLeaveEvents.payslipId))
    .where(
      and(
        userScoped(ctx).owns(payrollLeaveEvents),
        eq(payslips.active, true),
        sql`extract(year from ${payrollLeaveEvents.usagePeriod}) = ${year}`,
      ),
    )
    .orderBy(asc(payrollLeaveEvents.usagePeriod), asc(payrollLeaveEvents.kind));

  return rows.map((row) => ({
    kind: row.kind,
    hours: Number(row.hours),
    payrollPeriod: row.payrollPeriod,
    usagePeriod: row.usagePeriod,
  }));
}
