// The positions of an account on a day (§2.1): quantity, price, value and cost of each holding.
import { type CivilDate } from "../../../shared/dates";
import { convertCents, type RateTable } from "../../../platform/fx/rules";
import type { Cents } from "../../../shared/money";
import { divRound } from "../../../shared/money";
import { abs } from "../../../shared/money";
import { type Book, eventsOn } from "./book";
import { atRate, positionCents } from "./vocabulary";

// ——— Positions —————————————————————————————————————————————————————————————————————————————

export interface HoldingState {
  holdingId: string;
  /** `null` for a position kept by value only (a BTP, a fund bought for an amount, A3). */
  quantity: bigint | null;
  /** The last unit price (buy, sell, valuation, opening), in `priceCurrency`. */
  unitPrice: bigint | null;
  priceCurrency: string | null;
  pricedOn: CivilDate | null;
  /** The value in the account's currency; `null` only when neither a rate nor a saved one exists. */
  valueCents: Cents | null;
  /** What is still invested in it at average cost, in the account's currency. */
  costCents: Cents;
  /** The part of value − cost due to the exchange rate (assets quoted in another currency). */
  fxEffectCents: Cents;
  /** The value used a saved rate because `fx_rates` had none for the day. */
  staleRate: boolean;
  open: boolean;
}

/**
 * Every holding's state at the end of `on` (§2.1, A2): quantity, last price, value and cost, from
 * the events of the period in force only. The value of an asset quoted in another currency uses the
 * ECB rate of `on`; without one, the rate saved on the operation that set the price, flagged.
 */
export function holdingStates(book: Book, on: CivilDate, rates: RateTable): Map<string, HoldingState> {
  const { events } = eventsOn(book, on);
  const byId = new Map(book.holdings.map((holding) => [holding.id, holding]));
  interface Running {
    quantity: bigint | null;
    unitPrice: bigint | null;
    priceCurrency: string | null;
    pricedOn: CivilDate | null;
    priceRate: bigint | null;
    /** By-value positions: the value set by the last valuation, moved by later buys and sells. */
    valueCents: Cents;
    costCents: Cents;
    /** Σ quantity × saved rate, for the average rate the cost was paid at. */
    rateWeight: bigint;
    rateQuantity: bigint;
    touched: boolean;
    closed: boolean;
  }
  const running = new Map<string, Running>();
  const stateOf = (id: string): Running => {
    let state = running.get(id);
    if (!state) {
      state = {
        quantity: null,
        unitPrice: null,
        priceCurrency: null,
        pricedOn: null,
        priceRate: null,
        valueCents: 0n,
        costCents: 0n,
        rateWeight: 0n,
        rateQuantity: 0n,
        touched: false,
        closed: false,
      };
      running.set(id, state);
    }
    return state;
  };
  for (const event of events) {
    for (const op of event.operations) {
      if (op.holdingId === null || !byId.has(op.holdingId)) continue;
      const state = stateOf(op.holdingId);
      const price = () => {
        if (op.unitPrice !== null) {
          state.unitPrice = op.unitPrice;
          state.priceCurrency = op.priceCurrency;
          state.pricedOn = event.on;
          state.priceRate = op.fxRate;
        }
      };
      switch (op.kind) {
        case "opening_position":
        case "buy": {
          state.touched = true;
          state.closed = false;
          const cost = abs(op.amountCents);
          if (op.quantity === null) {
            state.valueCents += cost;
          } else {
            state.quantity = (state.quantity ?? 0n) + op.quantity;
            if (op.fxRate !== null) {
              state.rateWeight += op.quantity * op.fxRate;
              state.rateQuantity += op.quantity;
            }
          }
          state.costCents += cost;
          price();
          break;
        }
        case "sell": {
          if (op.quantity === null) {
            const before = state.valueCents;
            state.valueCents -= abs(op.amountCents);
            if (before > 0n) state.costCents = divRound(state.costCents * state.valueCents, before);
          } else {
            const before = state.quantity ?? 0n;
            const after = before - op.quantity;
            if (before > 0n) state.costCents = divRound(state.costCents * (after > 0n ? after : 0n), before);
            if (state.rateQuantity > 0n && before > 0n) {
              state.rateWeight = divRound(state.rateWeight * (after > 0n ? after : 0n), before);
              state.rateQuantity = after > 0n ? after : 0n;
            }
            state.quantity = after;
          }
          price();
          break;
        }
        case "valuation":
          state.touched = true;
          if (op.quantity === null && op.unitPrice === null) state.valueCents = op.amountCents;
          price();
          break;
        case "close":
          state.quantity = state.quantity === null ? null : 0n;
          state.valueCents = 0n;
          state.costCents = 0n;
          state.rateWeight = 0n;
          state.rateQuantity = 0n;
          state.closed = true;
          price();
          break;
        case "income":
          if (op.quantity !== null) state.quantity = (state.quantity ?? 0n) + op.quantity;
          break;
        case "fee":
          if (op.quantity !== null) state.quantity = (state.quantity ?? 0n) - op.quantity;
          break;
        default:
          break;
      }
    }
  }
  const states = new Map<string, HoldingState>();
  for (const [holdingId, state] of running) {
    if (!state.touched) continue;
    let valueCents: Cents | null;
    let staleRate = false;
    let fxEffectCents = 0n;
    if (state.quantity === null) {
      valueCents = state.closed ? 0n : state.valueCents;
    } else if (state.unitPrice === null || state.quantity <= 0n) {
      valueCents = 0n;
    } else {
      const currency = state.priceCurrency ?? book.currency;
      const native = positionCents(state.quantity, state.unitPrice);
      valueCents = convertCents(native, currency, book.currency, on, rates);
      if (valueCents === null && state.priceRate !== null) {
        valueCents = atRate(native, state.priceRate);
        staleRate = true;
      }
      if (valueCents !== null && currency !== book.currency && state.rateQuantity > 0n) {
        const paidRate = divRound(state.rateWeight, state.rateQuantity);
        fxEffectCents = valueCents - atRate(native, paidRate);
      }
    }
    const open = !state.closed && (state.quantity === null ? state.valueCents > 0n : state.quantity > 0n);
    states.set(holdingId, {
      holdingId,
      quantity: state.quantity,
      unitPrice: state.unitPrice,
      priceCurrency: state.priceCurrency,
      pricedOn: state.pricedOn,
      valueCents: open ? valueCents : 0n,
      costCents: open ? state.costCents : 0n,
      fxEffectCents: open ? fxEffectCents : 0n,
      staleRate,
      open,
    });
  }
  return states;
}
