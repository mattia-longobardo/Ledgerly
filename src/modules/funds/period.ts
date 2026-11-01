import { type Cents } from "@/platform/money";
import {
  addDays,
  type CivilDate,
  daysBetween,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "@/platform/dates";
import { SOURCE_PRECEDENCE } from "@/modules/accounts/rules";
import { modifiedDietz } from "@/modules/investments/pnl";
import { xirr, type Xirr } from "@/modules/investments/xirr";
import { type MovementLike, valuePoints } from "./pension/metrics";
import { accruedTotal, type OperationLike, pendingQuarters, type QuarterStatus } from "./pension/reconcile";
import { netOfFees, NO_FEES, type PensionFees } from "./pension/rules";
import { type DepositSource, monthlyRhythm } from "./rules";

/**
 * The period engine of Funds (docs/design/funds-ux.md §5.2, §5.3). Pure: the caller reads the rows.
 *
 * A fund has no daily price: its value exists only where a person or a document says so. A gain
 * therefore runs between the **dates of two values**, and the money that went in counts only up to
 * the second one. So the gains of the years add up to the gain of "All", to the cent, in every case.
 */

/** A person's or a document's reading. `system` and `derived` are copies, never a valuation. */
export const DOCUMENTED_SOURCES: readonly string[] = ["manual", "import"];

export interface EntryLike {
  on: CivilDate;
  balanceCents: Cents;
  source: string;
}

/** The documented entries, one per day, newest first. On a tie, the source order of spec §7.1 wins. */
export function documentedEntries<T extends EntryLike>(entries: readonly T[]): T[] {
  const rank = (entry: T) => SOURCE_PRECEDENCE.indexOf(entry.source as (typeof SOURCE_PRECEDENCE)[number]);
  const byDay = new Map<CivilDate, T>();
  for (const entry of entries) {
    if (!DOCUMENTED_SOURCES.includes(entry.source)) continue;
    const held = byDay.get(entry.on);
    if (!held || rank(entry) < rank(held)) byDay.set(entry.on, entry);
  }
  return [...byDay.values()].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

/** The last documented entry: the value of a pension fund, with its own date. */
export function latestDocumented<T extends EntryLike>(entries: readonly T[]): T | null {
  return documentedEntries(entries)[0] ?? null;
}

export interface ValuePoint {
  on: CivilDate;
  cents: Cents;
}

/** Every documented value, oldest first: the documented entries, and units × price (§5.2). */
export function documentedPoints(
  entries: readonly EntryLike[],
  movements: readonly MovementLike[] = [],
): ValuePoint[] {
  return valuePoints(
    documentedEntries(entries).map((entry) => ({ on: entry.on, cents: entry.balanceCents })),
    movements,
  ).map(({ on, cents }) => ({ on, cents }));
}

/** Of whom the money is (§5.3). A PAC's money is yours. */
export interface MoneyOrigin {
  youCents: Cents;
  employerCents: Cents;
  tfrCents: Cents;
  otherCents: Cents;
}

const NO_ORIGIN: MoneyOrigin = { youCents: 0n, employerCents: 0n, tfrCents: 0n, otherCents: 0n };

/** One movement of money across the fund's boundary. */
export interface FundFlow {
  on: CivilDate;
  /** Gross. Positive into the fund, negative out of it. */
  chargedCents: Cents;
  /** `null` while the fee is unknown. */
  feeCents: Cents | null;
  origin: MoneyOrigin;
  /** False for a one-off: an initial capital, an enrolment, a voluntary payment, a transfer, an exit. */
  recurring: boolean;
}

/** A PAC's deposits. A deposit the rule found is the plan at work; one written by hand is a one-off. */
export function pacFlows(
  deposits: readonly { on: CivilDate; chargedCents: Cents; feeCents: Cents | null; source: DepositSource }[],
): FundFlow[] {
  return deposits.map((deposit) => ({
    on: deposit.on,
    chargedCents: deposit.chargedCents,
    feeCents: deposit.feeCents,
    origin: { ...NO_ORIGIN, youCents: deposit.chargedCents },
    recurring: deposit.source === "rule",
  }));
}

const INFLOW_CLASSES: readonly string[] = ["contribution", "enrollment", "voluntary", "transfer_in"];

/**
 * A pension fund's flows: its own operations. With no inflow operation at all, the quarters the
 * transfer schedule has carried stand in, each at its own deadline, as `paidInFlows` reads them.
 */
export function pensionFlows(
  operations: readonly OperationLike[],
  quarters: readonly QuarterStatus[] = [],
  fees: PensionFees = NO_FEES,
): FundFlow[] {
  const flows: FundFlow[] = [];
  for (const operation of operations) {
    const origin = {
      youCents: operation.workerCents,
      employerCents: operation.employerCents,
      tfrCents: operation.tfrCents,
      otherCents: operation.otherCents,
    };
    const gross = origin.youCents + origin.employerCents + origin.tfrCents + origin.otherCents;
    if (INFLOW_CLASSES.includes(operation.classification)) {
      flows.push({
        on: operation.operationDate,
        chargedCents: gross,
        feeCents: operation.feesCents,
        origin,
        recurring: operation.classification === "contribution",
      });
    } else if (operation.classification === "withdrawal") {
      // An exit's gross amount is what left the position, however the export signs it.
      flows.push({
        on: operation.operationDate,
        chargedCents: gross < 0n ? gross : -gross,
        feeCents: operation.feesCents,
        origin: NO_ORIGIN,
        recurring: false,
      });
    } else if (operation.feesCents !== 0n) {
      // A switch moves no money across the boundary, but what it costs is still a cost.
      flows.push({
        on: operation.operationDate,
        chargedCents: 0n,
        feeCents: operation.feesCents,
        origin: NO_ORIGIN,
        recurring: false,
      });
    }
  }
  if (operations.some((operation) => INFLOW_CLASSES.includes(operation.classification))) return flows;

  for (const quarter of quarters) {
    if (quarter.status !== "transferred" || quarter.due === null) continue;
    const accrued = (component: string) =>
      quarter.components.find((one) => one.component === component)?.accruedCents ?? 0n;
    const contribution = accruedTotal(quarter) ?? 0n;
    const enrollment = accrued("enrollment");
    if (contribution !== 0n) {
      flows.push({
        on: quarter.due,
        chargedCents: contribution,
        feeCents: netOfFees(contribution, 0n, fees).feesCents,
        origin: {
          ...NO_ORIGIN,
          youCents: accrued("worker"),
          employerCents: accrued("employer"),
          tfrCents: accrued("tfr"),
        },
        recurring: true,
      });
    }
    if (enrollment !== 0n) {
      flows.push({
        on: quarter.due,
        chargedCents: enrollment,
        feeCents: netOfFees(0n, enrollment, fees).feesCents,
        // The payslips' enrolment quota has one line for both sides: it is its own line here too.
        origin: { ...NO_ORIGIN, otherCents: enrollment },
        recurring: false,
      });
    }
  }
  return flows.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
}

/** A span of days, both ends included. `from` is `null` for "All". */
export interface FundPeriod {
  from: CivilDate | null;
  to: CivilDate;
}

export function allPeriod(todayOn: CivilDate): FundPeriod {
  return { from: null, to: todayOn };
}

/** A calendar year, up to today while it runs. */
export function yearPeriod(year: number, todayOn: CivilDate): FundPeriod {
  const end = `${year}-12-31`;
  return { from: `${year}-01-01`, to: end < todayOn ? end : todayOn };
}

/**
 * The last day whose reading still describes a span ending on `to`. A value recorded on the 1st
 * describes the month just closed (decision 3 of §9): without this, December would end up in the
 * year after, since Mattia records the value on the 1st.
 */
export function closingDay(to: CivilDate): CivilDate {
  return to === lastDayOfMonth(monthKey(to)) ? addDays(to, 1) : to;
}

const lastUpTo = (points: readonly ValuePoint[], on: CivilDate): ValuePoint | null => {
  let found: ValuePoint | null = null;
  for (const point of points) if (point.on <= on && (found === null || point.on > found.on)) found = point;
  return found;
};

export interface PeriodMeasure {
  /** `no_value`: no documented value falls in the period, so its gain is not determinable, never 0. */
  status: "measured" | "no_value";
  /** `s` and `V(s)` of §5.2: `null` while nothing can be measured from. */
  start: ValuePoint | null;
  /** `a(p)`: the last documented value the period can see, older than the period if none is in it. */
  end: ValuePoint | null;
  /** The flows in `(s, a(p)]`, what the gain is net of. `null` under `no_value`. */
  flowsCents: Cents | null;
  /** The explicit fees of those flows, the known ones. `null` under `no_value`. */
  feesCents: Cents | null;
  /** True when one of those fees is unknown. */
  feesPartial: boolean;
  gainCents: Cents | null;
  /** Gain + fees: what the value did, with the deposits and the fees taken out (§5.3). */
  marketCents: Cents | null;
  /** Modified Dietz over `(s, a(p)]`. `null` under the capital threshold of Investments. */
  rate: number | null;
  /** Only over 365 days or more; `null` otherwise. */
  xirr: Xirr | null;
  /** The money that went in on the days of the period, gross. Exits are not counted; a reversal is. */
  paidInCents: Cents;
  /** The known fees charged on the days of the period: they stand even with no value to measure. */
  feesPaidCents: Cents;
  /** Of whom that money is. */
  origin: MoneyOrigin;
  /** Flows of the period dated after `a(p)`: no value has seen them yet. */
  notInValueCents: Cents;
}

const inCalendar = (flow: FundFlow, period: FundPeriod) =>
  (period.from === null || flow.on >= period.from) && flow.on <= period.to;

function sumOrigin(flows: readonly FundFlow[]): MoneyOrigin {
  const origin = { ...NO_ORIGIN };
  for (const { origin: one } of flows) {
    origin.youCents += one.youCents;
    origin.employerCents += one.employerCents;
    origin.tfrCents += one.tfrCents;
    origin.otherCents += one.otherCents;
  }
  return origin;
}

/**
 * Where a period starts from. The previous period's last value when there is one; otherwise the
 * day before the first flow, at zero. A first value with no money before it is a position and not
 * a gain, so it is itself the starting point.
 */
function startOf(
  before: ValuePoint | null,
  points: readonly ValuePoint[],
  flows: readonly FundFlow[],
): ValuePoint | null {
  if (before !== null) return before;
  const first = points[0] ?? null;
  // Only money that came in: a switch's cost or an exit says nothing about what the value is made of.
  const firstFlow = flows
    .filter((flow) => flow.chargedCents > 0n)
    .reduce<CivilDate | null>(
      (oldest, flow) => (oldest === null || flow.on < oldest ? flow.on : oldest),
      null,
    );
  if (first === null) return null;
  if (firstFlow === null || firstFlow > first.on) return first;
  return { on: addDays(firstFlow, -1), cents: 0n };
}

/** Everything §5.2 and §5.3 say about one fund over one period. */
export function measurePeriod(input: {
  points: readonly ValuePoint[];
  flows: readonly FundFlow[];
  period: FundPeriod;
}): PeriodMeasure {
  const { flows, period } = input;
  const points = [...input.points].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const before = period.from === null ? null : lastUpTo(points, closingDay(addDays(period.from, -1)));
  const end = lastUpTo(points, closingDay(period.to));

  const calendar = flows.filter((flow) => inCalendar(flow, period));
  const origin = sumOrigin(calendar);
  const paidInCents = origin.youCents + origin.employerCents + origin.tfrCents + origin.otherCents;
  const feesPaidCents = calendar.reduce<Cents>((sum, flow) => sum + (flow.feeCents ?? 0n), 0n);
  const notInValueCents = calendar
    .filter((flow) => end === null || flow.on > end.on)
    .reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
  const common = { paidInCents, feesPaidCents, origin, notInValueCents };

  const start = end === null ? null : startOf(before, points, flows);
  // No new value since the previous period: its flows wait for the next value, so the sum still holds.
  if (end === null || start === null || (before !== null && end.on <= before.on)) {
    return {
      status: "no_value",
      start: null,
      end,
      flowsCents: null,
      feesCents: null,
      feesPartial: false,
      gainCents: null,
      marketCents: null,
      rate: null,
      xirr: null,
      ...common,
    };
  }

  const counted = flows.filter((flow) => flow.on > start.on && flow.on <= end.on);
  const flowsCents = counted.reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
  const feesCents = counted.reduce<Cents>((sum, flow) => sum + (flow.feeCents ?? 0n), 0n);
  const gainCents = end.cents - start.cents - flowsCents;
  const dated = counted.map((flow) => ({ on: flow.on, cents: flow.chargedCents }));
  const days = daysBetween(start.on, end.on);
  return {
    status: "measured",
    start,
    end,
    flowsCents,
    feesCents,
    feesPartial: counted.some((flow) => flow.feeCents === null),
    gainCents,
    marketCents: gainCents + feesCents,
    rate:
      days <= 0
        ? null
        : modifiedDietz({
            from: addDays(start.on, 1),
            to: end.on,
            startCents: start.cents,
            pnlCents: gainCents,
            flows: dated,
          }).rate,
    xirr:
      days >= 365
        ? xirr([
            { on: start.on, cents: -start.cents },
            ...dated.map((flow) => ({ on: flow.on, cents: -flow.cents })),
            { on: end.on, cents: end.cents },
          ])
        : null,
    ...common,
  };
}

/**
 * What the projection runs on (decision 8 of §9): the plan when there is one, otherwise the average
 * of the recurring payments alone. A one-off says nothing about what goes in from here on.
 */
export function projectionMonthly(input: {
  planCents: Cents | null;
  flows: readonly FundFlow[];
  months: readonly MonthKey[];
}): Cents {
  if (input.planCents !== null && input.planCents > 0n) return input.planCents;
  return monthlyRhythm(
    input.flows.filter((flow) => flow.recurring),
    input.months,
  );
}

/** "On the way" (§5.3), always as of today: accrued in the payslips, not yet in the fund. */
export function onTheWay(quarters: readonly QuarterStatus[]) {
  const pending = pendingQuarters(quarters);
  return { cents: pending.reduce<Cents>((sum, quarter) => sum + quarter.cents, 0n), quarters: pending };
}
