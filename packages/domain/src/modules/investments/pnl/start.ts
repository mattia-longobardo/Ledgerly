// The first steps of a service's P&L (§4.6, audit INV-8): the days measured, the value before them, the flows.
import { addDays, type CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { type AdjustmentClass, type Book, flowEntriesOn, sortedPeriods, valueAt } from "../rules";
import { cutoffDayOf, flatSince, signed } from "./positions";
import {
  type CoverageWindow,
  type PeriodFlow,
  type PnlReason,
  type PnlService,
  type ServicePnl,
} from "./types";

// ——— The steps of a service's P&L (§4, audit INV-8) ——————————————————————————————————————————————

export type Reasons = Set<PnlReason>;

/** Where a period is measured from (§4.6): its first day, the day before it and the value then. */
export interface MeasuredStart {
  from: CivilDate;
  base: CivilDate;
  startCents: Cents;
}

/** A service's P&L with nothing to measure: undetermined, with the reasons why (§4.6). */
export function undetermined(
  service: PnlService,
  from: CivilDate | null,
  to: CivilDate,
  reasons: Reasons,
): ServicePnl {
  return {
    accountId: service.accountId,
    currency: service.currency,
    status: "undetermined",
    reasons: [...reasons],
    from,
    to,
    partial: false,
    startCents: null,
    endCents: null,
    endCashCents: null,
    openPositions: 0,
    local: null,
    display: null,
    localReturn: null,
    displayReturn: null,
    displayStartCents: null,
    displayCapitalCents: null,
    flows: [],
    exits: [],
    transfers: [],
    holdings: [],
  };
}

interface Span {
  from: CivilDate;
  to: CivilDate;
  /** The cut-off of a synced service ({@link cutoffDayOf}). */
  cutoff: CivilDate | null;
}

/**
 * The first day after the gaps of one stream's windows (§4.6); `null` when a gap is still open on
 * the last day.
 */
function afterGaps(
  book: Book,
  windows: readonly CoverageWindow[],
  span: Span,
  reasons: Reasons,
): CivilDate | null {
  const { to, cutoff } = span;
  let from = span.from;
  for (const window of windows) {
    if (window.complete || window.fromOn > to) continue;
    // A stretch of the window read every day at one value, with nothing booked in it, moved no
    // money (§4.6): covered. The cut-off's own day is its opening, a flow already booked.
    const first = [window.fromOn, from, cutoff === null ? from : addDays(cutoff, 1)].sort().at(-1)!;
    const last = addDays(window.toOn, -1) < to ? addDays(window.toOn, -1) : to;
    if (first <= last && flatSince(book, last) <= first) continue;
    if (window.toOn > to) {
      reasons.add("flows_gap");
      return null;
    }
    const resumes = resumedAfter(book, window, from);
    if (resumes > from) {
      from = resumes;
      reasons.add("flows_gap");
    }
  }
  return from;
}

/**
 * Where the flows resume after a gap that ended inside the period: the end of the window, or the
 * start of the stretch before it read every day at one value with nothing booked, which moved no
 * money (§4.6).
 */
function resumedAfter(book: Book, window: CoverageWindow, from: CivilDate): CivilDate {
  if (window.toOn <= from) return from;
  const flat = flatSince(book, addDays(window.toOn, -1));
  return flat > from ? (flat < window.toOn ? flat : window.toOn) : from;
}

/**
 * Step 1, the flows (§4.6): the period starts at the end of the last gap that touches it, and never
 * before a stream starts; what a synced service's provider covers before its cut-off is no gap of
 * the service (PERS-145). `null` when a gap is still open on the last day.
 */
function coveredFrom(service: PnlService, span: Span, reasons: Reasons): CivilDate | null {
  if (service.coverage === null) return span.from;
  const { cutoff } = span;
  const coverage = service.coverage
    .filter((window) => cutoff === null || window.toOn > cutoff)
    .map((window) => (cutoff !== null && window.fromOn < cutoff ? { ...window, fromOn: cutoff } : window));
  const streams = new Set(coverage.map((window) => window.stream));
  if (streams.size === 0) {
    reasons.add("flows_gap");
    return null;
  }
  let from: CivilDate | null = span.from;
  for (const stream of streams) {
    const windows = coverage.filter((window) => window.stream === stream);
    const start = windows.reduce(
      (min, window) => (window.fromOn < min ? window.fromOn : min),
      windows[0].fromOn,
    );
    if (start > from && (cutoff === null || start > cutoff)) {
      from = start;
      reasons.add("flows_gap");
    }
    from = afterGaps(service.book, windows, { ...span, from }, reasons);
    if (from === null) return null;
  }
  return from;
}

/**
 * Step 2, the value before the first day: known; zero before an account whose flows hold its whole
 * history — a manual one, a synced one from its cut-off on, or one with no opening inferred — or
 * unknown: then the period starts after the first day with a value (never a base of 0). `null`
 * when no day of the period has one.
 */
function startOf(service: PnlService, span: Span, reasons: Reasons): MeasuredStart | null {
  const { book, rates } = service;
  const base = addDays(span.from, -1);
  const known = valueAt(book, base, rates).valueCents;
  if (known !== null) return { from: span.from, base, startCents: known };
  const periods = sortedPeriods(book);
  const before = periods.length === 0 || base < periods[0].fromOn;
  const inferredOpening = book.events.some(
    (event) =>
      event.origin === "provider" &&
      event.operations.some((operation) => operation.kind === "opening_position"),
  );
  const whole =
    periods[0]?.origin === "manual" ||
    span.cutoff !== null ||
    (service.coverage !== null && !inferredOpening);
  if (before && whole) return { from: span.from, base, startCents: 0n };
  reasons.add("base_unknown");
  const days = [
    ...new Set([...book.readings.map((reading) => reading.on), ...book.events.map((event) => event.on)]),
  ]
    .filter((day) => day >= span.from && day < span.to)
    .sort();
  for (const day of days) {
    const value = valueAt(book, day, rates).valueCents;
    if (value !== null) return { from: addDays(day, 1), base: day, startCents: value };
  }
  return null;
}

/**
 * Steps 1 and 2: the days a service can be measured over from `asked` to `to` (§4.6), and its value
 * before the first of them; `null` when none can.
 */
export function measuredStart(
  service: PnlService,
  asked: CivilDate,
  to: CivilDate,
  reasons: Reasons = new Set(),
): MeasuredStart | null {
  const cutoff = cutoffDayOf(service.book);
  const from = coveredFrom(service, { from: asked, to, cutoff }, reasons);
  return from === null ? null : startOf(service, { from, to, cutoff }, reasons);
}

export const classOf = (service: PnlService, eventId: string): AdjustmentClass =>
  service.adjustmentClasses?.get(eventId) ?? "data";

/** A flow of the period before its conversion into the display currency. */
export type PeriodEntry = Omit<PeriodFlow, "displayCents">;

/** Step 3, the flows of `[from, to]` (§4.6), and the corrections of class `capital` as flows (§4.9), by day. */
export function periodFlows(service: PnlService, from: CivilDate, to: CivilDate): PeriodEntry[] {
  const { book } = service;
  const entries: PeriodEntry[] = flowEntriesOn(book, to)
    .filter((entry) => entry.on >= from)
    .map((entry) => ({
      on: entry.on,
      cents: signed(entry),
      transferGroupId: entry.transferGroupId,
      converted: entry.converted ?? null,
    }));
  for (const event of book.events) {
    if (classOf(service, event.id) !== "capital") continue;
    for (const operation of event.operations) {
      if (operation.kind !== "adjustment") continue;
      if (event.on >= from && event.on <= to)
        entries.push({ on: event.on, cents: operation.amountCents, transferGroupId: null });
      const ends = operation.validUntil === null ? null : addDays(operation.validUntil, 1);
      if (ends !== null && ends >= from && ends <= to)
        entries.push({ on: ends, cents: -operation.amountCents, transferGroupId: null });
    }
  }
  return entries.sort((left, right) => (left.on < right.on ? -1 : left.on > right.on ? 1 : 0));
}

/** Step 4, the income and the fees booked in `[from, to]` (§4.2). */
export function incomeAndFees(
  book: Book,
  from: CivilDate,
  to: CivilDate,
): { incomeCents: Cents; feesCents: Cents } {
  let incomeCents = 0n;
  let feesCents = 0n;
  for (const event of book.events) {
    if (event.on < from || event.on > to) continue;
    for (const operation of event.operations) {
      if (operation.kind === "income") incomeCents += operation.amountCents;
      else if (operation.kind === "fee") feesCents += operation.amountCents;
    }
  }
  return { incomeCents, feesCents };
}
