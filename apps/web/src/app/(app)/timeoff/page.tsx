import { TriangleAlert } from "lucide-react";
import type { Metadata, Route } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type KindView, type LeaveRow, timeOffView } from "@ledgerly/domain/timeoff";
import type { AccrualView, Overdrawn } from "@ledgerly/domain/timeoff";
import type { MonthBar, MonthGroup, ResidualView } from "@ledgerly/domain/timeoff";
import { KindCard, MonthBars } from "@/modules/timeoff/ui/kind-card";
import { AddLeave, RowActions } from "@/modules/timeoff/ui/leave-actions";
import { BoardCalendar, LeaveBoard } from "@/modules/timeoff/ui/leave-board";
import type { BookedLeave } from "@/modules/timeoff/ui/leave-panel";
import { YearPicker } from "@/modules/timeoff/ui/year-picker";
import { KIND_CLASS, leaveTypeOptions, weekdayInitials } from "@/modules/timeoff/ui/kinds";
import { requireSession } from "@/platform/auth/session";
import { today as todayIn } from "@ledgerly/domain/shared/dates";
import { formatDate, NULL_DISPLAY, type UiLocale } from "@ledgerly/domain/platform/format";
import { Badge } from "@ledgerly/ui/badge";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Page } from "@ledgerly/ui/shell/page";
import { TabLinks } from "@ledgerly/ui/tab-links";
import { EmptyState } from "@ledgerly/ui/states";
import { GroupRow, Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";

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

  /**
   * What a card says about the accrual (release N5.1): the month's worth and the forecast for the
   * end of the year. A rate that is the allowance over twelve says that it is an estimate; a card
   * with no rate says why there is no forecast, where there is an allowance or a payslip to expect
   * one from.
   */
  const accrualNotes = (accrual: AccrualView, residual: ResidualView): string[] => {
    if (accrual.rate === null) return residual.basis === "unknown" ? [] : [t("accrual.none")];
    const notes = [t("accrual.perMonth", { amount: days(accrual.rate.minutesPerMonth) })];
    if (accrual.yearEndMinutes !== null && !accrual.leads) {
      notes.push(t("accrual.yearEnd", { amount: days(accrual.yearEndMinutes) }));
    }
    if (accrual.rate.source === "allowance") notes.push(t("accrual.fromAllowance"));
    return notes;
  };
  /** A minute total as a card prints it: bare days, or the dash of a residual nobody can compute. */
  const asDays = (minutes: number | null) =>
    minutes === null ? NULL_DISPLAY : formatNumber(minutes / view.minutesPerDay, locale);

  /**
   * What the two headline cards have in common. A year with a payslip or an allowance of its own
   * leads with the residual; a year with neither, read from an earlier payslip, leads with the
   * forecast and says that it is one (decision D6).
   */
  const cardOf = ({ residual, allowanceMinutes, carriedMinutes }: KindView, accrual: AccrualView) => ({
    allowanceNote: allowanceMinutes === null ? "" : t("cards.perYear", { amount: days(allowanceMinutes) }),
    value: asDays(accrual.leads ? accrual.yearEndMinutes : residual.remainingMinutes),
    valueUnit: accrual.leads ? t("accrual.daysForecast") : t("cards.daysRemaining"),
    takenNote: t("cards.taken", { amount: days(residual.takenMinutes) }),
    basisNote: accrual.leads
      ? t("accrual.basis", { payslip: formatDate(accrual.payslipPeriod, "monthYear", locale) })
      : basisNote(residual, carriedMinutes),
    accrualNotes: accrualNotes(accrual, residual),
    takenShare: shareOf(residual.takenMinutes, residual),
    plannedShare: shareOf(residual.plannedMinutes, residual),
  });
  const rolPlanned = view.rol.residual.plannedMinutes;

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
   * The days already booked, for the panel to open in edit and to work its summary out from. Built
   * from the same rows the table shows, so a day of the calendar and its row reach the same panel.
   */
  const booked: BookedLeave[] = view.rows
    .filter((row): row is Extract<LeaveRow, { source: "day" }> => row.source === "day")
    .map((row) => ({
      id: row.id,
      on: row.on,
      kind: row.kind,
      fraction: row.fraction,
      note: row.note,
      origin: row.origin,
      pending: row.pending,
    }));

  return (
    <LeaveBoard
      year={year}
      today={view.today}
      minutesPerDay={view.minutesPerDay}
      weekStart={view.weekStart}
      countedThrough={view.countedThrough}
      days={booked}
      holidays={view.holidays}
      residuals={view.residualInputs}
      forecasts={view.forecastInputs}
      types={leaveTypeOptions((kind) => t(`kinds.${kind}` as "kinds.vacation"))}
    >
      <Page
        title={t("title")}
        actions={
          <div className="flex items-center gap-2">
            <YearPicker
              year={year}
              years={view.years}
              currentYear={currentYear}
              hrefFor={(one) => hrefFor(one, filter)}
              labels={{
                label: t("header.yearLabel"),
                previous: t("header.previousYear"),
                next: t("header.nextYear"),
                today: t("header.thisYear"),
              }}
            />
            {/* In the topbar where there is room for it; on a phone it sits under the title. */}
            <AddLeave label={t("actions.add")} className="max-md:hidden" />
          </div>
        }
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-title font-semibold tracking-title">{t("heading")}</h1>
            <p className="text-muted">{headline || t("header.noAllowance")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {view.allowance === null && (
              <ButtonLink href={`/timeoff/settings?year=${year}` as Route} size="sm" className="max-md:h-9">
                {t("actions.setAllowance")}
              </ButtonLink>
            )}
            <AddLeave label={t("actions.add")} className="md:hidden" />
          </div>
        </div>
        <TabLinks
          label={t("tabs.label")}
          tabs={[
            { href: hrefFor(year, filter), label: t("tabs.overview"), active: true },
            { href: `/timeoff/settings?year=${year}` as Route, label: t("tabs.settings"), active: false },
          ]}
        />

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
            {...cardOf(view.vacation, view.accrual.vacation)}
            plannedNote={t("cards.planned", { amount: days(view.vacation.residual.plannedMinutes) })}
            tone="primary"
            testId="vacation-card"
          />
          <KindCard
            label={t("cards.rol")}
            {...cardOf(view.rol, view.accrual.rol)}
            plannedNote={rolPlanned > 0 ? t("cards.planned", { amount: days(rolPlanned) }) : null}
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
              <span className="text-kpi font-semibold tracking-title tabular-nums">
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
                  <span aria-hidden="true" className={cn("size-2 rounded-xs", KIND_CLASS[share.kind])} />
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
          {/* How the calendar is worked: said once, in one line, where the picking happens. */}
          <p className="text-sm text-muted">{t("calendar.howTo")}</p>
          <BoardCalendar
            // A new year is a new calendar: a range in progress does not survive the change.
            key={year}
            monthNames={monthNames}
            weekdays={weekdayInitials(view.weekStart, locale)}
            totals={view.bars.map((bar) =>
              bar.takenMinutes + bar.plannedMinutes === 0 ? "" : days(bar.takenMinutes + bar.plannedMinutes),
            )}
            // A phone opens this year on this month (decision Q5); every other year opens at the top.
            openOnMonth={year === currentYear ? Number(view.today.slice(5, 7)) : null}
          />
        </Card>

        {/* `min-w-0`: without it a flex child sizes to its content, and the table inside would push
          the card — and the whole page — wider than the phone rather than scrolling in place. */}
        <Card padded={false} className="min-w-0">
          <CardHeader
            title={t("table.title")}
            actions={
              <div className="flex gap-0.5 rounded-seg bg-hover p-0.5">
                {FILTERS.map((one) => (
                  <Link
                    key={one}
                    href={hrefFor(year, one)}
                    aria-current={filter === one ? "true" : undefined}
                    className={cn(
                      "focus-ring inline-flex h-6 items-center rounded-tag px-2.5 text-sm font-medium",
                      filter === one ? "bg-card text-fg shadow-pressed" : "text-muted hover:text-fg",
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
                              <span className="flex flex-wrap items-center gap-1 md:hidden">
                                {status(row)}
                              </span>
                            </span>
                          </Td>
                          <Td>
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className={cn("size-2 rounded-xs", KIND_CLASS[row.kind])}
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
                            <RowActions id={row.id} on={row.on} />
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
            actions={<AddLeave label={t("actions.add")} />}
          />
        )}
      </Page>
    </LeaveBoard>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("size-2.5 rounded-xs-plus", className)} />
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

function formatNumber(value: number, locale: UiLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** How much of a card's bar one part fills: against the whole allowance, not against the residual. */
function shareOf(part: number, residual: ResidualView): number {
  const whole = (residual.remainingMinutes ?? 0) + residual.takenMinutes + residual.plannedMinutes;
  return whole <= 0 ? 0 : part / whole;
}
