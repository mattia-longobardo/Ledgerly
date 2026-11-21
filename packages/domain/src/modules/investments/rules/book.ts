// The book of one account (§2): its periods, events, holdings, readings and reconciliations, in order.
import { type CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import {
  type AccountOrigin,
  type EventOrigin,
  type HoldingOrigin,
  type Leg,
  type Mode,
  type OperationKind,
  type ReadingStatus,
  type ReconciliationKind,
} from "./vocabulary";

// ——— The book of one account ———————————————————————————————————————————————————————————————

export interface PeriodLike {
  fromOn: CivilDate;
  /** Where the period starts inside its first day: events ordered before it belong to the one before. */
  startsAt: Date;
  mode: Mode;
  origin: AccountOrigin;
}

export interface OperationLike {
  leg: Leg;
  holdingId: string | null;
  kind: OperationKind;
  quantity: bigint | null;
  unitPrice: bigint | null;
  priceCurrency: string | null;
  /** Signed, in the account's currency (§1.5). */
  amountCents: Cents;
  /** Account units per unit of `priceCurrency`, saved when the operation was written (A5). */
  fxRate: bigint | null;
  validUntil: CivilDate | null;
  /** The currency the provider booked the operation in, when it is not the account's. */
  nativeCurrency?: string | null;
}

export interface EventLike {
  id: string;
  on: CivilDate;
  occurredAt: Date;
  seq: bigint;
  origin: EventOrigin;
  transferGroupId: string | null;
  operations: readonly OperationLike[];
}

export interface HoldingLike {
  id: string;
  assetId: string;
  origin: HoldingOrigin;
  product: string;
  /** The asset's quote currency. */
  currency: string;
}

export interface ReadingLike {
  id: string;
  on: CivilDate;
  status: ReadingStatus;
  totalCents: Cents;
  /** The cash the provider read, when it says it apart from the positions. */
  cashCents?: Cents | null;
  positions: readonly {
    assetId: string;
    product: string;
    valueCents: Cents | null;
    quantity?: bigint | null;
    /** What the position cost, in the account's currency, when the provider says (eToro, U4). */
    costCents?: Cents | null;
    /** The provider's unit price, in `priceCurrency`. */
    unitPrice?: bigint | null;
    priceCurrency?: string | null;
  }[];
  scopes: readonly { product: string; complete: boolean }[];
}

export interface ReconciliationLike {
  holdingId: string;
  effectiveOn: CivilDate;
  kind: ReconciliationKind;
  quantity: bigint | null;
  decidedAt: Date;
}

export interface Book {
  /** `accounts.currency`: every amount of the account is in it. */
  currency: string;
  periods: readonly PeriodLike[];
  events: readonly EventLike[];
  holdings: readonly HoldingLike[];
  readings: readonly ReadingLike[];
  reconciliations: readonly ReconciliationLike[];
  /**
   * The account's own balance, one row per day in date order, for a manual service (§1.3,
   * PERS-342): Accounts holds its value — typed there, or read by Wallet — and in its manual
   * periods V is that balance, never a value of the module's own. `undefined` for a service the
   * module writes.
   */
  accountBalances?: readonly AccountBalanceLike[];
}

export interface AccountBalanceLike {
  on: CivilDate;
  cents: Cents;
  /** Read by a person or a provider, not a snapshot copy or a month end rebuilt from movements. */
  observed: boolean;
}

/** The deterministic order of events (A2): day, then the moment, then the insertion sequence. */
export function compareEvents(a: EventLike, b: EventLike): number {
  if (a.on !== b.on) return a.on < b.on ? -1 : 1;
  const time = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (time !== 0) return time;
  return a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0;
}

function comparePeriods(a: PeriodLike, b: PeriodLike): number {
  if (a.fromOn !== b.fromOn) return a.fromOn < b.fromOn ? -1 : 1;
  return a.startsAt.getTime() - b.startsAt.getTime();
}

export function sortedPeriods(book: Book): PeriodLike[] {
  return [...book.periods].sort(comparePeriods);
}

/** The period an event belongs to: the last one that starts at or before it. */
export function periodIndexOf(
  periods: readonly PeriodLike[],
  event: { on: CivilDate; occurredAt: Date },
): number {
  let found = -1;
  for (let index = 0; index < periods.length; index++) {
    const period = periods[index];
    const starts =
      period.fromOn < event.on ||
      (period.fromOn === event.on && period.startsAt.getTime() <= event.occurredAt.getTime());
    if (starts) found = index;
  }
  return found;
}

/** The period in force at the end of `on`: the last one that starts on or before it. */
function periodIndexOn(periods: readonly PeriodLike[], on: CivilDate): number {
  let found = -1;
  for (let index = 0; index < periods.length; index++) if (periods[index].fromOn <= on) found = index;
  return found;
}

/** The events of the period in force at the end of `on`, up to `on`, in order. */
export function eventsOn(book: Book, on: CivilDate): { period: PeriodLike | null; events: EventLike[] } {
  const periods = sortedPeriods(book);
  const index = periodIndexOn(periods, on);
  if (index < 0) return { period: null, events: [] };
  const events = book.events
    .filter((event) => event.on <= on && periodIndexOf(periods, event) === index)
    .sort(compareEvents);
  return { period: periods[index], events };
}
