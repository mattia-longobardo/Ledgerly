// The transfers between the person's accounts (§2.4, A10): the legs and the proposals.
import { type CivilDate } from "../../../shared/dates";
import { daysBetween } from "../../../shared/dates";

// ——— Transfers between the person's accounts (§2.4, A10) ————————————————————————————————————

/** How far apart the two legs of a proposed transfer may fall. */
export const TRANSFER_WINDOW_DAYS = 3;

/** The main leg of a deposit or a withdrawal, as the transfer proposal compares it. */
export interface TransferLeg {
  eventId: string;
  accountId: string;
  on: CivilDate;
  kind: "deposit" | "withdrawal";
  /** The asset moved, or `null` for cash. */
  assetId: string | null;
  /** The quantity of the asset, or the cash amount as a fixed-point decimal of {@link PRICE_SCALE}. */
  amount: bigint;
  /** The cash currency; `null` for an asset. */
  currency: string | null;
  transferGroupId: string | null;
}

interface TransferProposal {
  withdrawal: TransferLeg;
  deposit: TransferLeg;
}

function daysApart(a: CivilDate, b: CivilDate): number {
  return Math.abs(daysBetween(a, b));
}

/**
 * The transfers the UI proposes (§2.4): a withdrawal from one account and a deposit into another,
 * of the same asset and quantity (or the same cash amount and currency), at most
 * {@link TRANSFER_WINDOW_DAYS} apart, neither already part of a transfer. Each leg is proposed
 * once, with the closest partner; ties go to the older leg, so the answer is deterministic.
 */
export function transferProposals(legs: readonly TransferLeg[]): TransferProposal[] {
  const free = legs.filter((leg) => leg.transferGroupId === null);
  const order = (a: TransferLeg, b: TransferLeg) =>
    a.on !== b.on ? (a.on < b.on ? -1 : 1) : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  const withdrawals = free.filter((leg) => leg.kind === "withdrawal").sort(order);
  const deposits = free.filter((leg) => leg.kind === "deposit").sort(order);
  const taken = new Set<string>();
  const proposals: TransferProposal[] = [];
  for (const withdrawal of withdrawals) {
    let best: TransferLeg | null = null;
    for (const deposit of deposits) {
      if (taken.has(deposit.eventId) || deposit.accountId === withdrawal.accountId) continue;
      if (deposit.assetId !== withdrawal.assetId || deposit.currency !== withdrawal.currency) continue;
      if (deposit.amount !== withdrawal.amount) continue;
      const apart = daysApart(deposit.on, withdrawal.on);
      if (apart > TRANSFER_WINDOW_DAYS) continue;
      if (best === null || apart < daysApart(best.on, withdrawal.on)) best = deposit;
    }
    if (best) {
      taken.add(best.eventId);
      proposals.push({ withdrawal, deposit: best });
    }
  }
  return proposals;
}
