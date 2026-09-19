"use client";

import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { addMonths, type CivilDate, type MonthKey, monthKey } from "@/platform/dates";
import { formatDate, type UiLocale } from "@/platform/format";
import { Button, IconButton } from "./button";
import { cn } from "./cn";
import { type Params, withParams } from "./url";

/** What the picker picks: whole days, or whole months (spec §8.3, F2.5). */
export type RangeGrain = "day" | "month";

/** The picker's words, already translated: `src/ui` knows no message catalogue. */
export interface DateRangeLabels {
  /** The control's own name, as its tooltip: the visible text is the range itself. */
  label: string;
  from: string;
  to: string;
  /** One step of the calendars: a month at day grain, a year at month grain. */
  previous: string;
  next: string;
  pickEnd: string;
  apply: string;
  cancel: string;
}

/** The calendar cells of one month, Monday first, with the leading blanks of the design's grid. */
export function calendarCells(month: MonthKey): (CivilDate | null)[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const blanks = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from(
      { length: days },
      (_, index) => `${month.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`,
    ),
  ];
}

/** The twelve months of a year, as month keys. */
export function yearCells(year: number): MonthKey[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}-01`);
}

/**
 * The narrow weekday initials of the calendar header. `@/platform/format` has no weekday
 * formatter, and these are names rather than a number or a money format (spec §8.5), so they are
 * built here.
 */
function weekdayInitials(locale: UiLocale): string[] {
  const formatter = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    weekday: "narrow",
    timeZone: "UTC",
  });
  // 5 January 1970 was a Monday, which is the day the design's grid starts on.
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(1970, 0, 5 + index))));
}

/** A cell of either grid: the value it stands for, what it shows, and what it is called. */
interface Cell {
  value: string;
  text: string;
  name?: string;
}

/**
 * The design's two-panel date range picker (spec §8.3): two months of days, or — at month grain —
 * two years of months, for the charts of Overview and Account detail whose series are monthly.
 *
 * It degrades on purpose. The panel is a `<details>`, so it opens without JavaScript; the two
 * fields and "Apply" are a plain GET form, so a chosen range reaches the server as a navigation
 * whether React is running or not. Only the grids need JavaScript, and they are the part the two
 * fields make redundant. That is also why the panel is not rendered in a portal: the containment of
 * `<main>` (spec §8.2) keeps its phone layout where it was, and a portal would need JavaScript.
 *
 * At day grain the address gets `from`/`to` as `AAAA-MM-GG`; at month grain as `AAAA-MM`, the
 * shape Account detail has always read.
 */
export function DateRangePicker({
  grain = "day",
  align = "start",
  range,
  text,
  path,
  params,
  locale,
  labels,
  describe,
}: {
  grain?: RangeGrain;
  /**
   * Which edge of the button the panel opens from: `start` for a control at the left of its row,
   * `end` for one at the right. Centred on the button, a 540 px panel ran under the sidebar in
   * Expenses and off the window in Overview (2026-09-18).
   */
  align?: "start" | "end";
  /** Day grain: two civil dates. Month grain: two dates inside the first and the last month. */
  range: { from: CivilDate; to: CivilDate };
  /** The range spelled out: this control is the label of the stepper or the card it sits in. */
  text: string;
  path: string;
  /** The parameters to carry over: everything except the period, which this control replaces. */
  params: Params;
  locale: UiLocale;
  labels: DateRangeLabels;
  /** The hint under the grids, for a picked range: its ends are days, or month keys. */
  describe: (from: string, to: string) => string;
}) {
  const router = useRouter();
  const byMonth = grain === "month";
  /** A picked value at this grain: the day itself, or the first of its month. */
  const unit = (date: CivilDate) => (byMonth ? monthKey(date) : date);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: string; to: string | null }>({
    from: unit(range.from),
    to: unit(range.to),
  });
  /** Day grain: the month shown on the right. Month grain: the first month of the year on the right. */
  const initialCursor = () => (byMonth ? `${range.to.slice(0, 4)}-01-01` : monthKey(range.to));
  const [cursor, setCursor] = useState<MonthKey>(initialCursor);

  const from = draft.from;
  const to = draft.to ?? unit(range.to);
  /** While only one end is picked, the highlight stops there rather than reaching the old one. */
  const end = draft.to ?? draft.from;
  const step = byMonth ? 12 : 1;
  const panels: MonthKey[] = [addMonths(cursor, -step), cursor];

  /** What a field shows and submits: a whole date, or `AAAA-MM`. */
  const fieldValue = (value: string) => (byMonth ? value.slice(0, 7) : value);
  /** A field's value back into this grain's unit; an unreadable one keeps the current end. */
  const fromField = (value: string, fallback: string) => {
    if (byMonth) return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : fallback;
    return value === "" ? fallback : value;
  };

  function reset() {
    setDraft({ from: unit(range.from), to: unit(range.to) });
    setCursor(initialCursor());
  }

  function close() {
    reset();
    setOpen(false);
  }

  /** The prototype's own rule: the first click starts a range, the second one closes it. */
  function pick(value: string) {
    if (draft.to === null) {
      const [start, finish] = value < draft.from ? [value, draft.from] : [draft.from, value];
      setDraft({ from: start, to: finish });
      return;
    }
    setDraft({ from: value, to: null });
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const picked = { from: String(data.get("from") ?? ""), to: String(data.get("to") ?? "") };
    if (picked.from === "" || picked.to === "") return;
    const ordered = picked.from <= picked.to ? picked : { from: picked.to, to: picked.from };
    setOpen(false);
    router.push(withParams(path, params, ordered));
  }

  function cells(panel: MonthKey): (Cell | null)[] {
    if (byMonth) {
      return yearCells(Number(panel.slice(0, 4))).map((month) => ({
        value: month,
        text: formatDate(month, "month", locale),
        name: formatDate(month, "monthYear", locale),
      }));
    }
    return calendarCells(panel).map((day) =>
      day === null ? null : { value: day, text: String(Number(day.slice(8))) },
    );
  }

  const hint = draft.to === null ? labels.pickEnd : describe(draft.from, draft.to);

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="relative">
      <summary
        title={labels.label}
        className="focus-ring flex h-[30px] cursor-pointer list-none items-center justify-center gap-2 rounded-ctl px-2 text-sm font-medium whitespace-nowrap hover:bg-hover [&::-webkit-details-marker]:hidden"
      >
        <Calendar aria-hidden className="size-3.5 text-muted" />
        {text}
      </summary>
      <div
        className={cn(
          "absolute top-9 z-30 w-[540px] max-w-[calc(100vw-32px)] animate-in rounded-lg border border-border bg-card p-3.5 shadow-overlay max-md:fixed max-md:inset-x-4 max-md:top-auto max-md:w-auto",
          align === "start" ? "left-0" : "right-0",
        )}
      >
        <form method="get" action={path} onSubmit={apply} className="flex flex-col gap-3">
          {Object.entries(params).map(([name, value]) =>
            value === undefined || value === "" ? null : (
              <input key={name} type="hidden" name={name} value={value} />
            ),
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted">{labels.from}</span>
              <input
                type={byMonth ? "month" : "date"}
                name="from"
                required
                value={fieldValue(from)}
                onChange={(event) =>
                  setDraft({ from: fromField(event.currentTarget.value, draft.from), to: draft.to })
                }
                className="focus:border-accent focus:outline-1 focus:outline-accent h-[30px] rounded-ctl border border-border bg-card px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted">{labels.to}</span>
              <input
                type={byMonth ? "month" : "date"}
                name="to"
                required
                value={fieldValue(to)}
                onChange={(event) =>
                  setDraft({ from: draft.from, to: fromField(event.currentTarget.value, to) })
                }
                className="focus:border-accent focus:outline-1 focus:outline-accent h-[30px] rounded-ctl border border-border bg-card px-2 text-sm"
              />
            </label>
          </div>

          <div className="flex items-center justify-between">
            <IconButton label={labels.previous} size={28} onClick={() => setCursor(addMonths(cursor, -step))}>
              <ChevronLeft aria-hidden className="size-3.5" />
            </IconButton>
            <IconButton label={labels.next} size={28} onClick={() => setCursor(addMonths(cursor, step))}>
              <ChevronRight aria-hidden className="size-3.5" />
            </IconButton>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {panels.map((panel) => (
              <div key={panel} className="flex flex-col gap-1.5">
                <div className="text-center text-sm font-semibold">
                  {byMonth ? panel.slice(0, 4) : formatDate(panel, "monthYear", locale)}
                </div>
                {!byMonth && (
                  <div className="grid grid-cols-7 gap-0.5 text-center text-micro text-faint">
                    {weekdayInitials(locale).map((initial, index) => (
                      <span key={`${panel}-${index}`}>{initial}</span>
                    ))}
                  </div>
                )}
                <div className={cn("grid gap-0.5", byMonth ? "grid-cols-4" : "grid-cols-7")}>
                  {cells(panel).map((cell, index) =>
                    cell === null ? (
                      <span key={`${panel}-blank-${index}`} />
                    ) : (
                      <button
                        key={cell.value}
                        type="button"
                        aria-label={cell.name}
                        onClick={() => pick(cell.value)}
                        aria-pressed={cell.value >= from && cell.value <= end}
                        className={cn(
                          "focus-ring rounded-[4px] text-sm",
                          byMonth ? "h-[30px]" : "h-[26px]",
                          cell.value === draft.from || cell.value === draft.to
                            ? "bg-primary font-semibold text-primary-fg"
                            : cell.value >= from && cell.value <= end
                              ? "bg-sel"
                              : "hover:bg-hover",
                        )}
                      >
                        {cell.text}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>{hint}</span>
            <span className="flex gap-2">
              <Button type="reset" size="sm" onClick={close}>
                {labels.cancel}
              </Button>
              <Button type="submit" size="sm" variant="primary">
                {labels.apply}
              </Button>
            </span>
          </div>
        </form>
      </div>
    </details>
  );
}
