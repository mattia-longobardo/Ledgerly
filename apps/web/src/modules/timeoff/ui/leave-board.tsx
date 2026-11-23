"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import type { MonthKey } from "@ledgerly/format/dates";
import { type UiLocale, formatDate } from "@ledgerly/format/format";
import { notify } from "@ledgerly/ui/toast";
import type { ForecastInput } from "@ledgerly/domain/timeoff/client";
import {
  type LeaveActionResult,
  type LeaveFormInput,
  removeLeaveAction,
  removeLeaveRangeAction,
  saveLeaveRangeAction,
  timeOffChanged,
  undoLeaveAction,
} from "../calls";
import {
  type CalendarMonth,
  type LeaveDayKind,
  type LeaveDayView,
  type LeaveUndo,
  type ResidualInput,
  calendar,
  previewLeaveRange,
  stillBooked,
} from "@ledgerly/domain/timeoff/client";
import { liveDays } from "./booked";
import type { LeaveTypeOption } from "./kinds";
import { type BookedLeave, type LeavePanelEntry, LeavePanel } from "./leave-panel";
import { type DayRange, YearCalendar } from "./year-calendar";

/** What the page reads once on the server and hands to everything that books leave. */
interface LeaveBoardProps {
  year: number;
  today: string;
  minutesPerDay: number;
  weekStart: number;
  countedThrough: MonthKey | null;
  /** Every booked row of the year, in the order the table shows them. */
  days: BookedLeave[];
  /** The days of the year nobody works, the patron saint included. */
  holidays: string[];
  residuals: Partial<Record<LeaveDayKind, ResidualInput>>;
  /** What each forecast on the page was worked out from, by kind (release N5.1). */
  forecasts?: Partial<Record<LeaveDayKind, ForecastInput>>;
  types: LeaveTypeOption[];
  children: ReactNode;
}

interface Board {
  /** The year's grids, as they will be once the server has answered. */
  months: CalendarMonth[];
  /** The days still waiting for that answer. */
  waiting: ReadonlySet<string>;
  /** The range the open panel is about. */
  range: DayRange | null;
  today: string;
  /** Whether a write is on its way: the buttons of the table wait for it. */
  busy: boolean;
  /** A booked day "Select more days from here" made the first day of a range; a new number each time. */
  startAt: { date: string; key: number } | null;
  openRange: (range: DayRange) => void;
  openAdd: () => void;
  openEdit: (date: string, rowId?: string) => void;
  remove: (target: { id: string } | { date: string }) => void;
}

const BoardContext = createContext<Board | null>(null);

export function useLeaveBoard(): Board {
  const board = useContext(BoardContext);
  if (board === null) throw new Error("useLeaveBoard needs a <LeaveBoard> above it");
  return board;
}

/** What the screen shows before the server answers: the rows as they will be, and which days wait. */
interface Shown {
  views: LeaveDayView[];
  waiting: string[];
}

type Change =
  | { type: "save"; fields: LeaveFormInput }
  | { type: "remove"; target: { id: string } | { date: string } }
  | { type: "removeRange"; range: DayRange }
  | { type: "undo"; undo: LeaveUndo };

const KNOWN_ERRORS = ["invalid", "invalid_input", "not_found", "not_bookable", "range_too_long"];

/**
 * The one place the Time off page books, changes and removes leave from (rewrite plan N5).
 *
 * Three entries reach the same panel — a range picked on the calendar, the "Add leave" button and
 * a booked day — and three commands write: "Confirm", "Remove" and the toast's "Undo". Each is one
 * call to the server. The calendar shows the result at once, paler until the answer comes, and
 * goes back by itself when the server refuses.
 */
export function LeaveBoard({
  year,
  today,
  minutesPerDay,
  weekStart,
  countedThrough,
  days,
  holidays,
  residuals,
  forecasts,
  types,
  children,
}: LeaveBoardProps) {
  const t = useTranslations("timeoff");
  const locale = useLocale() as UiLocale;
  const [busy, startTransition] = useTransition();

  const [entry, setEntry] = useState<LeavePanelEntry | null>(null);
  /** A new number for each opening, so the panel starts from its entry and not from the last one. */
  const [opened, setOpened] = useState(0);
  const [range, setRange] = useState<DayRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<{ date: string; key: number } | null>(null);
  /** What had the focus when the panel opened: where it goes back to. */
  const opener = useRef<HTMLElement | null>(null);

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const views = useMemo(() => liveDays(days), [days]);

  /**
   * What a write left on screen until the page is read again: the optimistic state ends with the
   * action, and the server's rows come with the refresh after it. Without it the calendar went back
   * to the rows before the write for that moment, and a tap on a day just booked started a new range.
   */
  const [held, setHeld] = useState<{ days: BookedLeave[]; shown: Shown } | null>(null);
  const base = useMemo<Shown>(
    () => (held !== null && held.days === days ? held.shown : { views, waiting: [] }),
    [held, days, views],
  );
  const applyChange = useCallback(
    (state: Shown, change: Change): Shown => {
      switch (change.type) {
        case "save": {
          const fields = change.fields;
          const preview = previewLeaveRange(
            {
              from: fields.from,
              to: fields.to,
              kind: fields.kind as LeaveDayKind,
              fraction: Number(fields.fraction),
              editedKind: (fields.editedKind ?? null) as LeaveDayKind | null,
              otherKind: (fields.otherKind ?? null) as LeaveDayKind | null,
            },
            { days: state.views, holidays: holidaySet, year },
          );
          return { views: preview.after, waiting: preview.written };
        }
        case "remove": {
          const target = change.target;
          const gone = "id" in target ? days.find((day) => day.id === target.id) : undefined;
          const date = "id" in target ? gone?.on : target.date;
          if (date === undefined) return state;
          return {
            views: state.views.filter(
              (day) => day.on !== date || (gone !== undefined && day.kind !== gone.kind),
            ),
            waiting: [date],
          };
        }
        case "removeRange": {
          const { from, to } = change.range;
          const inRange = (on: string) => on >= from && on <= to;
          return {
            views: state.views.filter((day) => !inRange(day.on)),
            waiting: [...new Set(state.views.filter((day) => inRange(day.on)).map((day) => day.on))],
          };
        }
        case "undo":
          return {
            views: [
              ...state.views.filter((day) => !change.undo.dates.includes(day.on)),
              ...change.undo.rows.map((row) => ({ on: row.on, kind: row.kind, fraction: row.fraction })),
            ],
            waiting: change.undo.dates,
          };
      }
    },
    [days, holidaySet, year],
  );
  const [shown, show] = useOptimistic<Shown, Change>(base, applyChange);
  /** After a write that went through: what it shows stays until the server's rows arrive. */
  const keep = useCallback(
    (change: Change) => setHeld({ days, shown: applyChange(base, change) }),
    [days, applyChange, base],
  );
  /** A booked day tapped before its rows arrived: it opens when they do. */
  const [deferred, setDeferred] = useState<{ date: string; rowId?: string; days: BookedLeave[] } | null>(
    null,
  );

  const months = useMemo(
    () => calendar(year, shown.views, holidaySet, weekStart, countedThrough, minutesPerDay),
    [year, shown.views, holidaySet, weekStart, countedThrough, minutesPerDay],
  );
  const waiting = useMemo(() => new Set(shown.waiting), [shown.waiting]);

  const messageFor = useCallback(
    (result: Extract<LeaveActionResult, { ok: false }>): string => {
      // A refusal names its date, which is the point of carrying it back from the service.
      const first = result.refused?.[0];
      if (result.error === "not_bookable" && first !== undefined) {
        return t(`errors.${first.reason}` as "errors.weekend", {
          date: formatDate(first.on, "long", locale),
        });
      }
      return t(`errors.${KNOWN_ERRORS.includes(result.error) ? result.error : "failed"}` as "errors.failed");
    },
    [t, locale],
  );

  const daysText = useCallback(
    (amount: number) =>
      t("units.days", { amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount) }),
    [t, locale],
  );

  const undo = useCallback(
    (state: LeaveUndo) => {
      startTransition(async () => {
        show({ type: "undo", undo: state });
        const result = await undoLeaveAction(state).catch(() => null);
        if (result === null || !result.ok) {
          notify(t("toasts.undoFailed"), "error");
          return;
        }
        keep({ type: "undo", undo: state });
        notify(t("toasts.undone"));
        timeOffChanged();
      });
    },
    [keep, show, t],
  );

  const undoAction = useCallback(
    (state: LeaveUndo) => ({ label: t("toasts.undo"), onClick: () => undo(state) }),
    [t, undo],
  );

  const open = useCallback((next: LeavePanelEntry, drawn: DayRange | null) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null);
    setRange(drawn);
    setOpened((count) => count + 1);
    setEntry(next);
  }, []);

  const close = useCallback(() => {
    setEntry(null);
    setRange(null);
    setError(null);
  }, []);

  const remove = useCallback(
    (target: { id: string } | { date: string }) => {
      close();
      startTransition(async () => {
        show({ type: "remove", target });
        const result = await removeLeaveAction(target).catch(() => null);
        if (result === null) {
          notify(t("errors.failed"), "error");
          return;
        }
        if (!result.ok) {
          notify(messageFor(result), "error");
          // The day is not there any more for somebody: show what is.
          timeOffChanged();
          return;
        }
        if (result.removed === 0) return;
        keep({ type: "remove", target });
        // A day the calendar holds does not go until the calendar agrees: "removed" alone would be a lie the badge
        // on the row contradicts.
        notify(
          result.pending > 0 ? t("toasts.removalPending") : t("toasts.removed", { count: result.removed }),
          "success",
          undoAction(result.undo),
        );
        timeOffChanged();
      });
    },
    [close, keep, messageFor, show, t, undoAction],
  );

  /** "Remove N days": one call, one transaction, one toast whose "Undo" brings every day back. */
  const removeRange = useCallback(
    (picked: DayRange) => {
      close();
      startTransition(async () => {
        show({ type: "removeRange", range: picked });
        const result = await removeLeaveRangeAction(picked).catch(() => null);
        if (result === null) {
          notify(t("errors.failed"), "error");
          return;
        }
        if (!result.ok) {
          notify(messageFor(result), "error");
          timeOffChanged();
          return;
        }
        if (result.removed === 0) return;
        keep({ type: "removeRange", range: picked });
        notify(
          result.pending > 0
            ? t("toasts.rangeRemovalPending", { count: result.days })
            : t("toasts.rangeRemoved", { count: result.days }),
          "success",
          undoAction(result.undo),
        );
        timeOffChanged();
      });
    },
    [close, keep, messageFor, show, t, undoAction],
  );

  /** The edited day becomes the first day of a range: The calendar takes it from here. */
  const selectMore = useCallback(
    (date: string) => {
      close();
      setStartAt((was) => ({ date, key: (was?.key ?? 0) + 1 }));
    },
    [close],
  );

  function confirm(fields: LeaveFormInput) {
    setError(null);
    startTransition(async () => {
      show({ type: "save", fields });
      const result = await saveLeaveRangeAction(fields).catch(() => null);
      if (result === null) {
        setError(t("errors.failed"));
        return;
      }
      if (!result.ok) {
        setError(messageFor(result));
        if (result.error === "not_found") timeOffChanged();
        return;
      }
      keep({ type: "save", fields });
      close();
      notify(t("toasts.saved", { days: daysText(result.days) }), "success", undoAction(result.undo));
      timeOffChanged();
    });
  }

  /** The rows the calendar shows, removals on their way left out (N5 §7.4); the table may still
   * name a row waiting for the calendar, the calendar never does. */
  const rowsOf = useCallback(
    (date: string, rowId?: string) => {
      const shownRow = (day: BookedLeave) =>
        shown.views.some((one) => one.on === day.on && one.kind === day.kind);
      return days.filter((day) => day.on === date && (stillBooked(day) ? shownRow(day) : day.id === rowId));
    },
    [days, shown.views],
  );
  const unread = useCallback(
    (date: string) =>
      shown.views.some(
        (one) =>
          one.on === date &&
          !days.some(
            (day) =>
              stillBooked(day) && day.on === date && day.kind === one.kind && day.fraction === one.fraction,
          ),
      ),
    [days, shown.views],
  );
  // The rows have arrived: the deferred tap opens its panel (state set while rendering, not in an effect).
  if (deferred !== null && deferred.days !== days) {
    setDeferred(null);
    const rows = rowsOf(deferred.date, deferred.rowId);
    if (rows.length > 0) {
      setError(null);
      setRange(null);
      setOpened((count) => count + 1);
      setEntry({ mode: "edit", date: deferred.date, rows, active: deferred.rowId });
    }
  }

  const board = useMemo<Board>(
    () => ({
      months,
      waiting,
      range,
      today,
      busy,
      startAt,
      openRange: (picked) => open({ mode: "range", ...picked }, picked),
      openAdd: () => {
        // Today when the year shown is this one; otherwise the year's first day.
        const from = Number(today.slice(0, 4)) === year ? today : `${String(year).padStart(4, "0")}-01-01`;
        open({ mode: "add", from }, null);
      },
      openEdit: (date, rowId) => {
        // A day the calendar shows and the server's rows do not have yet: booked or changed a moment
        // ago. Its panel needs the rows, so it opens when they arrive instead of on the old ones.
        if (unread(date)) {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setDeferred({ date, rowId, days });
          return;
        }
        const rows = rowsOf(date, rowId);
        if (rows.length > 0) open({ mode: "edit", date, rows, active: rowId }, null);
      },
      remove,
    }),
    [months, waiting, range, today, busy, startAt, year, days, unread, rowsOf, open, remove],
  );

  return (
    <BoardContext.Provider value={board}>
      {children}
      {entry !== null && (
        <LeavePanel
          key={opened}
          entry={entry}
          data={{ year, minutesPerDay, days: shown.views, holidays: holidaySet, residuals, forecasts, types }}
          saving={busy}
          error={error}
          finalFocus={opener}
          onRangeChange={entry.mode === "edit" ? undefined : setRange}
          onConfirm={confirm}
          onRemove={(row) => remove({ id: row.id })}
          onRemoveRange={entry.mode === "edit" ? undefined : removeRange}
          onSelectMore={entry.mode === "edit" ? selectMore : undefined}
          onClose={close}
        />
      )}
    </BoardContext.Provider>
  );
}

/** The year calendar, wired to the board it stands on. */
export function BoardCalendar({
  monthNames,
  weekdays,
  totals,
  openOnMonth,
}: {
  monthNames: string[];
  weekdays: string[];
  totals: string[];
  openOnMonth: number | null;
}) {
  const board = useLeaveBoard();
  return (
    <YearCalendar
      months={board.months}
      monthNames={monthNames}
      weekdays={weekdays}
      totals={totals}
      today={board.today}
      range={board.range}
      waiting={board.waiting}
      openOnMonth={openOnMonth}
      startAt={board.startAt}
      onRange={board.openRange}
      onEdit={board.openEdit}
      onRemove={(date) => board.remove({ date })}
    />
  );
}
