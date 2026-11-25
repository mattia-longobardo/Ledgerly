// Time off · the one serializer of the year (audit API-2, TOF-7): the route `GET /timeoff/{year}` and
// the tool `get_time_off` answer through it. The provider of the external calendar does not reach the
// wire (rule M12, TOF-2): a day it brought is `external`. The year speaks of the person's types of
// leave only (R5g); R5f removed the fields of the two old kinds.
import type { z } from "zod";
import type { TIMEOFF } from "@ledgerly/api-contract";
import type { timeOffView } from "@ledgerly/domain/timeoff";

type Year = z.input<typeof TIMEOFF.timeoff.getTimeOff.response>;
type View = Awaited<ReturnType<typeof timeOffView>>;

/** The Time off page of one year. */
export function timeOffYear(view: View, external: Year["external"]): Year {
  const { rows, balances, types, unrecorded, overdrawn, totals, months, ...rest } = view;
  const withMinutes = <D extends { minutes?: number | null }>(list: readonly D[]) =>
    list.map((day) => ({ ...day, minutes: day.minutes ?? null }));

  return {
    ...rest,
    types: types.map(({ id, name, color, unit, hasAllowance, toCalendar }) => ({
      id,
      name,
      color,
      unit,
      hasAllowance,
      toCalendar,
    })),
    balances: balances.map((balance) => ({
      ...balance,
      residualInput: {
        ...balance.residualInput,
        today: balance.residualInput.today ?? null,
        days: withMinutes(balance.residualInput.days),
      },
      forecastInput: { ...balance.forecastInput, days: withMinutes(balance.forecastInput.days) },
    })),
    external,
    unrecordedByType: unrecorded,
    overdrawnByType: overdrawn,
    totals: {
      takenMinutes: totals.takenMinutes,
      plannedMinutes: totals.plannedMinutes,
      totalMinutes: totals.totalMinutes,
      byType: totals.byType,
    },
    months: months.map(({ payroll, recorded, ...month }) => ({
      ...month,
      payrollByType: payroll,
      recordedByType: recorded,
    })),
    rows: rows.map((row) => {
      if (row.source === "payroll") return row as Extract<Year["rows"][number], { source: "payroll" }>;
      const { origin, pending, ...day } = row;
      return {
        ...day,
        origin: origin === "manual" ? "manual" : "external",
        sync: pending,
      };
    }),
  };
}
