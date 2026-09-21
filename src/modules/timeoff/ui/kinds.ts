/**
 * The bits of the calendar's presentation that are plain values, kept out of the client component
 * that draws it.
 *
 * `year-calendar.tsx` carries `"use client"` because a day is something you press; everything
 * exported from such a file is a client reference, and the *page* — which renders on the server —
 * needs these two for its legend and its weekday row. A value that both sides use belongs in a
 * module that is neither.
 */
import type { LeaveDayKind } from "../rules";

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

export const KIND_TEXT: Record<LeaveDayKind, string> = {
  vacation: "text-primary",
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
