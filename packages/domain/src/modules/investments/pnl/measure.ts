// The P&L of a service (§4, audit INV-8): the steps composed, the display currency, the bars of the chart.
import { type CivilDate } from "../../../shared/dates";
import { convertCents } from "../../../platform/fx/rules";
import type { Cents } from "../../../shared/money";
import { valueAt } from "../rules";
import { periodReturn } from "../../../shared/returns";
import { attribute, costBases, holdingRows, type Known, localParts } from "./parts";
import { correctionsOn, DATA_RESULT, firstDayOf } from "./positions";
import {
  classOf,
  incomeAndFees,
  type MeasuredStart,
  measuredStart,
  type PeriodEntry,
  periodFlows,
  type Reasons,
  undetermined,
} from "./start";
import {
  type Display,
  type PeriodFlow,
  type PnlParts,
  type PnlService,
  type PnlStatus,
  type ServicePnl,
} from "./types";

/** The two ends of a period of a service, in its currency. */
interface Ends extends MeasuredStart {
  to: CivilDate;
  endCents: Cents;
}

/**
 * The P&L in the display currency (§4.5): V and every flow at the rate of its own day. `null` when
 * a rate is missing.
 */
function displayTotal(
  service: PnlService,
  display: Display,
  ends: Ends,
  flows: readonly PeriodFlow[],
): { startCents: Cents; endCents: Cents; pnlCents: Cents } | null {
  const toDisplay = (cents: Cents, on: CivilDate) =>
    convertCents(cents, service.currency, display.currency, on, display.rates);
  const endCents = toDisplay(ends.endCents, ends.to);
  const startCents = toDisplay(ends.startCents, ends.base);
  if (endCents === null || startCents === null || flows.some((flow) => flow.displayCents === null))
    return null;
  const flowCents = flows.reduce((sum, flow) => sum + flow.displayCents!, 0n);
  return { startCents, endCents, pnlCents: endCents - startCents - flowCents };
}

/**
 * Step 8, the display currency (§4.5): the P&L at the rates of its days, the parts at the rate of
 * the last day, the exchange effect the difference, rounding included; and the period's return.
 */
function inDisplay(
  service: PnlService,
  display: Display,
  measure: { ends: Ends; entries: readonly PeriodEntry[]; local: PnlParts },
  reasons: Reasons,
) {
  const { ends, local } = measure;
  const toDisplay = (cents: Cents, on: CivilDate) =>
    convertCents(cents, service.currency, display.currency, on, display.rates);
  const flows: PeriodFlow[] = measure.entries.map((entry) => ({
    ...entry,
    displayCents: toDisplay(entry.cents, entry.on),
  }));
  const total = displayTotal(service, display, ends, flows);
  const startCents = toDisplay(ends.startCents, ends.base);
  if (total === null) {
    reasons.add("no_rate");
    return { flows, startCents, parts: null, periodReturn: null, capitalCents: null };
  }
  const atEnd = (cents: Cents) => toDisplay(cents, ends.to)!;
  const parts = {
    realizedCents: atEnd(local.realizedCents),
    unrealizedChangeCents: local.unrealizedChangeCents === null ? null : atEnd(local.unrealizedChangeCents),
    incomeCents: atEnd(local.incomeCents),
    feesCents: atEnd(local.feesCents),
    correctionsCents: atEnd(local.correctionsCents),
    unattributedCents: atEnd(local.unattributedCents),
  };
  const converted =
    parts.realizedCents +
    (parts.unrealizedChangeCents ?? 0n) +
    parts.incomeCents +
    parts.feesCents +
    parts.correctionsCents +
    parts.unattributedCents;
  const measured = periodReturn({
    from: ends.from,
    to: ends.to,
    startCents: total.startCents,
    endCents: total.endCents,
    pnlCents: total.pnlCents,
    flows: flows.map((flow) => ({ on: flow.on, cents: flow.displayCents! })),
  });
  return {
    flows,
    startCents,
    parts: { pnlCents: total.pnlCents, ...parts, fxCents: total.pnlCents - converted },
    periodReturn: measured,
    capitalCents: measured.averageCapitalCents,
  };
}

/** Steps 3 and 4 summed: the P&L of the ends and the flows, the income, the fees and the corrections. */
function knownOf(service: PnlService, ends: Ends, entries: readonly PeriodEntry[]): Known {
  const { book } = service;
  const classes = (eventId: string) => classOf(service, eventId);
  return {
    pnlCents: ends.endCents - ends.startCents - entries.reduce((sum, entry) => sum + entry.cents, 0n),
    endCents: ends.endCents,
    ...incomeAndFees(book, ends.from, ends.to),
    correctionsCents:
      correctionsOn(book, ends.to, classes, DATA_RESULT) -
      correctionsOn(book, ends.base, classes, DATA_RESULT),
  };
}

/** Step 9, the status (§4.6): `stale` when a price or a rate of either end is an old one. */
function statusOf(reasons: Reasons): PnlStatus {
  return reasons.has("stale_price") ? "stale" : "verified";
}

/**
 * The P&L of one service over `[since, until]` (§4): V(e) − V(s⁻) − flows, split into realized,
 * change of the unrealized, income, fees, corrections and what is left unattributed — in the
 * account's currency and in the display one with the exchange effect — measured from the first day
 * it can be trusted, with its status (§4.6) and its return (§4.3). `since = null` is "All".
 */
export function pnlOf(
  service: PnlService,
  since: CivilDate | null,
  until: CivilDate,
  display: Display,
): ServicePnl {
  const { book, rates } = service;
  const reasons: Reasons = new Set();
  const asked = since ?? firstDayOf(book) ?? until;
  if (asked > until) {
    reasons.add("no_value");
    return undetermined(service, null, until, reasons);
  }
  const start = measuredStart(service, asked, until, reasons);
  if (start === null) return undetermined(service, null, until, reasons);
  const { from, base, startCents } = start;
  const end = valueAt(book, until, rates);
  if (end.valueCents === null) {
    reasons.add("no_value");
    return undetermined(service, from, until, reasons);
  }
  const endCents = end.valueCents;
  if (end.missing > 0 || valueAt(book, base, rates).missing > 0) reasons.add("stale_price");

  const entries = periodFlows(service, from, until);
  const ends: Ends = { ...start, to: until, endCents };
  const known = knownOf(service, ends, entries);
  const bases = costBases(service, base, until);
  const exits = bases.replayEnd.exits.filter((exit) => exit.on >= from);
  const attribution = attribute(book, bases, exits, known);
  const local = localParts(attribution, known);
  const shown = inDisplay(service, display, { ends, entries, local }, reasons);
  return {
    accountId: service.accountId,
    currency: service.currency,
    status: statusOf(reasons),
    reasons: [...reasons],
    from,
    to: until,
    partial: from > asked,
    startCents,
    endCents,
    endCashCents: bases.atEnd.cashCents,
    openPositions: attribution.openPositions,
    local,
    display: shown.parts,
    localReturn: periodReturn({
      from,
      to: until,
      startCents,
      endCents,
      pnlCents: known.pnlCents,
      flows: entries,
    }),
    displayReturn: shown.periodReturn,
    displayStartCents: shown.startCents,
    displayCapitalCents: shown.capitalCents,
    flows: shown.flows,
    exits,
    transfers: bases.replayEnd.transfers.filter((one) => one.on >= from),
    holdings: holdingRows(book, attribution),
  };
}

/**
 * The P&L of a service from the first day of `whole` to each of `days` (audit INV-8), in the
 * display currency: what `pnlOf(service, whole.from, day)` says of it — the same start, the value
 * of the day and the flows of `whole` up to it — without replaying the positions for each day.
 * `null` where nothing can be measured. The bars of the P&L chart are its differences.
 */
export function pnlThrough(
  service: PnlService,
  whole: ServicePnl,
  days: readonly CivilDate[],
  display: Display,
): (Cents | null)[] {
  return days.map((day) => {
    if (whole.from === null || day < whole.from) return null;
    const start = measuredStart(service, whole.from, day);
    if (start === null) return null;
    const endCents = valueAt(service.book, day, service.rates).valueCents;
    if (endCents === null) return null;
    const flows = whole.flows.filter((flow) => flow.on >= start.from && flow.on <= day);
    return displayTotal(service, display, { ...start, to: day, endCents }, flows)?.pnlCents ?? null;
  });
}
