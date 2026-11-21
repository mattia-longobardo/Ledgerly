// The positions of a day (§3.4, §4.2, §4.7, U4) and the basis of a period (PERS-145).
import { addDays, type CivilDate } from "../../../shared/dates";
import { type RateTable } from "../../../platform/fx/rules";
import type { Cents } from "../../../shared/money";
import {
  type AdjustmentClass,
  type Book,
  eventsOn,
  type FlowEntry,
  holdingStates,
  isUnpricedDust,
  type ReadingLike,
  readingOn,
  reconciliationOn,
  sortedPeriods,
  valueAt,
} from "../rules";
import { divRound } from "../../../shared/money";
import { abs } from "../../../shared/money";
import { type CostState, type Replay } from "./replay";

/**
 * The first day `t` of the stretch ending on `end` in which no money can have moved although the
 * flows are not covered (PERS-119): the provider read the value every day from `t − 1` to `end`,
 * always the same, and the book has no event in `[t, end]` — a deposit or a withdrawal would have
 * moved the value, and one in and out on the same day changes no P&L. `end + 1` when there is none.
 */
export function flatSince(book: Book, end: CivilDate): CivilDate {
  const totals = new Map<CivilDate, Cents>();
  for (const reading of book.readings) {
    if (reading.status === "pending_zero") continue;
    totals.set(reading.on, reading.totalCents);
  }
  const booked = new Set(book.events.map((event) => event.on));
  const value = totals.get(end);
  let start = addDays(end, 1);
  if (value === undefined) return start;
  for (let day = end; ; day = addDays(day, -1)) {
    const before = totals.get(addDays(day, -1));
    if (booked.has(day) || before === undefined || before !== value) return start;
    start = day;
  }
}

/** The first day the book knows anything of: its first period or its first event. */
export function firstDayOf(book: Book): CivilDate | null {
  const days = [...book.periods.map((period) => period.fromOn), ...book.events.map((event) => event.on)];
  return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}

/** Corrections in force at the end of `on`, of the classes asked (R3, §4.9). */
export function correctionsOn(
  book: Book,
  on: CivilDate,
  classOf: (eventId: string) => AdjustmentClass,
  classes: ReadonlySet<AdjustmentClass>,
): Cents {
  let total = 0n;
  for (const event of eventsOn(book, on).events) {
    if (!classes.has(classOf(event.id))) continue;
    for (const op of event.operations) {
      if (op.kind !== "adjustment") continue;
      if (event.on <= on && (op.validUntil === null || op.validUntil >= on)) total += op.amountCents;
    }
  }
  return total;
}

export const DATA_RESULT: ReadonlySet<AdjustmentClass> = new Set(["data", "result"]);

// ——— The positions of a day (§3.4, §4.2, §4.7, U4) ————————————————————————————————————————————

/**
 * Where a position's cost comes from (§4.7): the replay of its events (a manual position, a Binance
 * coin whose trades add up to the quantity read), the provider itself (eToro's invested `amount`),
 * or a later reading of the same quantity whose provider said it — the average cost of a position
 * moves only with its quantity. `period`: the basis of a period (PERS-145), its value at s⁻ or what
 * it cost when bought in the period.
 */
type CostSource = "events" | "provider" | "inferred" | "period";

export interface PositionAt {
  /** The holding's id; a provider position no event ever touched is `asset:<assetId>:<product>`. */
  key: string;
  holdingId: string | null;
  assetId: string | null;
  product: string | null;
  origin: "manual" | "provider";
  quantity: bigint | null;
  unitPrice: bigint | null;
  priceCurrency: string | null;
  /** In the account's currency; `null` for a position no market priced. */
  valueCents: Cents | null;
  /** At average cost, in the account's currency; `null` when nothing says it (§4.7). */
  costCents: Cents | null;
  costSource: CostSource | null;
  /** value − cost; `null` without either. */
  unrealizedCents: Cents | null;
}

export interface PositionsAt {
  /**
   * `total`: a manual account kept by value only, which has no positions; `none`: no period yet;
   * `unknown`: the reading in force says a total and nothing of what it holds (a day of eToro's
   * history, an estimated Binance day): its provider positions are unknown, never absent.
   */
  kind: "positions" | "total" | "none" | "unknown";
  positions: PositionAt[];
  /** The cash of the day: the reading's for a synced account, the book's for a manual one. */
  cashCents: Cents | null;
}

/** Two quantities read and replayed are the same one: equal to a millionth (exchange rounding). */
function sameQuantity(replayed: bigint | null, read: bigint | null): boolean {
  if (replayed === null || read === null || read <= 0n) return false;
  return abs(replayed - read) * 1_000_000n <= read;
}

interface ReadGroup {
  assetId: string;
  product: string;
  quantity: bigint | null;
  unitPrice: bigint | null;
  priceCurrency: string | null;
  valueCents: Cents | null;
  /** Σ of the costs the provider gave; `null` when one of them is missing. */
  costCents: Cents | null;
}

/** A reading's positions by asset and product (eToro has a row per trade), dust left out (V4). */
function groupsOf(positions: ReadingLike["positions"], skip: ReadonlySet<string>): Map<string, ReadGroup> {
  const groups = new Map<string, ReadGroup>();
  for (const one of positions) {
    if (isUnpricedDust(one)) continue;
    const key = `${one.assetId}|${one.product}`;
    if (skip.has(key)) continue;
    const quantity = one.quantity ?? null;
    const cost = one.costCents ?? null;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        assetId: one.assetId,
        product: one.product,
        quantity,
        unitPrice: one.unitPrice ?? null,
        priceCurrency: one.priceCurrency ?? null,
        valueCents: one.valueCents,
        costCents: cost,
      });
      continue;
    }
    group.quantity = group.quantity === null || quantity === null ? null : group.quantity + quantity;
    group.valueCents =
      group.valueCents === null || one.valueCents === null ? null : group.valueCents + one.valueCents;
    group.costCents = group.costCents === null || cost === null ? null : group.costCents + cost;
  }
  return groups;
}

/**
 * The open positions at the end of `on` (§3.4), each with its value and its cost: a manual
 * account's from its events; a synced one's from the reading in force, the manual positions it
 * counts next to it, and a cost from the provider, from the replayed events when they add up to the
 * quantity read, or from a later reading of the same quantity (§4.7). A cost nothing says is `null`:
 * that position's unrealized stays in "Other (incomplete data)".
 */
export function positionsOn(book: Book, on: CivilDate, rates: RateTable, replay: Replay): PositionsAt {
  const periods = sortedPeriods(book);
  const index = periodIndexAt(book, on);
  if (index < 0) return { kind: "none", positions: [], cashCents: null };
  const period = periods[index];
  if (period.origin === "manual" && period.mode === "total") {
    return { kind: "total", positions: [], cashCents: null };
  }
  const states = holdingStates(book, on, rates);
  const byId = new Map(book.holdings.map((holding) => [holding.id, holding]));
  const positions: PositionAt[] = [];
  const day = valueAt(book, on, rates);
  const conflicted = new Set(day.conflicts.map((conflict) => conflict.holdingId));
  const replaced = new Set<string>();

  for (const [holdingId, state] of states) {
    const holding = byId.get(holdingId);
    if (!state.open || !holding) continue;
    // A synced account's provider holdings are its trades: the reading says what is open (A6).
    if (period.origin !== "manual" && holding.origin !== "manual") continue;
    let valueCents = state.valueCents ?? 0n;
    let costCents: Cents | null = replay.costs.get(holdingId)?.costCents ?? 0n;
    if (period.origin !== "manual") {
      const decided = reconciliationOn(book.reconciliations, holdingId, on);
      if (decided?.kind === "covered_by_provider") continue;
      if (decided?.kind === "partial" && decided.quantity !== null) {
        // Only the part the provider does not cover counts; its cost is not split (R4).
        const covered =
          state.quantity !== null && state.quantity > 0n
            ? divRound(
                valueCents * (decided.quantity < state.quantity ? decided.quantity : state.quantity),
                state.quantity,
              )
            : 0n;
        valueCents -= covered;
        costCents = null;
      }
      if (conflicted.has(holdingId)) replaced.add(`${holding.assetId}|${holding.product}`);
    }
    positions.push({
      key: holdingId,
      holdingId,
      assetId: holding.assetId,
      product: holding.product,
      origin: holding.origin,
      quantity: state.quantity,
      unitPrice: state.unitPrice,
      priceCurrency: state.priceCurrency,
      valueCents,
      costCents,
      costSource: costCents === null ? null : "events",
      unrealizedCents: costCents === null ? null : valueCents - costCents,
    });
  }
  if (period.origin === "manual") return { kind: "positions", positions, cashCents: day.cashCents };

  const reading = readingOn(book, on);
  if (reading === null) return { kind: "positions", positions, cashCents: null };
  if (reading.positions.length === 0 && (reading.cashCents ?? null) === null && reading.totalCents !== 0n) {
    // A day of history with a total only (eToro): all cash when the service books its trades and
    // they leave nothing open that day.
    const trades = book.events.some(
      (event) => event.origin === "provider" && event.operations.some((op) => op.holdingId !== null),
    );
    const open =
      !trades ||
      book.holdings.some((holding) => {
        if (holding.origin !== "provider") return false;
        const state = replay.costs.get(holding.id);
        return (
          state !== undefined &&
          (state.quantity === null ? (state.valueCents ?? 0n) > 0n : state.quantity > 0n)
        );
      });
    if (open) return { kind: "unknown", positions, cashCents: null };
    return { kind: "positions", positions, cashCents: reading.totalCents };
  }
  const providerHolding = new Map(
    book.holdings
      .filter((holding) => holding.origin === "provider")
      .map((holding) => [`${holding.assetId}|${holding.product}`, holding.id]),
  );
  const later = book.readings
    .filter((one) => one.on > reading.on && one.on >= period.fromOn)
    .filter((one) => one.positions.some((position) => position.costCents != null))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0))
    .map((one) => groupsOf(one.positions, replaced));
  for (const [key, group] of groupsOf(reading.positions, replaced)) {
    const holdingId = providerHolding.get(key) ?? null;
    let costCents = group.costCents;
    let costSource: CostSource | null = costCents === null ? null : "provider";
    if (costCents === null && holdingId !== null) {
      const replayed = replay.costs.get(holdingId);
      if (replayed && sameQuantity(replayed.quantity, group.quantity)) {
        costCents = replayed.costCents;
        costSource = "events";
      }
    }
    if (costCents === null) {
      for (const groups of later) {
        const next = groups.get(key);
        if (!next || next.costCents === null) continue;
        if (next.quantity !== null && next.quantity === group.quantity) {
          costCents = next.costCents;
          costSource = "inferred";
        }
        break;
      }
    }
    positions.push({
      key: holdingId ?? `asset:${key.replace("|", ":")}`,
      holdingId,
      assetId: group.assetId,
      product: group.product,
      origin: "provider",
      quantity: group.quantity,
      unitPrice: group.unitPrice,
      priceCurrency: group.priceCurrency,
      valueCents: group.valueCents,
      costCents,
      costSource,
      unrealizedCents: costCents === null || group.valueCents === null ? null : group.valueCents - costCents,
    });
  }
  return { kind: "positions", positions, cashCents: reading.cashCents ?? null };
}

export function periodIndexAt(book: Book, on: CivilDate): number {
  const periods = sortedPeriods(book);
  let index = -1;
  for (let at = 0; at < periods.length; at++) if (periods[at].fromOn <= on) index = at;
  return index;
}

export const signed = (entry: FlowEntry): Cents => (entry.kind === "withdrawal" ? -entry.cents : entry.cents);

/** Under this value a provider's position is dust (PERS-145): no open position, no unrealized. */
const OPEN_MIN_CENTS = 100n;

export const sumOf = (map: ReadonlyMap<string, Cents>): Cents =>
  [...map.values()].reduce((sum, one) => sum + one, 0n);

/**
 * The cut-off of a synced service (PERS-145): the first day of its first period, when its
 * provider's opening is booked on that day — what it held then, at that day's close, is a flow in.
 * `null` for a manual service, or a synced one with no such opening.
 */
export function cutoffDayOf(book: Book): CivilDate | null {
  const first = sortedPeriods(book)[0];
  if (!first || first.origin === "manual") return null;
  const opened = book.events.some(
    (event) =>
      event.origin === "provider" &&
      event.on === first.fromOn &&
      event.operations.some((op) => op.kind === "opening_cash" || op.kind === "opening_position"),
  );
  return opened ? first.fromOn : null;
}

/** The key a position is measured by: a provider's coin across its products, a manual holding alone. */
function groupKey(position: Pick<PositionAt, "origin" | "assetId" | "key">): string {
  return position.origin === "provider" && position.assetId !== null
    ? `asset:${position.assetId}`
    : position.key;
}

/** The positions of a day by {@link groupKey}: a provider's coin in spot and in Earn is one. */
export function groupPositions(positions: readonly PositionAt[]): Map<string, PositionAt> {
  const groups = new Map<string, PositionAt>();
  const add = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a + b);
  for (const one of positions) {
    const key = groupKey(one);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { ...one, key });
      continue;
    }
    const valueCents = add(group.valueCents, one.valueCents);
    const costCents =
      group.costCents === null || one.costCents === null ? null : group.costCents + one.costCents;
    groups.set(key, {
      ...group,
      holdingId: group.holdingId ?? one.holdingId,
      product: group.product === one.product ? group.product : null,
      quantity: group.quantity === null || one.quantity === null ? null : group.quantity + one.quantity,
      valueCents,
      costCents,
      unrealizedCents: costCents === null || valueCents === null ? null : valueCents - costCents,
    });
  }
  return groups;
}

/** A position still open at the end of a day: a manual one, or a provider's worth at least 1 €. */
export function isOpen(position: PositionAt): boolean {
  if (position.origin === "manual") return true;
  if (position.valueCents === null) return !isUnpricedDust(position);
  return position.valueCents >= OPEN_MIN_CENTS;
}

/**
 * The basis of a period (§4.4, PERS-145): every holding open at s⁻ with its quantity and, as its
 * cost, its value that day — a provider's coin split over its holdings by quantity, a holding the
 * day does not show at zero (it is not in V(s⁻) either). The value of a position no event ever
 * touched stays by asset (`unheld`). Where the positions of s⁻ are unknown, every holding keeps the
 * cost it had.
 */
export function basisOf(
  book: Book,
  at: PositionsAt,
  replay: Replay,
): { states: Map<string, CostState>; unheld: Map<string, Cents> } {
  const states = new Map<string, CostState>();
  for (const [id, state] of replay.costs) states.set(id, { ...state });
  const unheld = new Map<string, Cents>();
  if (at.kind !== "positions") return { states, unheld };
  const holdingOf = new Map(book.holdings.map((holding) => [holding.id, holding]));
  const members = new Map<string, string[]>();
  for (const [id, state] of states) {
    const holding = holdingOf.get(id);
    if (!holding) continue;
    const open = state.quantity === null ? (state.valueCents ?? 0n) > 0n : state.quantity > 0n;
    if (!open) continue;
    const key = holding.origin === "provider" ? `asset:${holding.assetId}` : id;
    members.set(key, [...(members.get(key) ?? []), id]);
  }
  const values = groupPositions(at.positions);
  for (const [key, ids] of members) {
    const cents = values.get(key)?.valueCents ?? 0n;
    const weights = ids.map((id) => {
      const state = states.get(id)!;
      return state.quantity ?? state.valueCents ?? 0n;
    });
    const total = weights.reduce((sum, one) => sum + one, 0n);
    let left = cents;
    ids.forEach((id, index) => {
      const share =
        index === ids.length - 1 ? left : total > 0n ? divRound(cents * weights[index], total) : 0n;
      left -= share;
      const state = states.get(id)!;
      states.set(id, {
        ...state,
        costCents: share,
        valueCents: state.quantity === null ? share : state.valueCents,
      });
    });
  }
  for (const [key, position] of values) {
    if (members.has(key)) continue;
    const cents = position.valueCents ?? 0n;
    if (cents !== 0n) unheld.set(key, cents);
  }
  return { states, unheld };
}
