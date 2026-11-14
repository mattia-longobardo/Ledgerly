"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
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
import type { MonthKey } from "@/platform/dates";
import { type UiLocale, formatDate } from "@/platform/format";
import { notify } from "@/ui/toast";
import {
  type LeaveActionResult,
  type LeaveFormInput,
  removeLeaveAction,
  saveLeaveRangeAction,
  undoLeaveAction,
} from "../actions";
import {
  type CalendarMonth,
  type LeaveDayKind,
  type LeaveDayView,
  type LeaveUndo,
  type ResidualInput,
  calendar,
  previewLeaveRange,
} from "../rules";
import type { LeaveTypeOption } from "./kinds";
import { type BookedLeave, type LeavePanelEntry, LeavePanel } from "./leave-panel";
import { type DayRange, YearCalendar } from "./year-calendar";

/** What the page reads once on the server and hands to everything that books leave. */
export interface LeaveBoardProps {
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
  types,
  children,
}: LeaveBoardProps) {
  const t = useTranslations("timeoff");
  const locale = useLocale() as UiLocale;
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [entry, setEntry] = useState<LeavePanelEntry | null>(null);
  /** A new number for each opening, so the panel starts from its entry and not from the last one. */
  const [opened, setOpened] = useState(0);
  const [range, setRange] = useState<DayRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What had the focus when the panel opened: where it goes back to. */
  const opener = useRef<HTMLElement | null>(null);

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const views = useMemo<LeaveDayView[]>(
    () => days.map((day) => ({ on: day.on, kind: day.kind, fraction: day.fraction })),
    [days],
  );

  const [shown, show] = useOptimistic<Shown, Change>({ views, waiting: [] }, (state, change) => {
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
      case "undo":
        return {
          views: [
            ...state.views.filter((day) => !change.undo.dates.includes(day.on)),
            ...change.undo.rows.map((row) => ({ on: row.on, kind: row.kind, fraction: row.fraction })),
          ],
          waiting: change.undo.dates,
        };
    }
  });

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
        notify(t("toasts.undone"));
        router.refresh();
      });
    },
    [router, show, t],
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
          router.refresh();
          return;
        }
        if (result.removed === 0) return;
        // A day Trek holds does not go until Trek agrees: "removed" alone would be a lie the badge
        // on the row contradicts.
        notify(
          result.pending > 0 ? t("toasts.removalPending") : t("toasts.removed", { count: result.removed }),
          "success",
          undoAction(result.undo),
        );
        router.refresh();
      });
    },
    [close, messageFor, router, show, t, undoAction],
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
        if (result.error === "not_found") router.refresh();
        return;
      }
      close();
      notify(t("toasts.saved", { days: daysText(result.days) }), "success", undoAction(result.undo));
      router.refresh();
    });
  }

  const board = useMemo<Board>(
    () => ({
      months,
      waiting,
      range,
      today,
      busy,
      openRange: (picked) => open({ mode: "range", ...picked }, picked),
      openAdd: () => {
        // Today when the year shown is this one; otherwise the year's first day.
        const from = Number(today.slice(0, 4)) === year ? today : `${String(year).padStart(4, "0")}-01-01`;
        open({ mode: "add", from }, null);
      },
      openEdit: (date, rowId) => {
        const rows = days.filter((day) => day.on === date);
        if (rows.length > 0) open({ mode: "edit", date, rows, active: rowId }, null);
      },
      remove,
    }),
    [months, waiting, range, today, busy, year, days, open, remove],
  );

  return (
    <BoardContext.Provider value={board}>
      {children}
      {entry !== null && (
        <LeavePanel
          key={opened}
          entry={entry}
          data={{ year, minutesPerDay, days: views, holidays: holidaySet, residuals, types }}
          saving={busy}
          error={error}
          finalFocus={opener}
          onRangeChange={entry.mode === "edit" ? undefined : setRange}
          onConfirm={confirm}
          onRemove={(row) => remove({ id: row.id })}
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
      onRange={board.openRange}
      onEdit={board.openEdit}
      onRemove={(date) => board.remove({ date })}
    />
  );
}
