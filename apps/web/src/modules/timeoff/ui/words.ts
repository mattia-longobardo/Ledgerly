// What the Time off page says about the figures of `GET /timeoff/{year}`: every total arrives in
// minutes, and these are the only places they become something to read. Nothing here adds anything
// up: a sentence turns minutes into days and formats them.
import type { useTranslations } from "next-intl";
import type { timeoff } from "@ledgerly/api-contract/timeoff";
import type { RouteOutput } from "@ledgerly/api-client";
import { formatDate, NULL_DISPLAY, type UiLocale } from "@ledgerly/format/format";

export type View = RouteOutput<typeof timeoff.getTimeOff>;
type KindView = View["vacation"];
type ResidualView = KindView["residual"];
type AccrualView = View["accrual"]["vacation"];
type Overdrawn = View["overdrawn"][number];
export type MonthGroup = View["months"][number];
export type MonthBar = View["bars"][number];

/** What every sentence needs: the words of the module, the reader's language and a day's length. */
export interface Say {
  text: ReturnType<typeof useTranslations<"timeoff">>;
  locale: UiLocale;
  minutesPerDay: number;
}

export function formatNumber(value: number, locale: UiLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** A minute total in days, with its unit: "2.5 d". */
export function daysOf(say: Say, minutes: number): string {
  return say.text("units.days", { amount: formatNumber(minutes / say.minutesPerDay, say.locale) });
}

/** A minute total as a card prints it: bare days, or the dash of a residual nobody can compute. */
export function bareDays(say: Say, minutes: number | null): string {
  return minutes === null ? NULL_DISPLAY : formatNumber(minutes / say.minutesPerDay, say.locale);
}

const monthYear = (say: Say, month: string | null) => formatDate(month, "monthYear", say.locale);

/**
 * The one sentence that says where a residual came from — §7.9 asks for it on every card. The
 * allowance wording comes in two: a card with nothing carried over must not claim a carry-over,
 * and ROL never has one.
 */
function basisNote(say: Say, residual: ResidualView, carriedMinutes: number): string {
  switch (residual.basis) {
    case "payslip":
      return say.text("basis.payslip", {
        payslip: monthYear(say, residual.snapshotPeriod),
        through: monthYear(say, residual.countedThrough),
      });
    case "allowance":
      return carriedMinutes > 0 ? say.text("basis.allowance") : say.text("basis.allowanceOnly");
    case "unknown":
      return say.text("basis.unknown");
  }
}

/**
 * What a breached balance says. With an accrual behind it (N9) the sentence names the day the
 * booking outran it, because "you are two days over" is not actionable and "you are two days over
 * by 12 August" is: it says which days to move.
 */
export function overdrawnLine(say: Say, over: Overdrawn): string {
  const kind = say.text(`kinds.${over.kind}`);
  const amount = daysOf(say, over.byMinutes);
  if (over.onDate !== null) {
    const date = formatDate(over.onDate, "long", say.locale);
    return over.basis === "payslip"
      ? say.text("overdrawn.byDate", { kind, amount, date })
      : say.text("overdrawn.allowanceByDate", { kind, amount, date });
  }
  return over.basis === "payslip"
    ? say.text("overdrawn.payslip", { kind, amount, month: monthYear(say, over.snapshotPeriod) })
    : say.text("overdrawn.allowance", { kind, amount });
}

/**
 * What a card says about the accrual (release N5.1): the month's worth and the forecast for the end
 * of the year. A rate that is the allowance over twelve says that it is an estimate; a card with no
 * rate says why there is no forecast, where there is an allowance or a payslip to expect one from.
 */
function accrualNotes(say: Say, accrual: AccrualView, residual: ResidualView): string[] {
  if (accrual.rate === null) return residual.basis === "unknown" ? [] : [say.text("accrual.none")];
  const notes = [say.text("accrual.perMonth", { amount: daysOf(say, accrual.rate.minutesPerMonth) })];
  if (accrual.yearEndMinutes !== null && !accrual.leads) {
    notes.push(say.text("accrual.yearEnd", { amount: daysOf(say, accrual.yearEndMinutes) }));
  }
  if (accrual.rate.source === "allowance") notes.push(say.text("accrual.fromAllowance"));
  return notes;
}

/** How much of a card's bar one part fills: against the whole allowance, not against the residual. */
function shareOf(part: number, residual: ResidualView): number {
  const whole = (residual.remainingMinutes ?? 0) + residual.takenMinutes + residual.plannedMinutes;
  return whole <= 0 ? 0 : part / whole;
}

/**
 * What the two headline cards have in common. A year with a payslip or an allowance of its own
 * leads with the residual; a year with neither, read from an earlier payslip, leads with the
 * forecast and says that it is one (decision D6).
 */
export function cardOf(
  say: Say,
  { residual, allowanceMinutes, carriedMinutes }: KindView,
  accrual: AccrualView,
) {
  const { text } = say;
  return {
    allowanceNote:
      allowanceMinutes === null ? "" : text("cards.perYear", { amount: daysOf(say, allowanceMinutes) }),
    value: bareDays(say, accrual.leads ? accrual.yearEndMinutes : residual.remainingMinutes),
    valueUnit: accrual.leads ? text("accrual.daysForecast") : text("cards.daysRemaining"),
    takenNote: text("cards.taken", { amount: daysOf(say, residual.takenMinutes) }),
    basisNote: accrual.leads
      ? text("accrual.basis", { payslip: monthYear(say, accrual.payslipPeriod) })
      : basisNote(say, residual, carriedMinutes),
    accrualNotes: accrualNotes(say, accrual, residual),
    takenShare: shareOf(residual.takenMinutes, residual),
    plannedShare: shareOf(residual.plannedMinutes, residual),
  };
}

/** The line beside the heading: the allowance of each kind and what the payslip carried over. */
export function headline(say: Say, view: View): string {
  const { text } = say;
  return [
    view.vacation.allowanceMinutes === null
      ? null
      : text("header.vacationDays", { amount: bareDays(say, view.vacation.allowanceMinutes) }),
    // Days here too (N5): one unit on the whole screen, whatever the contract states ROL in.
    view.rol.allowanceMinutes === null
      ? null
      : text("header.rolHours", { amount: daysOf(say, view.rol.allowanceMinutes) }),
    // What the payslip carried over, not what anybody typed (N9).
    view.vacation.carriedMinutes > 0
      ? text("header.carried", { days: daysOf(say, view.vacation.carriedMinutes) })
      : null,
  ]
    .filter((one): one is string => one !== null)
    .join(" · ");
}

/** What a month's heading says: the payslip's count, what is written down, and what is planned. */
export function monthSummary(say: Say, month: MonthGroup): string {
  const { text } = say;
  const parts = [
    month.payroll === null
      ? text("table.monthNoPayroll")
      : text("table.monthPayroll", {
          vacation: daysOf(say, month.payroll.vacationMinutes),
          rol: daysOf(say, month.payroll.rolMinutes),
        }),
    text("table.monthRecorded", {
      vacation: daysOf(say, month.recorded.vacationMinutes),
      rol: daysOf(say, month.recorded.rolMinutes),
    }),
  ];
  if (month.plannedMinutes > 0)
    parts.push(text("table.monthPlanned", { amount: daysOf(say, month.plannedMinutes) }));
  if (month.missingMinutes > 0)
    parts.push(text("table.monthMissing", { amount: daysOf(say, month.missingMinutes) }));
  return parts.join(" · ");
}

/** The twelve months of the year, in full ("August") and short ("Aug"). */
export function monthNamesOf(year: number, locale: UiLocale): { long: string[]; short: string[] } {
  const first = (index: number) => `${year}-${String(index + 1).padStart(2, "0")}-01`;
  const months = Array.from({ length: 12 }, (_unused, index) => first(index));
  return {
    long: months.map((month) => formatDate(month, "monthYear", locale).split(" ")[0]),
    short: months.map((month) => formatDate(month, "month", locale)),
  };
}
