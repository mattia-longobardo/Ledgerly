// The money in and out of an account (§2.4), the gain on it and a manual service's P&L (PERS-335).
import { type CivilDate, addDays } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { abs } from "../../../shared/money";
import { returnOnNetCapital, returnOnPaidIn } from "../../../shared/returns";
import { type Book, compareEvents, type OperationLike, periodIndexOf, sortedPeriods } from "./book";

// ——— Money in and out (§2.4) ——————————————————————————————————————————————————————————————

interface Flows {
  /** What the first period opened with: opening cash, positions, or the handover valuation. */
  openingCents: Cents;
  depositedCents: Cents;
  withdrawnCents: Cents;
}

/** One movement of money in or out of an account (§2.4), in the account's currency; `cents` ≥ 0. */
export interface FlowEntry {
  on: CivilDate;
  kind: "opening" | "deposit" | "withdrawal";
  cents: Cents;
  /** The transfer between two of the person's accounts this leg belongs to (A10), if any. */
  transferGroupId: string | null;
  /** Booked in another currency and converted at the ECB rate of its day (eToro Money in EUR). */
  converted?: string | null;
}

/**
 * The money that went into the account up to `on`, one entry per movement: the opening of its
 * first period — a conversion's, or a synced service's at its cut-off (PERS-145) — the deposits and
 * the withdrawals. A later conversion opens a new period at the same value (V before = V after), so
 * it is no flow.
 */
export function flowEntriesOn(book: Book, on: CivilDate): FlowEntry[] {
  const periods = sortedPeriods(book);
  const entries: FlowEntry[] = [];
  for (const event of [...book.events].sort(compareEvents)) {
    if (event.on > on) continue;
    const firstPeriod = periodIndexOf(periods, event) === 0;
    const push = (kind: FlowEntry["kind"], cents: Cents, op?: OperationLike) => {
      const converted =
        op?.nativeCurrency && op.holdingId === null && op.nativeCurrency !== book.currency
          ? op.nativeCurrency
          : null;
      entries.push({
        on: event.on,
        kind,
        cents,
        transferGroupId: event.transferGroupId,
        ...(converted ? { converted } : {}),
      });
    };
    for (const op of event.operations) {
      if (op.kind === "deposit") push("deposit", op.amountCents, op);
      else if (op.kind === "withdrawal") push("withdrawal", -op.amountCents, op);
      else if ((event.origin === "conversion" || event.origin === "provider") && firstPeriod) {
        if (op.kind === "opening_cash" || op.kind === "account_valuation") push("opening", op.amountCents);
        else if (op.kind === "opening_position") push("opening", abs(op.amountCents));
      }
    }
  }
  return entries;
}

/** The entries of {@link flowEntriesOn} summed. */
export function sumFlows(entries: readonly FlowEntry[]): Flows {
  let openingCents = 0n;
  let depositedCents = 0n;
  let withdrawnCents = 0n;
  for (const entry of entries) {
    if (entry.kind === "opening") openingCents += entry.cents;
    else if (entry.kind === "deposit") depositedCents += entry.cents;
    else withdrawnCents += entry.cents;
  }
  return { openingCents, depositedCents, withdrawnCents };
}

/**
 * The money that went into the account up to `on`: the opening of its first period, plus deposits,
 * minus withdrawals. A transfer from another of the person's accounts is a flow for this account
 * (§2.4): only the portfolio leaves it out.
 */
export function flowsOn(book: Book, on: CivilDate): Flows {
  return sumFlows(flowEntriesOn(book, on));
}

/**
 * The flows of {@link flowEntriesOn} as the person sees them for XIRR: money put in is negative,
 * money taken out positive, and the value at `on` is the last amount taken out.
 */
export function investorFlows(
  entries: readonly FlowEntry[],
  on: CivilDate,
  valueCents: Cents,
): { on: CivilDate; cents: Cents }[] {
  return [
    ...entries.map((entry) => ({
      on: entry.on,
      cents: entry.kind === "withdrawal" ? entry.cents : -entry.cents,
    })),
    { on, cents: valueCents },
  ];
}

export interface Performance {
  investedCents: Cents;
  /** V − opening − deposits + withdrawals. */
  gainCents: Cents | null;
  /** gain ÷ (opening + deposits); `null` without a value or without money in. */
  simpleReturn: number | null;
}

/**
 * The gain since the start against the money in and out: of a service, and of the portfolio with its
 * flows in the display currency. Its return is {@link returnOnPaidIn}.
 */
export function performance(flows: Flows, valueCents: Cents | null): Performance {
  const investedCents = flows.openingCents + flows.depositedCents - flows.withdrawnCents;
  const gainCents = valueCents === null ? null : valueCents - investedCents;
  return {
    investedCents,
    gainCents,
    simpleReturn:
      gainCents === null ? null : returnOnPaidIn(gainCents, flows.openingCents + flows.depositedCents),
  };
}

/** A manual value older than this is flagged as old (PERS-335). */
export const STALE_VALUE_DAYS = 30;

/** The profit or loss of an account since it started (PERS-335): value against net money put in. */
export interface AccountPnl {
  valueCents: Cents | null;
  /** The net capital put in: opening + deposits − withdrawals. */
  investedCents: Cents;
  /** value − net capital; `null` without a value or before the first account valuation. */
  pnlCents: Cents | null;
  /** pnl ÷ net capital; `null` without a value or when the net capital is not above zero. */
  rate: number | null;
  /** The day of the last account valuation up to `on`, the source of a manual value. */
  valuedOn: CivilDate | null;
  /** No valuation yet, or the last one older than {@link STALE_VALUE_DAYS}. */
  stale: boolean;
}

export function accountPnl(book: Book, on: CivilDate, valueCents: Cents | null): AccountPnl {
  const { investedCents } = performance(flowsOn(book, on), null);
  let valuedOn: CivilDate | null = null;
  if (book.accountBalances !== undefined) {
    // A view on its account (PERS-342): the value is as old as the last balance read for it.
    for (const one of book.accountBalances) if (one.on <= on && one.observed) valuedOn = one.on;
  } else {
    for (const event of book.events) {
      if (event.on > on || (valuedOn !== null && event.on <= valuedOn)) continue;
      if (event.operations.some((op) => op.kind === "account_valuation")) valuedOn = event.on;
    }
  }
  // No valuation yet: the value is a guess (zero, or flows only), so there is no P&L to show.
  const pnlCents = valueCents === null || valuedOn === null ? null : valueCents - investedCents;
  return {
    valueCents,
    investedCents,
    pnlCents,
    rate: pnlCents === null ? null : returnOnNetCapital(pnlCents, investedCents),
    valuedOn,
    stale: valuedOn === null || valuedOn < addDays(on, -STALE_VALUE_DAYS),
  };
}
