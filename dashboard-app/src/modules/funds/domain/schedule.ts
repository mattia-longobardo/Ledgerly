import { addMonths } from "@/lib/time";

export interface ScheduleRule {
  frequency: "monthly" | "quarterly" | "annual";
  periodAnchorMonth: number;
  postingLagMonths: number;
  feePerPosting: string;
}

export interface AccrualPeriod {
  start: string;
  end: string;
}

const MONTHS: Record<ScheduleRule["frequency"], number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

export function accrualPeriodFor(month: string, rule: ScheduleRule): AccrualPeriod {
  const length = MONTHS[rule.frequency];
  if (length === 1) return { start: month, end: month };

  const calendarMonth = Number(month.slice(5, 7));
  const offset = (((calendarMonth - rule.periodAnchorMonth) % length) + length) % length;
  const start = addMonths(month, -offset);
  return { start, end: addMonths(start, length - 1) };
}

export function postedMonthFor(month: string, rule: ScheduleRule): string {
  return addMonths(accrualPeriodFor(month, rule).end, rule.postingLagMonths);
}

export function effectiveRule<T extends { effectiveFrom: string }>(
  rules: readonly T[],
  month: string,
): T | null {
  return [...rules]
    .filter((rule) => rule.effectiveFrom <= month)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}
