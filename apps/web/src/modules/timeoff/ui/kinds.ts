/**
 * The bits of the calendar's presentation that are plain values, kept out of the client component
 * that draws it.
 *
 * `year-calendar.tsx` carries `"use client"` because a day is something you press; everything
 * exported from such a file is a client reference, and the *page* — which renders on the server —
 * needs these for its legend and its weekday row. A value that both sides use belongs in a
 * module that is neither.
 */
import { NULL_DISPLAY, type UiLocale, monthName } from "@ledgerly/format/format";
import type { LeaveColor, LeaveType } from "@ledgerly/domain/timeoff/client";

/** A type of leave as the wire carries it (R5g): the person's own name and colour. */
export type LeaveTypeView = Omit<LeaveType, "balanceKey" | "calendarKind">;

/**
 * The colour a type wears, in the calendar, the legend and the table's dot: a token of the design
 * system, which holds in both themes. Literal class names, so Tailwind finds them.
 */
export const COLOR_FILL: Record<LeaveColor, string> = {
  primary: "bg-primary",
  warn: "bg-warn",
  accent: "bg-accent",
  neg: "bg-neg",
  faint: "bg-faint",
  pos: "bg-pos",
  muted: "bg-muted",
};

/**
 * The same colours as a border, for a day that is **planned** rather than counted: it is drawn
 * hollow — a thick outline and the number in the type's own colour — instead of filled.
 *
 * Not the `accent` outline the design's legend suggests: `--accent` and `--primary` are the same
 * teal in this theme, so a one-pixel accent border around a filled day is invisible, and planned
 * days were reading exactly like taken ones.
 */
export const COLOR_BORDER: Record<LeaveColor, string> = {
  primary: "border-primary",
  warn: "border-warn",
  accent: "border-accent",
  neg: "border-neg",
  faint: "border-faint",
  pos: "border-pos",
  muted: "border-muted",
};

/**
 * `text-accent` for `primary`: `--primary` is a button's fill and stays the same teal in the dark
 * theme, where it read at under 4,5:1 as text on a card (F9 P2). In the light theme the two tokens
 * are the same colour, so nothing moves there.
 */
export const COLOR_TEXT: Record<LeaveColor, string> = {
  primary: "text-accent",
  warn: "text-warn",
  accent: "text-accent",
  neg: "text-neg",
  faint: "text-faint",
  pos: "text-pos",
  muted: "text-muted",
};

/** The colour of a type by its id; a type nobody has any more reads as `faint`. */
export function colorOf(types: readonly LeaveTypeView[], typeId: string | null): LeaveColor {
  return types.find((type) => type.id === typeId)?.color ?? "faint";
}

/** The name of a type by its id: the person's own word, not a message. */
export function nameOf(types: readonly LeaveTypeView[], typeId: string | null): string {
  return types.find((type) => type.id === typeId)?.name ?? NULL_DISPLAY;
}

/** The types as the rules take them: the wire leaves out the two words only the server reads. */
export function forRules(types: readonly LeaveTypeView[]): LeaveType[] {
  return types.map((type) => ({ ...type, balanceKey: null, calendarKind: null }));
}

/** The seven weekday initials, rotated to the user's own first day of the week. */
export function weekdayInitials(weekStart: number, locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  // 2026-02-01 is a Sunday, so index 0 of this week really is Sunday whatever the locale.
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2026, 1, 1 + ((weekStart + index) % 7)))),
  );
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
