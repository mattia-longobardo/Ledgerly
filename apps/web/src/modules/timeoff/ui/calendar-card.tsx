"use client";

// The year as twelve month grids, with its legend and the one line that says how it is worked.
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { COLOR_FILL, weekdayInitials } from "./kinds";
import { BoardCalendar } from "./leave-board";
import { daysOf, monthNamesOf, type Say, type View } from "./words";

export function CalendarCard({
  view,
  year,
  currentYear,
  say,
}: {
  view: View;
  year: number;
  currentYear: number;
  say: Say;
}) {
  const { text, locale } = say;
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{text("calendar.title", { year })}</h2>
        <ul className="flex flex-wrap gap-3.5 text-sm text-muted" data-testid="calendar-legend">
          {view.types.map((type) => (
            <Legend key={type.id} className={COLOR_FILL[type.color]} label={type.name} />
          ))}
          {/* Hollow, exactly as a planned day is drawn: filled means a payslip has counted it. */}
          <Legend className="border-2 border-primary" label={text("calendar.planned")} />
          <Legend className="bg-primary" label={text("calendar.counted")} />
          <Legend className="border border-border bg-hover" label={text("calendar.holiday")} />
        </ul>
      </div>
      {/* How the calendar is worked: said once, in one line, where the picking happens. */}
      <p className="text-sm text-muted">{text("calendar.howTo")}</p>
      <BoardCalendar
        // A new year is a new calendar: a range in progress does not survive the change.
        key={year}
        monthNames={monthNamesOf(year, locale).long}
        weekdays={weekdayInitials(view.weekStart, locale)}
        // In the order of the leave year, as the grids are.
        totals={view.bars.map((bar) => {
          const minutes = bar.takenMinutes + bar.plannedMinutes;
          return minutes === 0 ? "" : daysOf(say, minutes);
        })}
        // A phone opens this year on this month (decision Q5); every other year opens at the top.
        openOnMonth={year === currentYear ? Number(view.today.slice(5, 7)) : null}
      />
    </Card>
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
