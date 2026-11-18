"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { addDays } from "@ledgerly/domain/shared/dates";
import { formatDate, type UiLocale } from "@ledgerly/domain/platform/format";
import type { CalendarCell, CalendarMonth } from "@ledgerly/domain/timeoff/client";
import { BlankCell, type CellSelection, DayCell } from "./day-cell";
import { SelectionBar } from "./selection-bar";

export interface DayRange {
  from: string;
  to: string;
}

export interface YearCalendarProps {
  months: CalendarMonth[];
  /** The month names, already in the user's language, 1–12. */
  monthNames: string[];
  weekdays: string[];
  /** What each month's total reads, e.g. "3 d" — the design prints it next to the name. */
  totals: string[];
  today: string;
  /** The range the open panel is about: it stays drawn behind the panel. */
  range?: DayRange | null;
  /** The days whose write the server has not answered yet. */
  waiting?: ReadonlySet<string>;
  /** The month a phone opens on — the current one, in the current year — or `null` for the top. */
  openOnMonth?: number | null;
  /**
   * A day to make the first day of a range from outside the grid — "Select more days from here" in
   * the panel of a booked day (N5 §7.5). A new `key` starts it again on the same day.
   */
  startAt?: { date: string; key: number } | null;
  /** Both ends are chosen: the panel opens. Nothing is written here. */
  onRange: (range: DayRange) => void;
  /** A booked day was chosen with no range in progress. */
  onEdit: (date: string) => void;
  /** Delete on a booked day. */
  onRemove: (date: string) => void;
}

type Cell = CalendarCell & { date: string };

const isDay = (cell: CalendarCell): cell is Cell => cell.date !== null;
const canAct = (cell: CalendarCell): boolean => cell.kinds.length > 0 || (!cell.weekend && !cell.holiday);
const ordered = (a: string, b: string): DayRange => (a <= b ? { from: a, to: b } : { from: b, to: a });

/** The day an event happened on, read off the cell — a button or, for a weekend, a span. */
function dateOf(event: SyntheticEvent, selector = "[data-date]"): string | null {
  const element = (event.target as HTMLElement).closest<HTMLElement>(selector);
  return element?.dataset.date ?? null;
}

/**
 * The twelve grids of the design — and the way leave is booked (rewrite plan N5): pick the first
 * day, then the last one, and the panel opens. Nothing is written until the panel's "Confirm".
 *
 * There is no hidden gesture. A click, a touch or Enter on a free day makes it the first day, and
 * the bar that appears offers "This day only" and "Cancel"; the second click, touch or Enter makes
 * the last day. With a mouse the same range can be dragged, which is a shortcut and never the only
 * way. A booked day, chosen with no range in progress, opens the panel on that day.
 *
 * Keyboard: one tab stop per month, then the arrows walk the days something can happen to — across
 * the months, since a range can — Home and End jump to the ends of the month, Escape drops the
 * range, Delete removes what a booked day carries.
 */
export function YearCalendar({
  months,
  monthNames,
  weekdays,
  totals,
  today,
  range = null,
  waiting,
  openOnMonth = null,
  startAt = null,
  onRange,
  onEdit,
  onRemove,
}: YearCalendarProps) {
  const t = useTranslations("timeoff");
  const locale = useLocale() as UiLocale;

  /** The first day of a range that has no last day yet. */
  const [anchor, setAnchor] = useState<string | null>(null);
  /** Where a mouse went down, while its button is still held. */
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  /** The day under the pointer or the focus: the other end of the range being previewed. */
  const [hover, setHover] = useState<string | null>(null);
  /** What a screen reader is told when the keyboard moves the preview. */
  const [announced, setAnnounced] = useState("");
  /** Which day each month offers to the Tab key; the arrows move it. */
  const [cursor, setCursor] = useState<Record<number, string>>({});
  const root = useRef<HTMLDivElement | null>(null);
  const monthRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const cells = useMemo(() => {
    const byDate = new Map<string, Cell>();
    for (const month of months)
      for (const cell of month.weeks.flat()) if (isDay(cell)) byDate.set(cell.date, cell);
    return byDate;
  }, [months]);
  /** Every day of the year an arrow key can land on, in order. */
  const reachable = useMemo(() => [...cells.values()].filter(canAct).map((cell) => cell.date), [cells]);

  // A phone opens the current year on the current month (decision Q5): twelve months in a column
  // are some 3,600 px, and the one a person came for is rarely the first.
  useEffect(() => {
    if (openOnMonth === null) return;
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 767px)").matches) return;
    monthRefs.current[openOnMonth]?.scrollIntoView({ block: "start" });
  }, [openOnMonth]);

  // A drag that ends anywhere but on a day is a drag given up.
  // A new request from outside starts a range, once: the key says which request this is.
  const [startedKey, setStartedKey] = useState<number | null>(null);
  if (startAt !== null && startAt.key !== startedKey) {
    setStartedKey(startAt.key);
    setAnchor(startAt.date);
    setHover(startAt.date);
  }
  const startDate = startAt?.date ?? null;
  useEffect(() => {
    if (startDate === null) return;
    requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>(`button[data-date="${startDate}"]`)?.focus();
    });
  }, [startDate, startAt?.key]);

  useEffect(() => {
    if (dragFrom === null) return;
    const drop = () => {
      setDragFrom(null);
      setHover(null);
    };
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [dragFrom]);

  const start = anchor ?? dragFrom;
  const shown: DayRange | null = range ?? (start === null ? null : ordered(start, hover ?? start));

  const dateText = (date: string) => formatDate(date, "long", locale);
  /** How many days of a range can be booked, as the screen says an amount of days. */
  const daysText = (one: DayRange): string => {
    let count = 0;
    for (const cell of cells.values()) {
      if (cell.date >= one.from && cell.date <= one.to && !cell.weekend && !cell.holiday) count += 1;
    }
    return t("units.days", { amount: count });
  };

  function labelFor(cell: Cell): string {
    const date = dateText(cell.date);
    let label: string;
    if (start !== null && shown !== null && cell.date === start) label = t("selection.firstLabel", { date });
    else if (start !== null && shown !== null && (cell.date === shown.from || cell.date === shown.to)) {
      label = t("selection.lastLabel", { date });
    } else if (cell.kinds.length > 0) {
      label = t("calendar.dayLabel", {
        date,
        kinds: cell.kinds.map((kind) => t(`kinds.${kind}` as "kinds.vacation")).join(", "),
      });
    } else label = t("calendar.bookLabel", { date });
    return cell.date === today ? `${label}, ${t("calendar.today")}` : label;
  }

  function selectionOf(date: string): CellSelection {
    if (shown === null || date < shown.from || date > shown.to) return null;
    return date === shown.from || date === shown.to ? "edge" : "inside";
  }

  function reset() {
    setAnchor(null);
    setDragFrom(null);
    setHover(null);
    setAnnounced("");
  }

  /** Both ends are known: hand the range over, and forget it here — the panel owns it now. */
  function finish(first: string, last: string) {
    reset();
    onRange(ordered(first, last));
  }

  function focusDay(date: string) {
    setCursor((was) => ({ ...was, [Number(date.slice(5, 7))]: date }));
    // The cell has to be tabbable before it takes the focus, and it is after this render.
    requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>(`button[data-date="${date}"]`)?.focus();
    });
  }

  /** A click, a touch, or Enter and Space on a day: all three arrive here as a click. */
  function onClick(event: SyntheticEvent) {
    const date = dateOf(event, "button[data-date]");
    if (date === null) return;
    const cell = cells.get(date);
    if (cell === undefined) return;
    if (anchor !== null) {
      finish(anchor, date);
      return;
    }
    if (cell.kinds.length > 0) {
      onEdit(date);
      return;
    }
    setAnchor(date);
    setHover(date);
  }

  /** Dragging is the mouse's alone: a finger that moves is scrolling the page. */
  function onPointerDown(event: PointerEvent) {
    if (event.pointerType !== "mouse" || event.button !== 0 || anchor !== null) return;
    const date = dateOf(event, "button[data-date]");
    if (date === null || (cells.get(date)?.kinds.length ?? 0) > 0) return;
    setDragFrom(date);
    setHover(date);
  }

  function onPointerOver(event: PointerEvent) {
    if (start === null) return;
    const date = dateOf(event);
    if (date !== null) setHover(date);
  }

  function onPointerUp(event: PointerEvent) {
    if (dragFrom === null) return;
    const date = dateOf(event);
    // Let go on the day it went down on: that is a click, and the click handler takes it.
    if (date === null || date === dragFrom) return;
    // A weekend or a holiday is a position and not an end: the range closes on the nearest day,
    // inside it, that can be booked.
    const step = date > dragFrom ? -1 : 1;
    const usable = (one: string) => {
      const cell = cells.get(one);
      return cell !== undefined && canAct(cell);
    };
    let end = date;
    while (end !== dragFrom && !usable(end)) end = addDays(end, step);
    finish(dragFrom, end);
  }

  function onFocus(event: SyntheticEvent) {
    if (anchor === null) return;
    const date = dateOf(event, "button[data-date]");
    if (date === null) return;
    setHover(date);
    const preview = ordered(anchor, date);
    setAnnounced(
      t("selection.announce", {
        from: dateText(preview.from),
        to: dateText(preview.to),
        days: daysText(preview),
      }),
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    const date = dateOf(event, "button[data-date]");
    if (date === null) return;
    const month = months[Number(date.slice(5, 7)) - 1];
    const inMonth = month.weeks
      .flat()
      .filter((cell) => isDay(cell) && canAct(cell))
      .map((cell) => cell.date as string);

    /** A week up or down the same column, past the days nothing can happen to, within the year. */
    const column = (step: number): string | null => {
      for (let next = addDays(date, step); cells.has(next); next = addDays(next, step)) {
        if (canAct(cells.get(next) as Cell)) return next;
      }
      return null;
    };
    const beside = (step: number): string | null => reachable[reachable.indexOf(date) + step] ?? null;

    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(beside(-1)),
      ArrowRight: () => move(beside(1)),
      ArrowUp: () => move(column(-7)),
      ArrowDown: () => move(column(7)),
      Home: () => move(inMonth[0] ?? null),
      End: () => move(inMonth[inMonth.length - 1] ?? null),
      Escape: () => {
        if (anchor !== null) reset();
      },
      Delete: () => remove(date),
      Backspace: () => remove(date),
    };
    const handler = keys[event.key];
    if (!handler) return;
    // Escape with nothing to cancel is somebody else's key — a dialog's, a menu's.
    if (event.key === "Escape" && anchor === null) return;
    event.preventDefault();
    handler();
  }

  function move(next: string | null) {
    if (next !== null) focusDay(next);
  }

  /** Delete removes what a booked day carries; on a free day, and during a range, it does nothing. */
  function remove(date: string) {
    if (anchor !== null || (cells.get(date)?.kinds.length ?? 0) === 0) return;
    onRemove(date);
  }

  return (
    <div
      ref={root}
      className="flex flex-col gap-4"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerOver={onPointerOver}
      onPointerUp={onPointerUp}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="year-grid"
        // Twelve months in whole rows, and a cell of forty pixels when the screen is narrow: the
        // number of columns follows the page's own width, not the window's.
        className="grid grid-cols-1 gap-4 gap-x-5 select-none @2xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4 @[100rem]:grid-cols-6"
      >
        {months.map((month) => {
          const days = month.weeks.flat().filter((cell) => isDay(cell) && canAct(cell));
          const stored = cursor[month.month];
          const tabStop =
            stored !== undefined && days.some((cell) => cell.date === stored)
              ? stored
              : (days[0]?.date ?? null);
          return (
            <div
              key={month.month}
              ref={(node) => {
                monthRefs.current[month.month] = node;
              }}
              data-month={month.month}
              className="flex min-w-0 scroll-mt-16 flex-col gap-1.5"
            >
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{monthNames[month.month - 1]}</span>
                <span className="text-muted tabular-nums">{totals[month.month - 1]}</span>
              </div>
              <div
                className="grid grid-cols-7 gap-0.5 text-center text-xs text-faint max-md:leading-5"
                aria-hidden="true"
              >
                {weekdays.map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {month.weeks
                  .flat()
                  .map((cell, index) =>
                    isDay(cell) ? (
                      <DayCell
                        key={cell.date}
                        cell={cell}
                        label={labelFor(cell)}
                        tabbable={cell.date === tabStop}
                        today={cell.date === today}
                        selection={selectionOf(cell.date)}
                        waiting={waiting?.has(cell.date) ?? false}
                      />
                    ) : (
                      <BlankCell key={`blank-${index}`} />
                    ),
                  )}
              </div>
            </div>
          );
        })}
      </div>

      <p aria-live="polite" className="sr-only">
        {announced}
      </p>

      {anchor !== null && (
        <SelectionBar
          text={t("selection.from", { date: formatDate(anchor, "dayMonth", locale) })}
          singleLabel={t("selection.single")}
          cancelLabel={t("selection.cancel")}
          onSingle={() => finish(anchor, anchor)}
          onCancel={() => {
            const first = anchor;
            reset();
            focusDay(first);
          }}
        />
      )}
    </div>
  );
}
