"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { formatDate, type UiLocale } from "@/platform/format";
import { cn } from "@/ui/cn";
import type { CalendarMonth, LeaveDayKind } from "../rules";
import { KIND_BORDER, KIND_CLASS, KIND_TEXT } from "./kinds";
import { notify } from "@/ui/toast";
import { clearDayAction, cycleDayAction, halveDayAction, splitDayAction } from "../day-actions";
import { LeaveDialog, type LeaveSummary } from "./leave-actions";

/** How long a press has to last before it means something other than a plain click. */
const HOLD_MS = 450;

export interface YearCalendarProps {
  months: CalendarMonth[];
  /** The month names, already in the user's language, 1–12. */
  monthNames: string[];
  weekdays: string[];
  /** What each month's total reads, e.g. "3 d" — the design prints it next to the name. */
  totals: string[];
  /** The days already booked, by date, in the order the table shows them. */
  booked: Record<string, LeaveSummary[]>;
  today: string;
}

/**
 * The twelve grids of the design — and the way leave is booked (M1): there is no «Add leave»
 * button any more, you click the day you mean.
 *
 * A day you can act on is a real `<button>`: a working day with nothing on it opens the dialog
 * already set to that date, a day that carries something opens it for editing. Weekends and public
 * holidays are not buttons at all, because they cannot be booked — the interactive elements of
 * this calendar are exactly the days something can happen to, which is what makes it navigable
 * without reading the colours.
 *
 * Keyboard: one tab stop per month, then the arrows walk the days (and only the ones that do
 * something), Home and End jump to the first and last of the month. Twelve tab stops instead of
 * three hundred and sixty-five.
 */
export function YearCalendar({ months, monthNames, weekdays, totals, booked, today }: YearCalendarProps) {
  // Built here rather than handed down: a function cannot cross from a server component into a
  // client one, and this component already knows the language it is drawing in.
  const t = useTranslations("timeoff");
  const locale = useLocale() as UiLocale;
  const labelFor = (date: string, kinds: LeaveDayKind[]): string =>
    t("calendar.dayLabel", {
      date: formatDate(date, "long", locale),
      kinds: kinds.map((kind) => t(`kinds.${kind}` as "kinds.vacation")).join(", "),
    });
  const emptyLabelFor = (date: string): string =>
    t("calendar.bookLabel", { date: formatDate(date, "long", locale) });

  const router = useRouter();
  const [, start] = useTransition();
  const [picked, setPicked] = useState<{ date: string; day: LeaveSummary | null } | null>(null);
  /** Which day each month offers to the Tab key; the arrows move it. */
  const [cursor, setCursor] = useState<Record<number, string>>({});
  const gridRefs = useRef<Record<number, HTMLDivElement | null>>({});
  /** The press being held: which button, and whether the hold has already done its work. */
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; button: 0 | 2; fired: boolean } | null>(null);
  /**
   * When the right button was last dealt with. Browsers disagree about when `contextmenu` arrives
   * — on the way down under X11 and macOS, on the way up under Windows — so the handler that runs
   * second has to know the day has already been seen to, or a right-click would act twice.
   */
  const rightHandled = useRef(0);

  /**
   * A click walks the day round: nothing → vacation → ROL → vacation (N3). The server decides
   * from what is stored, so two quick clicks settle into an order instead of disagreeing.
   *
   * A day the cycle cannot speak for — sickness, a recovery day, two halves — opens the dialog
   * instead of being overwritten: a shortcut must never throw away something stated on purpose.
   */
  function click(date: string) {
    start(async () => {
      const result = await cycleDayAction(date);
      if (result.ok) {
        router.refresh();
        return;
      }
      if (result.error === "not_cyclable") {
        openDialog(date);
        return;
      }
      notify(messageFor(result.error, result.refused?.[0]), "error");
    });
  }

  /**
   * The right button, and Delete from the keyboard: whatever is on that day goes.
   *
   * No "is there anything here?" check first. There used to be one, reading `booked` — which is a
   * prop, and therefore whatever the last server render said. Right-clicking a day booked a moment
   * earlier found the old answer, did nothing at all, and said nothing about it; the day only went
   * once some other action refreshed the page. The server already handles an empty day (it removes
   * nothing and says so), and one wasted round trip is a far better trade than a control that
   * silently ignores you.
   */
  function clear(date: string) {
    start(async () => {
      const result = await clearDayAction(date);
      if (!result.ok) {
        notify(messageFor(result.error), "error");
        return;
      }
      router.refresh();
      if (result.removed === 0) return;
      // A day Trek holds does not go until Trek agrees: saying "removed" would be a lie the badge
      // on the row immediately contradicts.
      notify((result.pending ?? 0) > 0 ? t("toasts.removalPending") : t("toasts.removed"));
    });
  }

  function messageFor(code: string, refused?: { on: string; reason: "weekend" | "holiday" }): string {
    if (refused) return t(`errors.${refused.reason}` as "errors.weekend", { date: refused.on });
    const known = ["invalid", "invalid_input", "not_found", "not_bookable", "not_cyclable"];
    return t(`errors.${known.includes(code) ? code : "failed"}` as "errors.failed");
  }

  /**
   * Holding a day down makes it half a day, and holding again makes it whole (N3). Holding the
   * **right** button makes it half vacation and half ROL, and again a whole day of vacation
   * (N10) — the one shape a click cannot reach, since a click deals in one kind at a time. Half
   * days are common enough to deserve a gesture; everything rarer stays in the dialog.
   *
   * The press is tracked here rather than with a CSS `:active` trick because the click that
   * follows has to be swallowed — otherwise letting go would also walk the day on to the next kind.
   */
  function pressStart(date: string, button: 0 | 2) {
    cancelPress();
    held.current = {
      button,
      fired: false,
      timer: setTimeout(() => {
        if (held.current) held.current.fired = true;
        if (button === 2) rightHandled.current = Date.now();
        start(async () => {
          // The left button holds for half a day, the right one for the two halves of a split day.
          const result = await (button === 0 ? halveDayAction(date) : splitDayAction(date));
          if (result.ok) {
            router.refresh();
            return;
          }
          // A day the gesture cannot speak for opens the dialog, as a click on one does.
          if (result.error === "not_cyclable") openDialog(date);
          else notify(messageFor(result.error, result.refused?.[0]), "error");
        });
      }, HOLD_MS),
    };
  }

  /**
   * Letting go, or moving off the day. The timer stops either way, but a press that has **already**
   * become a half day keeps its mark: the click that follows is the tail of the hold and has to be
   * swallowed. Dropping the mark here is what made letting go walk the day on to the next kind.
   */
  function endPress() {
    if (held.current === null) return;
    clearTimeout(held.current.timer);
    if (!held.current.fired) held.current = null;
  }

  /** Starting a new press, or leaving the calendar: forget the old one entirely. */
  function cancelPress() {
    if (held.current === null) return;
    clearTimeout(held.current.timer);
    held.current = null;
  }

  /** Whether the click that is arriving is the tail of a hold, and so should be ignored. */
  function consumeHold(): boolean {
    const fired = held.current?.fired ?? false;
    cancelPress();
    return fired;
  }

  function openDialog(date: string) {
    // More than one kind on a day opens the first of them; the table is where a precise edit
    // belongs, and a chooser here would be a menu in front of a calendar in front of a dialog.
    const rows = booked[date] ?? [];
    setPicked({ date, day: rows[0] ?? null });
  }

  function move(month: CalendarMonth, from: string, delta: number, to?: "first" | "last") {
    const days = actionable(month);
    if (days.length === 0) return;
    const next =
      to === "first"
        ? days[0]
        : to === "last"
          ? days[days.length - 1]
          : days[clamp(days.indexOf(from) + delta, days.length)];
    setCursor((was) => ({ ...was, [month.month]: next }));
    // The cell has to exist before it can take focus, and it does: only the cursor changed.
    requestAnimationFrame(() => {
      gridRefs.current[month.month]?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
    });
  }

  return (
    <>
      <div className="grid gap-4 gap-x-5 [grid-template-columns:repeat(auto-fill,minmax(196px,1fr))]">
        {months.map((month) => {
          const days = actionable(month);
          const focused = cursor[month.month] ?? days[0] ?? null;
          return (
            <div key={month.month} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{monthNames[month.month - 1]}</span>
                <span className="text-muted tabular-nums">{totals[month.month - 1]}</span>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-faint" aria-hidden="true">
                {weekdays.map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div
                className="grid grid-cols-7 gap-0.5"
                ref={(node) => {
                  gridRefs.current[month.month] = node;
                }}
                onKeyDown={(event) => {
                  const date = (event.target as HTMLElement).dataset.date;
                  if (date === undefined) return;
                  const keys: Record<string, () => void> = {
                    ArrowLeft: () => move(month, date, -1),
                    ArrowRight: () => move(month, date, 1),
                    ArrowUp: () => move(month, date, -7),
                    ArrowDown: () => move(month, date, 7),
                    Home: () => move(month, date, 0, "first"),
                    End: () => move(month, date, 0, "last"),
                    // The right button has no keyboard of its own; Delete is the one it borrows.
                    Delete: () => clear(date),
                    Backspace: () => clear(date),
                  };
                  const handler = keys[event.key];
                  if (!handler) return;
                  event.preventDefault();
                  handler();
                }}
              >
                {month.weeks.flat().map((cell, index) => {
                  if (cell.date === null) return <span key={`blank-${index}`} className="h-6" />;
                  const marked = cell.kinds.length > 0;
                  const planned = cell.status === "planned";
                  const canAct = marked || (!cell.weekend && !cell.holiday);
                  const number = Number(cell.date.slice(8, 10));

                  if (!canAct) {
                    return (
                      <span
                        key={cell.date}
                        data-date={cell.date}
                        className={cn(
                          "grid h-6 min-w-0 place-items-center rounded-[4px] border border-transparent text-xs tabular-nums",
                          cell.holiday ? "border-border bg-hover text-muted" : "text-faint",
                        )}
                      >
                        {number}
                      </span>
                    );
                  }

                  return (
                    <button
                      key={cell.date}
                      type="button"
                      data-testid={marked ? "leave-cell" : "free-cell"}
                      data-date={cell.date}
                      data-partial={cell.partial ? "true" : undefined}
                      // Drawn hollow or filled (N8); stated as well as drawn, so a test can see it.
                      data-status={marked ? cell.status : undefined}
                      tabIndex={cell.date === focused ? 0 : -1}
                      title={marked ? labelFor(cell.date, cell.kinds) : emptyLabelFor(cell.date)}
                      aria-label={marked ? labelFor(cell.date, cell.kinds) : emptyLabelFor(cell.date)}
                      onPointerDown={(event) => {
                        // The left button only holds a day that has something to halve; the right
                        // one can split an empty day as readily as a booked one.
                        if (event.button === 0 && marked) pressStart(cell.date as string, 0);
                        else if (event.button === 2) pressStart(cell.date as string, 2);
                      }}
                      onPointerUp={(event) => {
                        if (event.button !== 2) {
                          endPress();
                          return;
                        }
                        // The right button clears — unless the press lasted long enough to have
                        // meant the other thing, which the way up is the first place to know.
                        const split = held.current?.fired ?? false;
                        cancelPress();
                        rightHandled.current = Date.now();
                        if (!split) clear(cell.date as string);
                      }}
                      onPointerLeave={endPress}
                      onClick={(event) => {
                        // The click that ends a hold is the hold's, not a click of its own.
                        if (consumeHold()) return;
                        // Alt or Shift opens the dialog: the way to a note or a kind the cycle
                        // does not carry, without leaving the calendar.
                        if (event.altKey || event.shiftKey) openDialog(cell.date as string);
                        else click(cell.date as string);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        // A pointer is on the day: the length of the press decides what happens,
                        // and only the way up knows it. What gets here with no press in flight is
                        // the keyboard's menu key, which can only mean "clear", now.
                        if (held.current !== null || Date.now() - rightHandled.current < 500) return;
                        clear(cell.date as string);
                      }}
                      className={cn(
                        "focus-ring relative grid h-6 min-w-0 place-items-center overflow-hidden rounded-[4px] text-xs tabular-nums",
                        marked
                          ? cn(
                              "font-medium",
                              // Counted is filled, planned is hollow — a real difference, not a
                              // one-pixel accent border, which in this theme is the same teal as
                              // a vacation day and so could not be seen at all.
                              planned
                                ? cn("border-2", KIND_BORDER[cell.kinds[0]])
                                : "border border-transparent",
                            )
                          : "border border-transparent text-fg hover:bg-hover",
                      )}
                    >
                      {marked && !planned && (
                        <>
                          <span
                            aria-hidden="true"
                            className={cn("absolute inset-0", KIND_CLASS[cell.kinds[0]])}
                          />
                          {/* A second kind on the same day takes the opposite corner. */}
                          {cell.kinds.length > 1 && (
                            <span
                              aria-hidden="true"
                              className={cn("absolute inset-0", KIND_CLASS[cell.kinds[1]])}
                              style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
                            />
                          )}
                          {/*
                            Less than a whole day: a wedge cut out of the top-right corner. A
                            corner and not a diagonal half, because a diagonal runs straight under
                            the number and leaves half the digit on the colour and half off it —
                            which is exactly the contrast axe refuses, and is right to.
                          */}
                          {cell.partial && (
                            <span
                              aria-hidden="true"
                              className="absolute inset-0 bg-card"
                              style={{ clipPath: "polygon(55% 0, 100% 0, 100% 45%)" }}
                            />
                          )}
                        </>
                      )}
                      {marked && planned && (
                        <>
                          {/* A planned half day: the outline is there either way, so the corner
                              that says "half" is drawn in the kind's colour instead of cut out. */}
                          {cell.partial && (
                            <span
                              aria-hidden="true"
                              className={cn("absolute inset-0", KIND_CLASS[cell.kinds[0]])}
                              style={{ clipPath: "polygon(0 55%, 0 100%, 45% 100%)" }}
                            />
                          )}
                          {/*
                            A second kind on a planned day (N10). A hollow cell has no fill for the
                            opposite corner to cut into, so the other kind gets a corner of its own
                            — otherwise half vacation and half ROL is drawn exactly like a day of
                            vacation, which is what it looked like the first time it was tried.
                          */}
                          {cell.kinds.length > 1 && (
                            <span
                              aria-hidden="true"
                              className={cn("absolute inset-0", KIND_CLASS[cell.kinds[1]])}
                              style={{ clipPath: "polygon(55% 0, 100% 0, 100% 45%)" }}
                            />
                          )}
                        </>
                      )}
                      <span
                        className={cn(
                          "relative",
                          marked && (planned ? KIND_TEXT[cell.kinds[0]] : "text-primary-fg"),
                        )}
                      >
                        {number}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {picked !== null && (
        <LeaveDialog
          open
          onOpenChange={(next) => !next && setPicked(null)}
          day={picked.day}
          today={today}
          date={picked.date}
        />
      )}
    </>
  );
}

/** The days of a month a click or an arrow key can land on, in order. */
function actionable(month: CalendarMonth): string[] {
  return month.weeks
    .flat()
    .filter((cell) => cell.date !== null && (cell.kinds.length > 0 || (!cell.weekend && !cell.holiday)))
    .map((cell) => cell.date as string);
}

/** Keeps an index inside the month rather than wrapping into the next one. */
function clamp(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length - 1);
}
