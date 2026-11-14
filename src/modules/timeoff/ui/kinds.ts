/**
 * The bits of the calendar's presentation that are plain values, kept out of the client component
 * that draws it.
 *
 * `year-calendar.tsx` carries `"use client"` because a day is something you press; everything
 * exported from such a file is a client reference, and the *page* — which renders on the server —
 * needs these two for its legend and its weekday row. A value that both sides use belongs in a
 * module that is neither.
 */
import { type UiLocale, monthName } from "@/platform/format";
import { LEAVE_TYPES, type LeaveDayKind, type LeaveType } from "../rules";

/**
 * The colour each kind wears, in the calendar and in the table's dot. Vacation and ROL are the
 * two the design's legend names; the other three are local kinds the design never drew, so they
 * borrow the neutral tones rather than inventing a fifth and sixth hue.
 */
export const KIND_CLASS: Record<LeaveDayKind, string> = {
  vacation: "bg-primary",
  rol: "bg-warn",
  comp: "bg-accent",
  sick: "bg-neg",
  other: "bg-faint",
};

/**
 * The same five colours as a border and as text, for a day that is **planned** rather than
 * counted: it is drawn hollow — a thick outline and the number in the kind's own colour — instead
 * of filled.
 *
 * Not the `accent` outline the design's legend suggests: `--accent` and `--primary` are the same
 * teal in this theme, so a one-pixel accent border around a filled vacation day is invisible, and
 * planned days were reading exactly like taken ones.
 */
export const KIND_BORDER: Record<LeaveDayKind, string> = {
  vacation: "border-primary",
  rol: "border-warn",
  comp: "border-accent",
  sick: "border-neg",
  other: "border-faint",
};

/**
 * `text-accent` for vacation, not `text-primary`: `--primary` is a button's fill and stays the
 * same teal in the dark theme, where it read at under 4,5:1 as text on a card (F9 P2). In the
 * light theme the two tokens are the same colour, so nothing moves there.
 */
export const KIND_TEXT: Record<LeaveDayKind, string> = {
  vacation: "text-accent",
  rol: "text-warn",
  comp: "text-accent",
  sick: "text-neg",
  other: "text-faint",
};

/** The seven weekday initials, rotated to the user's own first day of the week. */
export function weekdayInitials(weekStart: number, locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  // 2026-02-01 is a Sunday, so index 0 of this week really is Sunday whatever the locale.
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2026, 1, 1 + ((weekStart + index) % 7)))),
  );
}

/**
 * A kind of leave as the panel shows it: the entry of the rules' list, with a name and a colour
 * (anticipation AN1). The panel is handed this list and writes no kind's name of its own.
 */
export interface LeaveTypeOption extends LeaveType {
  name: string;
  /** The class of the kind's colour, for a dot beside its name. */
  color: string;
}

/** The list the page hands the panel, named in the reader's language. */
export function leaveTypeOptions(nameOf: (id: LeaveDayKind) => string): LeaveTypeOption[] {
  return LEAVE_TYPES.map((type) => ({ ...type, name: nameOf(type.id), color: KIND_CLASS[type.id] }));
}

const utc = (date: string): Date => new Date(`${date}T00:00:00Z`);

/** Day, month in full and year, in the order the rest of the app writes a date: "12 August 2026". */
function wholeDate(date: string, locale: UiLocale): string {
  return `${Number(date.slice(8, 10))} ${monthName(date, locale, "long")} ${date.slice(0, 4)}`;
}

function weekday(date: string, locale: UiLocale, width: "long" | "short"): string {
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(utc(date));
}

/** A date with its weekday, in full: "Wednesday 12 August 2026" — what the panel calls one day. */
export function fullDate(date: string, locale: UiLocale): string {
  const name = weekday(date, locale, "long");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${wholeDate(date, locale)}`;
}

/** A day inside a list the panel prints: "Sat 15". The month is said by the range above it. */
export function shortDay(date: string, locale: UiLocale): string {
  return `${weekday(date, locale, "short")} ${Number(date.slice(8, 10))}`;
}

/** The two ends of a range, said once where they share a month: "10" and "21 August 2026". */
export function rangeEnds(from: string, to: string, locale: UiLocale): { from: string; to: string } {
  return {
    from: from.slice(0, 7) === to.slice(0, 7) ? String(Number(from.slice(8, 10))) : wholeDate(from, locale),
    to: wholeDate(to, locale),
  };
}
