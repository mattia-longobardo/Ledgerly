// The replay of a book's events (§4.4): the average cost of every holding and what leaves it.
import { type CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { type Book, compareEvents, periodIndexOf, sortedPeriods } from "../rules";
import { divRound } from "../../../shared/money";
import { abs } from "../../../shared/money";
import { periodIndexAt } from "./positions";

// ——— Average cost and realized (§4.4) ————————————————————————————————————————————————————————

/** A quantity that left a holding, at the average cost of the moment (or the eToro position). */
export interface Exit {
  eventId: string;
  on: CivilDate;
  holdingId: string;
  kind: "sell" | "close" | "fee" | "withdrawal";
  proceedsCents: Cents;
  costCents: Cents;
  /** Proceeds − cost; `null` when more left than the book ever held, so the cost is unknown. */
  realizedCents: Cents | null;
  /** `position`: an eToro close matched with its opening by `positionId`. */
  matched: "position" | "average";
  /** The day the quantity that left went in: the eToro opening, or the first buy since the holding was last empty. */
  openedOn: CivilDate | null;
}

/** A leg of an asset moved in or out (§4.9): the value it moved at and the history it carried. */
export interface TransferRecord {
  eventId: string;
  on: CivilDate;
  holdingId: string;
  direction: "in" | "out";
  valueCents: Cents;
  /** The average cost that left with it; `null` for an asset coming in (its cost is its value). */
  historicalCostCents: Cents | null;
  transferGroupId: string | null;
}

export interface CostState {
  quantity: bigint | null;
  costCents: Cents;
  /** A by-value position (no quantity): its value at the last valuation, moved by buys and sells. */
  valueCents?: Cents;
  /** The first entry since the holding was last empty. */
  since?: CivilDate | null;
}

/**
 * Where a period's replay starts (PERS-145): the end of `on` (s⁻), each holding open then with its
 * quantity and, as its cost, its value that day — the basis of the period (§4.4).
 */
interface ReplayStart {
  on: CivilDate;
  states: ReadonlyMap<string, CostState>;
}

export interface Replay {
  exits: Exit[];
  transfers: TransferRecord[];
  /** The cost of every holding at the end of `through`, in the period in force then. */
  costs: Map<string, CostState>;
}

const POSITION = /^trade:(.+):(open|close)$/;

/**
 * Replays the events up to `through` (§4.4): the weighted average cost of every holding, period by
 * period (a conversion starts the positions again), with the cost that leaves on each exit — the
 * number `holdingStates` throws away. The rounding is the same as `holdingStates`.
 */
export function replayHoldings(
  book: Book,
  through: CivilDate,
  externalIds: ReadonlyMap<string, string> = new Map(),
  start?: ReplayStart,
): Replay {
  const periods = sortedPeriods(book);
  const events = book.events
    .filter((event) => event.on <= through && (start === undefined || event.on > start.on))
    .sort(compareEvents);
  // eToro: what each position invested, by positionId (E4), and when it opened.
  const opened = new Map<string, { cents: Cents; on: CivilDate }>();
  for (const event of events) {
    const match = POSITION.exec(externalIds.get(event.id) ?? "");
    if (match?.[2] !== "open") continue;
    const leg = event.operations.find((op) => op.kind === "buy");
    if (leg) opened.set(match[1], { cents: abs(leg.amountCents), on: event.on });
  }

  interface Running {
    quantity: bigint | null;
    /** By-value positions: the value of the last valuation, moved by buys and sells. */
    valueCents: Cents;
    costCents: Cents;
    /** The first entry since the holding was last empty. */
    since: CivilDate | null;
  }
  const exits: Exit[] = [];
  const transfers: TransferRecord[] = [];
  let running = new Map<string, Running>();
  let current: number | null = null;
  if (start !== undefined) {
    // The period's basis: what was open at s⁻, at its value of that day (§4.4, PERS-145).
    current = periodIndexAt(book, start.on);
    for (const [id, state] of start.states) {
      running.set(id, {
        quantity: state.quantity,
        valueCents: state.valueCents ?? state.costCents,
        costCents: state.costCents,
        since: state.since ?? null,
      });
    }
  }
  const stateOf = (id: string): Running => {
    let state = running.get(id);
    if (!state) {
      state = { quantity: null, valueCents: 0n, costCents: 0n, since: null };
      running.set(id, state);
    }
    return state;
  };

  for (const event of events) {
    const index = periodIndexOf(periods, event);
    if (index !== current) {
      running = new Map();
      current = index;
    }
    const position = POSITION.exec(externalIds.get(event.id) ?? "");
    for (const op of event.operations) {
      if (op.holdingId === null) continue;
      const state = stateOf(op.holdingId);
      const amount = abs(op.amountCents);
      /** Takes `quantity` (or, by value, `amount`) out at average cost; returns the cost out. */
      const takeOut = (): { cost: Cents; known: boolean } => {
        if (op.quantity === null || state.quantity === null) {
          const before = state.valueCents;
          state.valueCents -= amount;
          const after = before > 0n ? divRound(state.costCents * state.valueCents, before) : state.costCents;
          const cost = state.costCents - after;
          state.costCents = after;
          return { cost, known: before > 0n && amount <= before };
        }
        const before = state.quantity;
        const after = before - op.quantity;
        const kept =
          before > 0n ? divRound(state.costCents * (after > 0n ? after : 0n), before) : state.costCents;
        const cost = state.costCents - kept;
        state.costCents = kept;
        state.quantity = after;
        return { cost, known: before > 0n && op.quantity <= before };
      };
      const exit = (kind: Exit["kind"]) => {
        const { cost, known } = takeOut();
        exits.push({
          eventId: event.id,
          on: event.on,
          holdingId: op.holdingId!,
          kind,
          proceedsCents: amount,
          costCents: cost,
          realizedCents: known ? amount - cost : null,
          matched: "average",
          openedOn: state.since,
        });
        if (state.quantity === null ? state.valueCents <= 0n : state.quantity <= 0n) state.since = null;
        return cost;
      };
      const enter = () => {
        const empty = state.quantity === null ? state.valueCents <= 0n : state.quantity <= 0n;
        if (empty || state.since === null) state.since = event.on;
      };
      switch (op.kind) {
        case "opening_position":
        case "buy":
        case "deposit":
          enter();
          state.costCents += amount;
          if (op.quantity === null) state.valueCents += amount;
          else state.quantity = (state.quantity ?? 0n) + op.quantity;
          if (op.kind === "deposit") {
            transfers.push({
              eventId: event.id,
              on: event.on,
              holdingId: op.holdingId,
              direction: "in",
              valueCents: amount,
              historicalCostCents: null,
              transferGroupId: event.transferGroupId,
            });
          }
          break;
        case "income":
          // A reward in coins is income at its value, and then the coins cost that (§4.4).
          if (op.quantity !== null) {
            enter();
            state.quantity = (state.quantity ?? 0n) + op.quantity;
            state.costCents += amount;
          }
          break;
        case "valuation":
          if (op.quantity === null && op.unitPrice === null) state.valueCents = op.amountCents;
          break;
        case "sell":
          exit("sell");
          break;
        case "fee":
          // A fee paid in a coin is a sale of the coin at its value, then the fee (§4.4).
          if (op.quantity !== null) exit("fee");
          break;
        case "withdrawal": {
          const cost = exit("withdrawal");
          transfers.push({
            eventId: event.id,
            on: event.on,
            holdingId: op.holdingId,
            direction: "out",
            valueCents: amount,
            historicalCostCents: cost,
            transferGroupId: event.transferGroupId,
          });
          break;
        }
        case "close": {
          const invested = position?.[2] === "close" ? opened.get(position[1]) : undefined;
          if (invested !== undefined) {
            // eToro (§4.4): the position's own investment, not the holding's average.
            if (state.quantity !== null && op.quantity !== null) state.quantity -= op.quantity;
            state.costCents = state.costCents > invested.cents ? state.costCents - invested.cents : 0n;
            exits.push({
              eventId: event.id,
              on: event.on,
              holdingId: op.holdingId,
              kind: "close",
              proceedsCents: amount,
              costCents: invested.cents,
              realizedCents: amount - invested.cents,
              matched: "position",
              openedOn: invested.on,
            });
            if (state.quantity !== null && state.quantity <= 0n) state.since = null;
            break;
          }
          const cost = state.costCents;
          exits.push({
            eventId: event.id,
            on: event.on,
            holdingId: op.holdingId,
            kind: "close",
            proceedsCents: amount,
            costCents: cost,
            realizedCents: amount - cost,
            matched: "average",
            openedOn: state.since,
          });
          state.quantity = state.quantity === null ? null : 0n;
          state.valueCents = 0n;
          state.costCents = 0n;
          state.since = null;
          break;
        }
        default:
          break;
      }
    }
  }

  // The costs of the period in force at `through`: none yet if it has no event so far.
  let inForce = -1;
  for (let index = 0; index < periods.length; index++) if (periods[index].fromOn <= through) inForce = index;
  const costs = new Map<string, CostState>();
  if (current === inForce) {
    for (const [id, state] of running)
      costs.set(id, {
        quantity: state.quantity,
        costCents: state.costCents,
        valueCents: state.valueCents,
        since: state.since,
      });
  }
  return { exits, transfers, costs };
}
