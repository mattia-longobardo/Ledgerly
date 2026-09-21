import { TriangleAlert } from "lucide-react";
import type { Metadata, Route } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type LeaveRow, timeOffView } from "@/modules/timeoff/queries";
import type { MonthBar, MonthGroup, Overdrawn, ResidualView } from "@/modules/timeoff/rules";
import { KindCard, MonthBars } from "@/modules/timeoff/ui/kind-card";
import {
  type AllowanceSummary,
  type LeaveSummary,
  AddLeave,
  EditAllowance,
  RowActions,
} from "@/modules/timeoff/ui/leave-actions";
import { KIND_CLASS, weekdayInitials } from "@/modules/timeoff/ui/kinds";
import { YearCalendar } from "@/modules/timeoff/ui/year-calendar";
import { requireSession } from "@/platform/auth/session";
import { today as todayIn } from "@/platform/dates";
import { formatDate, NULL_DISPLAY, type UiLocale } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { GroupRow, Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("timeoff"))("title") };
}

/** Which rows the table shows; the design's three filters. */
type Filter = "all" | "taken" | "planned";
const FILTERS: Filter[] = ["all", "taken", "planned"];

/**
 * Time off (spec §7.9): the year's allowance, what is left of it and where that number comes
 * from, the twelve months as bars and as calendars, and every day behind them.
 *
 * The year and the filter are in the URL rather than in component state: a year worth looking at
 * is a year worth linking to, and the whole screen is read on the server anyway.
 */
export default async function TimeOffPage({ searchParams }: PageProps<"/timeoff">) {
  const ctx = await requireSession();
  const t = await getTranslations("timeoff");
  const query = await searchParams;
  const locale = ctx.locale as UiLocale;

  const currentYear = Number(todayIn(ctx.timeZone).slice(0, 4));
  const asked = Number(Array.isArray(query.year) ? query.year[0] : query.year);
  const year = Number.isInteger(asked) && asked >= 1990 && asked <= 2200 ? asked : currentYear;
  const filter = asFilter(Array.isArray(query.filter) ? query.filter[0] : query.filter);

  const view = await timeOffView(ctx, year);
  // Every total arrives in minutes; these two are the only places they become something to read.
  const days = (minutes: number) =>
    t("units.days", { amount: formatNumber(minutes / view.minutesPerDay, locale) });

  /**
   * The one sentence that says where a residual came from — §7.9 asks for it on every card. The
   * allowance wording comes in two: a card with nothing carried over must not claim a carry-over,
   * and ROL never has one.
   */
  const basisNote = (residual: ResidualView, carriedMinutes: number): string => {
    switch (residual.basis) {
      case "payslip":
        return t("basis.payslip", {
          payslip: formatDate(residual.snapshotPeriod, "monthYear", locale),
          through: formatDate(residual.countedThrough, "monthYear", locale),
        });
      case "allowance":
        return carriedMinutes > 0 ? t("basis.allowance") : t("basis.allowanceOnly");
      case "unknown":
        return t("basis.unknown");
    }
  };

  /**
   * What a breached balance says. With an accrual behind it (N9) the sentence names the day the
   * booking outran it, because "you are two days over" is not actionable and "you are two days
   * over by 12 August" is: it says which days to move.
   */
  const overdrawnLine = (over: Overdrawn): string => {
    const kind = t(`kinds.${over.kind}` as "kinds.vacation");
    const amount = days(over.byMinutes);
    if (over.onDate !== null) {
      const date = formatDate(over.onDate, "long", locale);
      return over.basis === "payslip"
        ? t("overdrawn.byDate", { kind, amount, date })
        : t("overdrawn.allowanceByDate", { kind, amount, date });
    }
    return over.basis === "payslip"
      ? t("overdrawn.payslip", { kind, amount, month: formatDate(over.snapshotPeriod, "monthYear", locale) })
      : t("overdrawn.allowance", { kind, amount });
  };

  const vacationResidual = view.vacation.residual;
  const rolResidual = view.rol.residual;
  /** A minute total as a card prints it: bare days, or the dash of a residual nobody can compute. */
  const asDays = (minutes: number | null) =>
    minutes === null ? NULL_DISPLAY : formatNumber(minutes / view.minutesPerDay, locale);

  const allowanceSummary: AllowanceSummary = {
    year,
    vacationDays: view.allowance?.vacationDays == null ? "" : trim(view.allowance.vacationDays),
    rolDays: view.allowance?.rolDays == null ? "" : trim(view.allowance.rolDays),
    totalDays: view.allowance?.totalDays == null ? "" : trim(view.allowance.totalDays),
    note: view.allowance?.note ?? "",
  };

  const headline = [
    view.vacation.allowanceMinutes === null
      ? null
      : t("header.vacationDays", {
          amount: formatNumber(view.vacation.allowanceMinutes / view.minutesPerDay, locale),
        }),
    view.rol.allowanceMinutes === null
      ? null
      : // Days here too (N5): one unit on the whole screen, whatever the contract states ROL in.
        t("header.rolHours", { amount: days(view.rol.allowanceMinutes) }),
    // What the payslip carried over, not what anybody typed (N9).
    view.vacation.carriedMinutes > 0
      ? t("header.carried", { days: days(view.vacation.carriedMinutes) })
      : null,
  ]
    .filter((one): one is string => one !== null)
    .join(" · ");

  const monthNames = Array.from(
    { length: 12 },
    (_, index) =>
      formatDate(`${year}-${String(index + 1).padStart(2, "0")}-01`, "monthYear", locale).split(" ")[0],
  );
  const shortNames = Array.from({ length: 12 }, (_, index) =>
    formatDate(`${year}-${String(index + 1).padStart(2, "0")}-01`, "month", locale),
  );

  /**
   * The table, month by month (N7). The payslip's own figures are no longer rows of their own:
   * they belong in the heading of the month they are about, next to what is actually written
   * down, because the whole reason to put them together is that a person can see them disagree.
   *
   * A month is shown when it holds something or when a payslip has something to say about it — so
   * a month the employer counted leave in and this calendar has nothing for still appears, which
   * is exactly the month worth looking at. Under a filter, a month with no matching day is left
   * out: the filter was asked for.
   */
  const dayRows = view.rows.filter(
    (row): row is Extract<LeaveRow, { source: "day" }> =>
      row.source === "day" && (filter === "all" || row.status === filter),
  );
  const groups = view.months
    .map((month) => ({
      month,
      rows: dayRows.filter((row) => row.on.slice(0, 7) === month.month.slice(0, 7)),
    }))
    .filter((group) =>
      filter === "all" ? group.rows.length > 0 || group.month.payroll !== null : group.rows.length > 0,
    );

  /** What a month's heading says: the payslip's count, what is written down, and what is planned. */
  const monthSummary = (month: MonthGroup): string => {
    const parts = [
      month.payroll === null
        ? t("table.monthNoPayroll")
        : t("table.monthPayroll", {
            vacation: days(month.payroll.vacationMinutes),
            rol: days(month.payroll.rolMinutes),
          }),
      t("table.monthRecorded", {
        vacation: days(month.recorded.vacationMinutes),
        rol: days(month.recorded.rolMinutes),
      }),
    ];
    if (month.plannedMinutes > 0) {
      parts.push(t("table.monthPlanned", { amount: days(month.plannedMinutes) }));
    }
    if (month.missingMinutes > 0) {
      parts.push(t("table.monthMissing", { amount: days(month.missingMinutes) }));
    }
    return parts.join(" · ");
  };

  const barLabel = (bar: MonthBar): string =>
    t("bars.label", {
      month: monthNames[bar.month - 1],
      taken: days(bar.takenMinutes),
      planned: days(bar.plannedMinutes),
    });

  /** The badges a row wears: where it came from, and what the calendar makes of it today. */
  const status = (row: LeaveRow) =>
    row.source === "payroll" ? (
      <Badge tone="neutral">{t("table.payroll")}</Badge>
    ) : (
      <>
        <Badge tone={row.status === "taken" ? "neutral" : "accent"}>
          {t(`table.statuses.${row.status}` as "table.statuses.taken")}
        </Badge>
        {row.origin === "trek" && <Badge tone="neutral">{t("table.fromTrek")}</Badge>}
        {row.pending !== "none" && (
          <Badge tone="warn">{t(`table.pending.${row.pending}` as "table.pending.upsert")}</Badge>
        )}
      </>
    );

  /**
   * The days already booked, by date, for the calendar to open in edit. Built from the same rows
   * the table shows, so clicking a day and clicking its row reach the same dialog.
   */
  const booked: Record<string, LeaveSummary[]> = {};
  for (const row of view.rows) {
    if (row.source !== "day") continue;
    booked[row.on] = [
      ...(booked[row.on] ?? []),
      {
        id: row.id,
        on: row.on,
        kind: row.kind,
        fraction: row.fraction,
        note: row.note,
        origin: row.origin,
      },
    ];
  }

  return (
    <Page
      title={t("title")}
      actions={
        <div className="flex items-center gap-2">
          <YearPicker
            year={year}
            years={view.years}
            currentYear={currentYear}
            filter={filter}
            labels={{
              label: t("header.yearLabel"),
              previous: t("header.previousYear"),
              next: t("header.nextYear"),
              today: t("header.thisYear"),
            }}
          />
        </div>
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-title font-semibold tracking-[-0.02em]">{t("heading")}</h1>
          <p className="text-muted">{headline || t("header.noAllowance")}</p>
        </div>
        <EditAllowance allowance={allowanceSummary} label={t("actions.allowance")} />
      </div>

      {/* The two parts against the total the contract states (N7): reported, never corrected. */}
      {view.allowanceMismatch !== null && (
        <p className="-mt-2 text-sm text-warn">
          {t("mismatch", {
            amount: days(Math.abs(view.allowanceMismatch) * view.minutesPerDay),
            direction: view.allowanceMismatch > 0 ? t("mismatchOver") : t("mismatchUnder"),
          })}
        </p>
      )}

      {/* Trek's own figures, beside ours and never folded into them: Trek honours a leave-year
          window (calendar, fiscal or anniversary) this app does not model (plan F7 §3.6.4). */}
      {view.trek !== null && (
        <p className="-mt-2 text-sm text-faint tabular-nums">
          {t("trekCheck", {
            total: formatNumber(view.trek.totalAvailable, locale),
            used: formatNumber(view.trek.used, locale),
            remaining: formatNumber(view.trek.remaining, locale),
          })}
        </p>
      )}

      {/*
        Leave the payslips know about and this calendar does not (M2). Above the cards on purpose:
        it is the one thing on this screen that says a number below might be wrong.
      */}
      {view.unrecorded.length > 0 && (
        <Card className="flex flex-col gap-2 border-warn/40 bg-warn-bg" data-testid="unrecorded">
          <div className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="size-[18px] shrink-0 text-warn" />
            <h2 className="font-semibold">{t("unrecorded.title", { count: view.unrecorded.length })}</h2>
          </div>
          <ul className="flex flex-col gap-1 text-sm tabular-nums">
            {view.unrecorded.map((gap) => (
              <li key={`${gap.month}-${gap.kind}`}>
                {t("unrecorded.row", {
                  month: formatDate(gap.month, "monthYear", locale),
                  kind: t(`kinds.${gap.kind}` as "kinds.vacation"),
                  payroll: days(gap.payrollMinutes),
                  recorded: days(gap.recordedMinutes),
                  missing: days(gap.missingMinutes),
                })}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">{t("unrecorded.hint")}</p>
        </Card>
      )}

      {/* Booked past what was left (N5b), measured against whichever figure the card used. */}
      {view.overdrawn.length > 0 && (
        <Card className="flex flex-col gap-2 border-neg/40 bg-neg-bg" data-testid="overdrawn">
          <div className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="size-[18px] shrink-0 text-neg" />
            <h2 className="font-semibold">{t("overdrawn.title", { count: view.overdrawn.length })}</h2>
          </div>
          <ul className="flex flex-col gap-1 text-sm tabular-nums">
            {view.overdrawn.map((over) => (
              <li key={over.kind}>{overdrawnLine(over)}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 @4xl:grid-cols-2 @6xl:grid-cols-4">
        <KindCard
          label={t("cards.vacation")}
          allowanceNote={
            view.vacation.allowanceMinutes === null
              ? ""
              : t("cards.perYear", { amount: days(view.vacation.allowanceMinutes) })
          }
          value={asDays(vacationResidual.remainingMinutes)}
          valueUnit={t("cards.daysRemaining")}
          takenNote={t("cards.taken", { amount: days(vacationResidual.takenMinutes) })}
          plannedNote={t("cards.planned", { amount: days(vacationResidual.plannedMinutes) })}
          basisNote={basisNote(vacationResidual, view.vacation.carriedMinutes)}
          takenShare={shareOf(vacationResidual.takenMinutes, vacationResidual)}
          plannedShare={shareOf(vacationResidual.plannedMinutes, vacationResidual)}
          tone="primary"
          testId="vacation-card"
        />
        <KindCard
          label={t("cards.rol")}
          allowanceNote={
            view.rol.allowanceMinutes === null
              ? ""
              : t("cards.perYear", { amount: days(view.rol.allowanceMinutes) })
          }
          value={asDays(rolResidual.remainingMinutes)}
          valueUnit={t("cards.daysRemaining")}
          takenNote={t("cards.taken", { amount: days(rolResidual.takenMinutes) })}
          plannedNote={
            rolResidual.plannedMinutes > 0
              ? t("cards.planned", { amount: days(rolResidual.plannedMinutes) })
              : null
          }
          basisNote={basisNote(rolResidual, view.rol.carriedMinutes)}
          takenShare={shareOf(rolResidual.takenMinutes, rolResidual)}
          plannedShare={shareOf(rolResidual.plannedMinutes, rolResidual)}
          tone="warn"
          testId="rol-card"
        />
        {/* What the year came to altogether (N5): every kind, and the two halves of it. */}
        <Card className="flex min-w-0 flex-col gap-2.5" data-testid="taken-card">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-muted">{t("cards.takenTitle", { year })}</span>
            <span className="text-sm text-muted tabular-nums">
              {view.totalAllowanceMinutes === null
                ? t("cards.noTotal")
                : t("cards.ofTotal", { total: days(view.totalAllowanceMinutes) })}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-kpi font-semibold tracking-[-0.02em] tabular-nums">
              {formatNumber(view.totals.totalMinutes / view.minutesPerDay, locale)}
            </span>
            <span className="text-muted">{t("cards.daysTaken")}</span>
          </div>
          <p className="text-sm text-muted tabular-nums">
            {t("cards.split", {
              taken: days(view.totals.takenMinutes),
              planned: days(view.totals.plannedMinutes),
            })}
          </p>
          <ul className="flex flex-wrap gap-x-3 text-xs text-faint tabular-nums">
            {view.totals.byKind.map((share) => (
              <li key={share.kind} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("size-2 rounded-[2px]", KIND_CLASS[share.kind])} />
                {t(`kinds.${share.kind}` as "kinds.vacation")} {days(share.minutes)}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex min-w-0 flex-col gap-2">
          <span className="text-sm font-medium text-muted">{t("bars.title")}</span>
          <MonthBars bars={view.bars} shortNames={shortNames} labelFor={barLabel} />
        </Card>
      </div>

      <Card className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("calendar.title", { year })}</h2>
          <ul className="flex flex-wrap gap-3.5 text-sm text-muted" data-testid="calendar-legend">
            <Legend className={KIND_CLASS.vacation} label={t("kinds.vacation")} />
            <Legend className={KIND_CLASS.rol} label={t("kinds.rol")} />
            {/* Hollow, exactly as a planned day is drawn: filled means a payslip has counted it. */}
            <Legend className="border-2 border-primary" label={t("calendar.planned")} />
            <Legend className={cn(KIND_CLASS.vacation)} label={t("calendar.counted")} />
            <Legend className="border border-border bg-hover" label={t("calendar.holiday")} />
          </ul>
        </div>
        {/* How the calendar is worked (N3): said once, where the clicking happens. */}
        <p className="text-sm text-muted">{t("calendar.howTo")}</p>
        <YearCalendar
          months={view.calendar}
          monthNames={monthNames}
          weekdays={weekdayInitials(view.weekStart, locale)}
          totals={view.bars.map((bar) =>
            bar.takenMinutes + bar.plannedMinutes === 0 ? "" : days(bar.takenMinutes + bar.plannedMinutes),
          )}
          booked={booked}
          today={view.today}
        />
      </Card>

      {/* `min-w-0`: without it a flex child sizes to its content, and the table inside would push
          the card — and the whole page — wider than the phone rather than scrolling in place. */}
      <Card padded={false} className="min-w-0">
        <CardHeader
          title={t("table.title")}
          actions={
            <div className="flex gap-0.5 rounded-[7px] bg-hover p-0.5">
              {FILTERS.map((one) => (
                <Link
                  key={one}
                  href={hrefFor(year, one)}
                  aria-current={filter === one ? "true" : undefined}
                  className={cn(
                    "focus-ring inline-flex h-6 items-center rounded-[5px] px-2.5 text-sm font-medium",
                    filter === one
                      ? "bg-card text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                      : "text-muted hover:text-fg",
                  )}
                >
                  {t(`table.filters.${one}` as "table.filters.all")}
                </Link>
              ))}
            </div>
          }
        />
        {groups.length === 0 ? (
          <p className="px-4 pb-4 text-muted">{t("table.empty")}</p>
        ) : (
          // Six columns do not fit a 400 px phone. Rather than scroll the table sideways, the two
          // that can be said in less room step aside: the note goes, and the status moves under
          // the date as the badge it already is. Nothing is lost, and the page never scrolls.
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Th>{t("table.date")}</Th>
                <Th>{t("table.type")}</Th>
                <Th align="right">{t("table.duration")}</Th>
                <Th className="max-md:hidden">{t("table.note")}</Th>
                <Th className="max-md:hidden">{t("table.status")}</Th>
                <Th align="right">
                  <span className="sr-only">{t("table.actions")}</span>
                </Th>
              </THead>
              <TBody>
                {groups.map((group) => (
                  <Fragment key={group.month.month}>
                    <GroupRow
                      colSpan={6}
                      label={formatDate(group.month.month, "monthYear", locale)}
                      summary={monthSummary(group.month)}
                    />
                    {group.rows.map((row) => (
                      <Tr key={row.id}>
                        <Td className="font-medium">
                          <span className="flex flex-col gap-0.5">
                            {formatDate(row.on, "long", locale)}
                            <span className="flex flex-wrap items-center gap-1 md:hidden">{status(row)}</span>
                          </span>
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className={cn("size-2 rounded-[2px]", KIND_CLASS[row.kind])}
                            />
                            {t(`kinds.${row.kind}` as "kinds.vacation")}
                          </span>
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {days(row.fraction * view.minutesPerDay)}
                        </Td>
                        <Td muted className="max-w-0 truncate max-md:hidden">
                          {row.note ?? ""}
                        </Td>
                        <Td className="max-md:hidden">
                          <span className="flex flex-wrap items-center gap-1.5">{status(row)}</span>
                        </Td>
                        <Td align="right">
                          <RowActions
                            day={{
                              id: row.id,
                              on: row.on,
                              kind: row.kind,
                              fraction: row.fraction,
                              note: row.note,
                              origin: row.origin,
                            }}
                            today={view.today}
                          />
                        </Td>
                      </Tr>
                    ))}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      {view.rows.length === 0 && (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
          actions={<AddLeave today={view.today} label={t("actions.add")} />}
        />
      )}
    </Page>
  );
}

/**
 * The design's year stepper: previous, the year itself, next, and a way back to this one. Links
 * rather than buttons, so the year is in the URL and the whole page stays a server render.
 */
function YearPicker({
  year,
  years,
  currentYear,
  filter,
  labels,
}: {
  year: number;
  years: number[];
  currentYear: number;
  filter: Filter;
  labels: { label: string; previous: string; next: string; today: string };
}) {
  const first = Math.min(...years, year);
  const step = (delta: number) => hrefFor(year + delta, filter);
  return (
    <nav aria-label={labels.label} className="flex h-7 items-center rounded-ctl border border-border bg-card">
      <YearStep href={step(-1)} label={labels.previous} disabled={year <= first - 1} glyph="‹" />
      <span className="min-w-[56px] px-2 text-center font-medium tabular-nums">{year}</span>
      <YearStep href={step(1)} label={labels.next} disabled={year >= currentYear} glyph="›" />
      <span aria-hidden="true" className="h-4 w-px bg-border max-sm:hidden" />
      <Link
        href={hrefFor(currentYear, filter)}
        // Hidden on the narrowest screens, where it would wrap the topbar onto two lines; the
        // arrows still walk the years, and the year itself is always in view.
        className="focus-ring inline-flex h-full items-center px-2.5 text-sm font-medium text-accent hover:underline max-sm:hidden"
      >
        {labels.today}
      </Link>
    </nav>
  );
}

function YearStep({
  href,
  label,
  disabled,
  glyph,
}: {
  href: Route;
  label: string;
  disabled: boolean;
  glyph: string;
}) {
  if (disabled) {
    return (
      <span aria-hidden="true" className="grid w-7 place-items-center text-faint">
        {glyph}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="focus-ring grid w-7 place-items-center text-muted hover:text-fg"
    >
      <span aria-hidden="true">{glyph}</span>
    </Link>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("size-2.5 rounded-[3px]", className)} />
      {label}
    </li>
  );
}

function asFilter(value: string | undefined): Filter {
  return FILTERS.includes(value as Filter) ? (value as Filter) : "all";
}

function hrefFor(year: number, filter: Filter): Route {
  return `/timeoff?year=${year}${filter === "all" ? "" : `&filter=${filter}`}` as Route;
}

/** A `numeric(5,2)` as a person would type it back: "26.00" is "26", "0.50" is "0.5". */
function trim(value: string): string {
  return String(Number(value));
}

function formatNumber(value: number, locale: UiLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** How much of a card's bar one part fills: against the whole allowance, not against the residual. */
function shareOf(part: number, residual: ResidualView): number {
  const whole = (residual.remainingMinutes ?? 0) + residual.takenMinutes + residual.plannedMinutes;
  return whole <= 0 ? 0 : part / whole;
}
