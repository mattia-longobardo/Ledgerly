// The civil dates of the domain live in `packages/format` (decision of 19/11/2026), which the domain and `packages/ui`
// share: this entry keeps the domain's path for the files that import it.
export {
  addDays,
  addMonths,
  type CivilDate,
  civilDateIn,
  dayNumber,
  dayOfWeek,
  daysBetween,
  isCivilDate,
  lastDayOfMonth,
  minutesOfDayIn,
  monthKey,
  type MonthKey,
  monthsApart,
  monthsBetween,
  startOfDayIn,
  today,
  utcOffsetLabel,
  wallClockIn,
} from "@ledgerly/format/dates";
