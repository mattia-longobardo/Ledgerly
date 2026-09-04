import type { LeaveFraction, LeaveKind } from "@/lib/clients/trek";
import { isProviderConnectedForPrincipal } from "@/modules/integrations/ui/principal-connection";
import { leaveVariance, flaggedMonths, type LeaveMonthVariance } from "@/lib/calc/leave-variance";
import { leaveTakenByMonth } from "@/lib/calc/payroll";
import { plannedDaysByMonth } from "@/lib/jobs/trek-diff";
import * as leave from "@/lib/repo/leave";
import { verifiedPayslips } from "@/lib/repo/payslips";
import { getCachedTrekStats, type CachedTrekStats } from "@/lib/repo/trek-state";
import { monthKeyOf, romeDate } from "@/lib/time";
import type { MonthGridDay } from "@/components/ui/MonthGrid";
import { hoursPerDay } from "../../_lib/vacation";

export interface LeaveMonthView {
  /** `YYYY-MM`, the shape `MonthGrid` wants. */
  month: string;
  days: MonthGridDay[];
}

export interface LeaveDayDetail {
  fraction: LeaveFraction;
  kind: LeaveKind;
  note: string | null;
}

export interface LeaveCalendarView {
  year: number;
  /** False → the sync is off and the UI says so plainly. */
  configured: boolean;
  months: LeaveMonthView[];
  /**
   * Keyed by ISO date. The dot grid only knows full-vs-half, so the editor
   * reads the real `kind` from here — without it, opening an existing recupero
   * and pressing Save would silently turn it into ferie.
   */
  byDate: Record<string, LeaveDayDetail>;
  variance: LeaveMonthVariance[];
  flagged: LeaveMonthVariance[];
  /** Trek's own figures, as of the last sync. Null until one has run. */
  cachedStats: CachedTrekStats | null;
  /** Calendar days booked this year, halves counted as 0.5. */
  plannedDaysYtd: number;
  /** Local edits not yet accepted by Trek. */
  pendingCount: number;
  hoursPerDay: number;
  today: string;
}

function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Everything the leave calendar needs, in one read.
 *
 * Deliberately does NOT talk to Trek: a page render must not depend on an
 * upstream that may be unreachable, and `GET /stats` would write to Trek's
 * database on every refresh. The mirror in `leave_days` and the cached stats are
 * what the sync leaves behind, and they are what is rendered.
 */
export async function loadLeaveCalendar(
  year = new Date().getFullYear(),
): Promise<LeaveCalendarView> {
  const [days, earliestEver, verified, perDay, cachedStats] = await Promise.all([
    leave.daysInYear(year),
    // Across ALL years, not just this one — see the note where it is used.
    leave.earliestDate(),
    verifiedPayslips(),
    hoursPerDay(),
    getCachedTrekStats(year),
  ]);

  const today = romeDate();

  // A pending delete is already gone as far as the owner is concerned, so it
  // must not still be drawn on the calendar it was just removed from.
  const visible = days.filter((d) => d.pendingOp !== "delete");

  // The planned/actual boundary is the LATEST verified payslip's OWN month, P.
  // An Italian payslip reports the leave taken the month BEFORE it — the payslip
  // covering month M is the one for M+1 — so until that payslip is verified M
  // has no actual and stays "previsto" (the owner: "Agosto è ancora planned
  // perché è il payslip di settembre che segnerà le vacanze di agosto"). Derive
  // P from the payslip's OWN month, never from `leaveTakenByMonth`'s months,
  // which are already shifted to P−1 — reading those would double-shift. The
  // tredicesima carries no leave usage, so it is excluded. No verified payslip →
  // boundary null → every month is planned. The calendar tone AND the variance
  // table below read this one value, so they can never disagree about a month.
  const latestPayslipMonth = verified
    .filter((p) => !p.isThirteenth)
    .reduce<string | null>((max, p) => (max === null || p.month > max ? p.month : max), null);
  const firstPlannedMonth = latestPayslipMonth ? monthKeyOf(latestPayslipMonth) : null;

  const months: LeaveMonthView[] = monthsOf(year).map((month) => ({
    month,
    days: visible
      .filter((d) => d.date.startsWith(month))
      .map((d) => ({
        date: d.date,
        kind: d.fraction === 0.5 ? ("half" as const) : ("full" as const),
        // Tone follows the SAME payslip boundary as the variance table, not the
        // calendar date. A month stays "previsto" (planned) until the payslip
        // that covers it is verified; since an Italian payslip records the leave
        // of the month BEFORE it, a day is only "taken" once its month is
        // strictly before P (its covering P-month payslip is in hand). So August
        // reads planned until September's payslip lands, even though it is past.
        // No verified payslip → boundary null → every day is planned.
        tone:
          firstPlannedMonth === null || monthKeyOf(d.date) >= firstPlannedMonth
            ? ("planned" as const)
            : ("taken" as const),
        ...(d.note ? { note: d.note } : {}),
      })),
  }));

  const planned = plannedDaysByMonth(visible);

  // The boundary of what the calendar KNOWS, which is the oldest day it has
  // ever held — deliberately not `visible[0]`, the first booking of the year on
  // screen. Those coincide only in a year that starts with a day off; in every
  // other year the first booking is months in, and treating everything before
  // it as uncovered silences exactly the discrepancy this report exists for: a
  // payslip charging ferie in February against a February the owner never
  // entered. Within a covered year an empty month means zero days planned, and
  // an actual against zero is a real flag. `firstPlannedMonth` (P), derived once
  // above and shared with the calendar tone, is the upper boundary.
  const variance = leaveVariance({
    planned,
    actual: leaveTakenByMonth(verified, perDay),
    ...(firstPlannedMonth ? { firstPlannedMonth } : {}),
    ...(earliestEver ? { earliestCalendarMonth: monthKeyOf(earliestEver) } : {}),
  });

  const byDate: Record<string, LeaveDayDetail> = {};
  for (const d of visible) {
    byDate[d.date] = { fraction: d.fraction, kind: d.kind, note: d.note };
  }

  return {
    year,
    configured: await isProviderConnectedForPrincipal("trek"),
    months,
    byDate,
    variance,
    flagged: flaggedMonths(variance),
    cachedStats,
    plannedDaysYtd: Number(planned.reduce((sum, p) => sum + p.days, 0).toFixed(2)),
    pendingCount: days.filter((d) => d.pendingOp !== "none").length,
    hoursPerDay: perDay,
    today,
  };
}
