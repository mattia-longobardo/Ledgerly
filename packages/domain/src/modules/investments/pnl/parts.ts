// The parts of a service's P&L (§4.2, §4.4, audit INV-8): the cost bases, the realized and the unrealized.
import { type CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { type Book } from "../rules";
import {
  basisOf,
  groupPositions,
  isOpen,
  periodIndexAt,
  type PositionAt,
  type PositionsAt,
  positionsOn,
  sumOf,
} from "./positions";
import { type CostState, type Exit, type Replay, replayHoldings } from "./replay";
import { type HoldingPnl, type PnlParts, type PnlService } from "./types";

interface CostBases {
  atStart: PositionsAt;
  atEnd: PositionsAt;
  basis: { states: Map<string, CostState>; unheld: Map<string, Cents> };
  replayEnd: Replay;
  /** No conversion between the two ends: the positions of both can be compared. */
  samePeriod: boolean;
}

/**
 * Step 5, the replay and the cost bases (§4.4, PERS-145): the positions at the end of `base` and
 * of `to`, on the period's own basis — a position open at s⁻ costs its value at s⁻, one bought in
 * the period what it cost.
 */
export function costBases(service: PnlService, base: CivilDate, to: CivilDate): CostBases {
  const { book, rates, externalIds } = service;
  const replayBase = replayHoldings(book, base, externalIds);
  const atStart = positionsOn(book, base, rates, replayBase);
  const basis = basisOf(book, atStart, replayBase);
  const replayEnd = replayHoldings(book, to, externalIds, { on: base, states: basis.states });
  const atEnd = positionsOn(book, to, rates, replayEnd);
  const startIndex = periodIndexAt(book, base);
  return {
    atStart,
    atEnd,
    basis,
    replayEnd,
    samePeriod: startIndex === periodIndexAt(book, to) || startIndex < 0,
  };
}

/** What the parts are measured against: the P&L and the parts that are not a position's. */
export interface Known {
  pnlCents: Cents;
  endCents: Cents;
  incomeCents: Cents;
  feesCents: Cents;
  correctionsCents: Cents;
}

/** The parts of the positions, by {@link groupKey}: realized, unrealized, the basis they stand on. */
interface Attribution {
  groupOfHolding: Map<string, string>;
  realizedBy: Map<string, Cents>;
  soldKeys: Set<string>;
  startBy: Map<string, PositionAt>;
  endBy: Map<string, PositionAt>;
  unrealizedBy: Map<string, Cents>;
  basisBy: Map<string, Cents>;
  costUnknown: Set<string>;
  unrealizedChangeCents: Cents | null;
  openPositions: number;
}

const addTo = (map: Map<string, Cents>, key: string, cents: Cents) =>
  map.set(key, (map.get(key) ?? 0n) + cents);

/**
 * The basis left at the last day, by {@link groupKey}; a position no event and no day of s⁻ speaks
 * of costs what its provider says, or is unknown: the keys returned.
 */
function basisAtEnd(attribution: Attribution, replayEnd: Replay): Set<string> {
  const { groupOfHolding, basisBy, endBy } = attribution;
  for (const [holdingId, state] of replayEnd.costs) {
    addTo(basisBy, groupOfHolding.get(holdingId) ?? holdingId, state.costCents);
  }
  const unknown = new Set<string>();
  for (const [key, held] of endBy) {
    if (basisBy.has(key)) continue;
    if (held.costCents !== null) basisBy.set(key, held.costCents);
    else unknown.add(key);
  }
  return unknown;
}

/**
 * What is left of the basis at the last day (PERS-145), by asset (a provider's coin across its
 * products) or by manual holding: against the value of a position still open, the unrealized;
 * against a position gone or left as dust, what its closing realized.
 */
function measureOpen(attribution: Attribution, replayEnd: Replay): void {
  const { basisBy, endBy, unrealizedBy, realizedBy, costUnknown } = attribution;
  const unknown = basisAtEnd(attribution, replayEnd);
  let openPositions = 0;
  for (const key of new Set([...basisBy.keys(), ...endBy.keys()])) {
    const held = endBy.get(key);
    const open = held !== undefined && isOpen(held);
    if (open) openPositions += 1;
    if (unknown.has(key)) continue;
    const rest = (held?.valueCents ?? 0n) - (basisBy.get(key) ?? 0n);
    if (open) unrealizedBy.set(key, rest);
    else if (rest !== 0n) addTo(realizedBy, key, rest);
  }
  attribution.unrealizedChangeCents =
    unknown.size > 0 && unrealizedBy.size === 0 ? null : sumOf(unrealizedBy);
  attribution.openPositions = openPositions;
  for (const key of unknown) costUnknown.add(key);
}

/**
 * Step 6, the parts of the positions (§4.2): a sale realized against the period's basis, the
 * unrealized only of the positions still open at the last day. "Value only" (no positions): what is
 * not income, fee or correction is the change of value; positions unknown at either end (a
 * conversion in the period, a day of history with a total only): their change stays out.
 */
export function attribute(book: Book, bases: CostBases, exits: readonly Exit[], known: Known): Attribution {
  const groupOfHolding = new Map(
    book.holdings.map((holding) => [
      holding.id,
      holding.origin === "provider" ? `asset:${holding.assetId}` : holding.id,
    ]),
  );
  const realizedBy = new Map<string, Cents>();
  const soldKeys = new Set<string>();
  for (const exit of exits) {
    const key = groupOfHolding.get(exit.holdingId) ?? exit.holdingId;
    addTo(realizedBy, key, exit.proceedsCents - exit.costCents);
    soldKeys.add(key);
  }
  const { atStart, atEnd, samePeriod } = bases;
  const attribution: Attribution = {
    groupOfHolding,
    realizedBy,
    soldKeys,
    startBy: groupPositions(atStart.positions),
    endBy: groupPositions(atEnd.positions),
    unrealizedBy: new Map(),
    basisBy: new Map(bases.basis.unheld),
    costUnknown: new Set(),
    unrealizedChangeCents: 0n,
    openPositions: 0,
  };
  if (samePeriod && atEnd.kind === "total" && atStart.kind !== "positions") {
    const { pnlCents, incomeCents, feesCents, correctionsCents } = known;
    attribution.unrealizedChangeCents =
      pnlCents - sumOf(realizedBy) - incomeCents - feesCents - correctionsCents;
    attribution.openPositions = known.endCents !== 0n ? 1 : 0;
  } else if (
    !samePeriod ||
    atEnd.kind === "unknown" ||
    atEnd.kind === "total" ||
    atStart.kind === "unknown"
  ) {
    attribution.unrealizedChangeCents = null;
  } else {
    measureOpen(attribution, bases.replayEnd);
  }
  return attribution;
}

/** The parts in the account's currency (§4.2): what no part explains is left unattributed. */
export function localParts(attribution: Attribution, known: Known): PnlParts {
  const { pnlCents, incomeCents, feesCents, correctionsCents } = known;
  const { unrealizedChangeCents } = attribution;
  const realizedCents = sumOf(attribution.realizedBy);
  return {
    pnlCents,
    realizedCents,
    unrealizedChangeCents,
    incomeCents,
    feesCents,
    correctionsCents,
    fxCents: 0n,
    unattributedCents:
      pnlCents - realizedCents - (unrealizedChangeCents ?? 0n) - incomeCents - feesCents - correctionsCents,
  };
}

/**
 * Step 7, by position: what each one added in the period (realized + unrealized), the sold ones too
 * (PERS-113 · 4), on the same basis as the parts.
 */
export function holdingRows(book: Book, attribution: Attribution): HoldingPnl[] {
  const { groupOfHolding, realizedBy, startBy, endBy, unrealizedBy, basisBy, costUnknown, soldKeys } =
    attribution;
  const holdingIdOf = new Map<string, string>();
  for (const [holdingId, key] of groupOfHolding) if (!holdingIdOf.has(key)) holdingIdOf.set(key, holdingId);
  const assetOf = new Map(book.holdings.map((holding) => [holding.id, holding]));
  const measured = attribution.unrealizedChangeCents !== null;
  // A position open at e, with the period's basis as its cost: its unrealized is the part's.
  const endOf = (key: string): PositionAt | null => {
    const held = endBy.get(key);
    if (!held || !unrealizedBy.has(key)) return held ?? null;
    return {
      ...held,
      costCents: basisBy.get(key) ?? 0n,
      costSource: "period",
      unrealizedCents: unrealizedBy.get(key)!,
    };
  };
  // The holding, the asset and the product of a key: the position's, or its holding's when closed.
  const positionOf = (key: string) => endBy.get(key) ?? startBy.get(key) ?? null;
  const holdingOf = (holdingId: string | null) => (holdingId === null ? undefined : assetOf.get(holdingId));
  const identity = (key: string) => {
    const position = positionOf(key);
    const holdingId = position?.holdingId ?? holdingIdOf.get(key) ?? null;
    const holding = holdingOf(holdingId);
    return {
      holdingId,
      assetId: position?.assetId ?? holding?.assetId ?? null,
      product: position?.product ?? holding?.product ?? null,
    };
  };
  const keys = new Set([...realizedBy.keys(), ...startBy.keys(), ...endBy.keys()]);
  return [...keys].sort().map((key) => {
    const realized = realizedBy.get(key) ?? 0n;
    const change = measured && !costUnknown.has(key) ? (unrealizedBy.get(key) ?? 0n) : null;
    return {
      key,
      ...identity(key),
      realizedCents: realized,
      unrealizedChangeCents: change,
      contributionCents: change === null ? null : realized + change,
      open: unrealizedBy.has(key) || (!measured && endBy.has(key)),
      sold: soldKeys.has(key),
      start: startBy.get(key) ?? null,
      end: endOf(key),
    };
  });
}
