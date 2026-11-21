// Time off · the one serializer of the year and of an allowance (audit API-2, TOF-7): the route
// `GET /timeoff/{year}` and the tool `get_time_off` answer through these. The provider of the
// external calendar does not reach the wire (rule M12, TOF-2): a day it brought is `external`.
import type { z } from "zod";
import type { TIMEOFF } from "@ledgerly/api-contract";
import type { Allowance, timeOffView } from "@ledgerly/domain/timeoff";

type Year = z.input<typeof TIMEOFF.timeoff.getTimeOff.response>;
type WireAllowance = z.input<typeof TIMEOFF.timeoff.saveTimeOffAllowance.response>;
type View = Awaited<ReturnType<typeof timeOffView>>;

const days = (value: string | null): number | null => (value === null ? null : Number(value));
/** The days a residual or a forecast weighs, as a list of the wire. */
const withDays = <D, T extends { days: readonly D[] }>(input: T & { days: readonly D[] }) => ({
  ...input,
  days: [...input.days],
});

/** An allowance in days, as Time off › Settings shows it: `numeric(5,2)` "26.00" is 26. */
export function allowanceOut(allowance: Allowance): WireAllowance {
  return {
    year: allowance.year,
    vacationDays: days(allowance.vacationDays),
    rolDays: days(allowance.rolDays),
    totalDays: days(allowance.totalDays),
    note: allowance.note,
  };
}

/** The Time off page of one year. */
export function timeOffYear(view: View): Year {
  const { allowance, rows, residualInputs, forecastInputs, ...rest } = view;
  return {
    ...rest,
    residualInputs: { vacation: withDays(residualInputs.vacation), rol: withDays(residualInputs.rol) },
    forecastInputs: { vacation: withDays(forecastInputs.vacation), rol: withDays(forecastInputs.rol) },
    allowance: allowance === null ? null : allowanceOut(allowance),
    rows: rows.map((row) => {
      if (row.source === "payroll") return row;
      const { origin, pending, ...day } = row;
      return { ...day, origin: origin === "manual" ? "manual" : "external", sync: pending };
    }),
  };
}
