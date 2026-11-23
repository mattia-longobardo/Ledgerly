// A sale of more than is held (rewrite plan R5d): the quantity of a position kept by hand, day by
// day. Pure, as the rest of the engine.
import type { CivilDate } from "../../../shared/dates";
import { type Book, eventsOn, type OperationLike } from "./book";

/** Every day of the book: the period in force at the end of the last one holds the positions. */
const LAST_DAY = "9999-12-31";

/** How an operation moves the quantity of its holding; null for a kind that does not. */
function quantityMove(operation: OperationLike, held: bigint): bigint | null {
  if (operation.quantity === null) return null;
  switch (operation.kind) {
    case "opening_position":
    case "buy":
    case "income":
      return operation.quantity;
    case "sell":
    case "fee":
      return -operation.quantity;
    case "close":
      // A close sells what is left; a quantity above it is a sale of more than is held.
      return operation.quantity > held ? -operation.quantity : -held;
    default:
      return null;
  }
}

/**
 * The first position kept by hand whose quantity is below zero at the end of a day, with that day;
 * null when none is. A sale before a purchase of the same day is not short: the day counts, not the
 * order the two were typed in.
 */
export function shortPosition(book: Book): { holdingId: string; on: CivilDate } | null {
  const manual = new Set(book.holdings.filter((holding) => holding.origin === "manual").map((one) => one.id));
  const held = new Map<string, bigint>();
  const { events } = eventsOn(book, LAST_DAY);
  for (let index = 0; index < events.length; index += 1) {
    for (const operation of events[index].operations) {
      if (operation.holdingId === null || !manual.has(operation.holdingId)) continue;
      const move = quantityMove(operation, held.get(operation.holdingId) ?? 0n);
      if (move !== null) held.set(operation.holdingId, (held.get(operation.holdingId) ?? 0n) + move);
    }
    const day = events[index].on;
    if (events[index + 1]?.on === day) continue;
    for (const [holdingId, quantity] of held) if (quantity < 0n) return { holdingId, on: day };
  }
  return null;
}
