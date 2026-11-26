// The account's leg of a deposit, a withdrawal or a voluntary contribution (PERS-651): what
// Investments and Funds hand to the port that writes the legs, and what it gives back. Realised by
// transactions, wired by the application (10-modularity.md §10.3).
import type { CivilDate } from "./dates";
import type { Cents } from "./money";

/** A leg an account should have; `legId` is the one written before, if any. */
export interface WantedLeg {
  legId: string | null;
  on: CivilDate;
  /** Signed: money into the investment account for a deposit, out of it for a withdrawal. */
  amountCents: Cents;
  note: string | null;
  /** The bank movement the operation names: the leg is paired with it. */
  pairWith: string | null;
}

/** The leg an operation wants, from the columns Investments and Funds keep alike. */
export const wantedLegOf = (row: {
  legTransactionId: string | null;
  on: CivilDate;
  amountCents: Cents;
  note: string | null;
  transactionId: string | null;
}): WantedLeg => ({
  legId: row.legTransactionId,
  on: row.on,
  amountCents: row.amountCents,
  note: row.note,
  pairWith: row.transactionId,
});

/** The other side of a giroconto, as the person chooses it. */
type LegSide = { kind: "account"; accountId: string } | { kind: "outside" } | { kind: "none" };

/** What the person chose for a leg; `auto` leaves it to the rules, then to an account outside. */
type LegChoice = { kind: "auto" } | { kind: "pair"; transactionId: string } | LegSide;

export interface WrittenLegs {
  /** The leg of each wanted one, in the same order. */
  legIds: string[];
  /** The legs written or changed, and the partners a change left alone: what the settle step pairs. */
  touched: string[];
  /** The bank movement a new leg, or one in no pair, goes with. */
  choices: Map<string, LegChoice>;
}
