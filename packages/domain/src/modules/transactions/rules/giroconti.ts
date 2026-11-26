import type { Cents } from "../../../shared/money";
import { normalise } from "../categorize/text";
import { DAY_MS, type TransactionOrigin, type TransactionType } from "./vocabulary";

/*
 * Giroconti between the person's own accounts (decisions 6A–9A of 2026-11-25). Pure: the service
 * reads the rows, this decides, the service writes. Never touches a pair that exists — one made by
 * hand above all —, and never decides between two candidates: a tie is a proposal for the person.
 */

/** The longest gap between the two legs of a giroconto found by IBAN: a bank transfer's clearing. */
export const IBAN_DAYS = 5;
/** The longest gap between two legs found by amount and day (rule 3). */
const MATCH_DAYS = 3;

/**
 * How far, in percent, an Investments leg in another currency may be from its bank movement converted
 * on the bank movement's day (PERS-659): the broker's conversion fee and the move of the rate
 * between the bank's day and the broker's (docs/design/investments-cash-movements.md §5.5).
 */
const FX_GAP_PERCENT = 3n;

/**
 * `cents` of `from` in `to` at `at` (the reader's `fx_rates`), or `null` without a rate. Without
 * one, legs in two currencies never pair.
 */
export type ConvertCents = (cents: Cents, from: string, to: string, instant: Date) => Cents | null;

const NO_CONVERSION: ConvertCents = () => null;

const abs = (cents: Cents) => (cents < 0n ? -cents : cents);

/** The words of a bank's own code that say "a transfer" (ISO 20022 and the banks' own). */
const TRANSFER_CODE_WORDS = new Set([
  "transfer",
  "transfers",
  "trf",
  "giroconto",
  "bonifico",
  "icdt",
  "rcdt",
]);

/** Spaces and dashes out, upper case: the form an IBAN is compared in. */
function compact(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

/** One of the person's accounts that has an IBAN. */
export interface OwnIban {
  accountId: string;
  iban: string;
}

/** A stored movement as the rules of the giroconti read it. */
export interface OwnTransferRow {
  id: string;
  accountId: string;
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  type: TransactionType;
  origin: TransactionOrigin;
  transferGroupId: string | null;
  transferOutside: boolean;
  /** The other account the person (or an IBAN) named while the leg waits for its twin. */
  transferAccountId: string | null;
  payee: string | null;
  note: string | null;
  rawText: string | null;
  bankTransactionCode: string | null;
  categoryOrigin: string | null;
  locallyEdited: readonly string[];
}

export interface OwnTransferPlan {
  /** The rows whose pair changes: their new group, or `null` to leave one. */
  groups: { id: string; transferGroupId: string | null }[];
  /** Rows an IBAN makes a giroconto, with the account it names when the twin is not here yet. */
  transfers: { id: string; transferAccountId: string | null }[];
  /** Pairs found by amount and day that are not sure enough: the person confirms them. */
  proposals: { outId: string; inId: string }[];
}

/** The key a pair of legs is known by in `giroconto_proposals`: money out first. */
export function proposalKey(outId: string, inId: string): string {
  return `${outId}|${inId}`;
}

const compareIds = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const byTime = (left: OwnTransferRow, right: OwnTransferRow) =>
  left.occurredAt.getTime() - right.occurredAt.getTime() || compareIds(left.id, right.id);
const distance = (left: OwnTransferRow, right: OwnTransferRow) =>
  Math.abs(left.occurredAt.getTime() - right.occurredAt.getTime());

/** Whether a bank's code says the movement is a transfer. */
export function isTransferCode(code: string | null): boolean {
  return (
    code !== null &&
    normalise(code)
      .split(" ")
      .some((word) => TRANSFER_CODE_WORDS.has(word))
  );
}

/** What a run of the rules has decided so far, over the rows it was handed. */
class Work {
  /** Each row's new group, or `null` to leave its pair. */
  readonly group = new Map<string, string | null>();
  /** The rows an IBAN makes a giroconto, with the account it names. */
  readonly transfers = new Map<string, string | null>();
  readonly ordered: OwnTransferRow[];

  constructor(
    readonly rows: readonly OwnTransferRow[],
    private readonly convert: ConvertCents,
  ) {
    this.ordered = [...rows].sort(byTime);
  }

  /**
   * The two amounts are each other's opposite: equal in one currency; in two, only between an
   * Investments leg and a movement of another origin, the movement converted into the leg's currency
   * on its own day and at most {@link FX_GAP_PERCENT} % from the leg.
   */
  opposite(one: OwnTransferRow, other: OwnTransferRow): boolean {
    if (one.currency === other.currency) return other.amountCents === -one.amountCents;
    if ((one.origin === "investments") === (other.origin === "investments")) return false;
    const [leg, bank] = one.origin === "investments" ? [one, other] : [other, one];
    if (leg.amountCents < 0n === bank.amountCents < 0n) return false;
    const converted = this.convert(-bank.amountCents, bank.currency, leg.currency, bank.occurredAt);
    return (
      converted !== null && abs(converted - leg.amountCents) * 100n <= FX_GAP_PERCENT * abs(leg.amountCents)
    );
  }

  groupOf(row: OwnTransferRow): string | null {
    return this.group.has(row.id) ? this.group.get(row.id)! : row.transferGroupId;
  }

  isTransfer(row: OwnTransferRow): boolean {
    return row.type === "transfer" || this.transfers.has(row.id);
  }

  accountOf(row: OwnTransferRow): string | null {
    return this.transfers.get(row.id) ?? row.transferAccountId;
  }

  /**
   * A leg that may still be paired: alone, not to an account outside, and a giroconto already or a
   * movement nobody filed — a type decided here, or a category a person or a source chose, stays.
   * The leg of an Investments deposit is "outside" only until its bank movement arrives (PERS-651):
   * free while nobody chose its side.
   */
  free(row: OwnTransferRow): boolean {
    if (this.groupOf(row) !== null) return false;
    if (row.transferOutside) return row.origin === "investments" && !row.locallyEdited.includes("type");
    if (this.isTransfer(row)) return true;
    return (
      row.origin === "provider" &&
      !row.locallyEdited.includes("type") &&
      row.categoryOrigin !== "user" &&
      row.categoryOrigin !== "provider"
    );
  }

  /** Neither leg names an account other than the other's. */
  accountsFit(leg: OwnTransferRow, other: OwnTransferRow): boolean {
    const mine = this.accountOf(leg);
    const theirs = this.accountOf(other);
    return (mine === null || mine === other.accountId) && (theirs === null || theirs === leg.accountId);
  }

  pair(leg: OwnTransferRow, other: OwnTransferRow): void {
    const id = leg.id < other.id ? leg.id : other.id;
    this.group.set(leg.id, id);
    this.group.set(other.id, id);
  }
}

/** 1 · A grouped row that is not a transfer leaves its pair, and so does a group left with one row. */
function leaveBroken(work: Work): void {
  for (const row of work.rows) {
    if (row.type !== "transfer" && row.transferGroupId !== null) work.group.set(row.id, null);
  }
  const members = new Map<string, number>();
  for (const row of work.rows) {
    const id = work.groupOf(row);
    if (id !== null) members.set(id, (members.get(id) ?? 0) + 1);
  }
  for (const row of work.rows) {
    const id = work.groupOf(row);
    if (id !== null && members.get(id) === 1) work.group.set(row.id, null);
  }
}

/** 2 · IBAN (rule 2): see {@link planOwnTransfers}. */
function pairByIban(work: Work, own: readonly OwnIban[]): void {
  const ibanOf = new Map(own.map((one) => [one.accountId, one.iban]));
  const textOf = (row: OwnTransferRow) =>
    compact(`${row.payee ?? ""} ${row.note ?? ""} ${row.rawText ?? ""}`);
  for (const leg of work.ordered) {
    if (!work.free(leg)) continue;
    const target = own.find((one) => one.accountId !== leg.accountId && textOf(leg).includes(one.iban));
    if (!target) continue;
    if (leg.transferAccountId !== null && leg.transferAccountId !== target.accountId) continue;
    const back = ibanOf.get(leg.accountId);
    const namesBack = (row: OwnTransferRow) => (back !== undefined && textOf(row).includes(back) ? 0 : 1);
    const twin = work.ordered
      .filter(
        (other) =>
          other.accountId === target.accountId &&
          work.free(other) &&
          work.accountsFit(leg, other) &&
          work.opposite(leg, other) &&
          distance(other, leg) <= IBAN_DAYS * DAY_MS,
      )
      .sort(
        (left, right) =>
          namesBack(left) - namesBack(right) ||
          distance(left, leg) - distance(right, leg) ||
          byTime(left, right),
      )[0];
    if (twin) work.pair(leg, twin);
    else if (leg.type !== "transfer" || leg.transferAccountId === null)
      work.transfers.set(leg.id, target.accountId);
  }
}

type Proposals = Map<string, { outId: string; inId: string }>;

/**
 * The rows that may be a row's other leg, in order: in its currency only the opposite amount pairs,
 * so it looks only there; in another currency, only an Investments leg and a movement of another
 * origin pair, and there are few legs.
 */
function partners(rows: readonly OwnTransferRow[]): (row: OwnTransferRow) => readonly OwnTransferRow[] {
  const index = new Map<string, OwnTransferRow[]>();
  const keyOf = (currency: string, amount: Cents) => `${currency} ${amount}`;
  for (const row of rows) {
    const key = keyOf(row.currency, row.amountCents);
    const same = index.get(key);
    if (same) same.push(row);
    else index.set(key, [row]);
  }
  const legs = rows.filter((row) => row.origin === "investments");
  return (row) => {
    const same = index.get(keyOf(row.currency, -row.amountCents)) ?? [];
    const pool = row.origin === "investments" ? rows : legs;
    const other = pool.filter((one) => one.currency !== row.currency);
    return other.length === 0 ? same : [...same, ...other];
  };
}

/** 3 · Amount and day (rule 3), until a pass pairs nothing more: see {@link planOwnTransfers}. */
function pairByAmount(work: Work, rejected: ReadonlySet<string>): Proposals {
  const proposals: Proposals = new Map();
  const signal = (row: OwnTransferRow) => work.isTransfer(row) || isTransferCode(row.bankTransactionCode);
  const matches = (out: OwnTransferRow, into: OwnTransferRow) =>
    out.amountCents < 0n &&
    into.amountCents > 0n &&
    out.accountId !== into.accountId &&
    work.opposite(out, into) &&
    work.free(out) &&
    work.free(into) &&
    work.accountsFit(out, into) &&
    distance(out, into) <= MATCH_DAYS * DAY_MS &&
    (signal(out) || signal(into)) &&
    !rejected.has(proposalKey(out.id, into.id));
  const partnersOf = partners(work.ordered);
  for (let paired = true; paired;) {
    paired = false;
    for (const out of work.ordered) {
      if (out.amountCents >= 0n || !work.free(out)) continue;
      const candidates = partnersOf(out).filter((into) => matches(out, into));
      if (candidates.length === 0) continue;
      const nearest = Math.min(...candidates.map((into) => distance(out, into)));
      const best = candidates.filter((into) => distance(out, into) === nearest);
      const rivals =
        best.length === 1
          ? partnersOf(best[0]).filter(
              (other) =>
                other.id !== out.id && matches(other, best[0]) && distance(other, best[0]) <= nearest,
            )
          : [];
      if (best.length === 1 && rivals.length === 0) {
        work.pair(out, best[0]);
        paired = true;
        continue;
      }
      // A nearer leg on the other side takes it in its own turn; an equal one is a tie.
      if (rivals.some((other) => distance(other, best[0]) < nearest)) continue;
      for (const [left, right] of [
        ...best.map((into) => [out, into]),
        ...rivals.map((other) => [other, best[0]]),
      ]) {
        proposals.set(proposalKey(left.id, right.id), { outId: left.id, inId: right.id });
      }
    }
  }
  return proposals;
}

/**
 * The giroconti of a person's movements. In order:
 *
 * 1. A grouped row that is not a transfer leaves its pair, and so does a group left with one row.
 * 2. IBAN (rule 2): a movement whose text holds the IBAN of *another* of the person's accounts is a
 *    giroconto — an income or a spending too, unless somebody decided its type or a person or a
 *    source chose its category. Its twin is looked for in that account: the opposite amount, same
 *    currency (or an Investments leg in another: see `Work.opposite`), at most {@link IBAN_DAYS} days apart, preferring one that names this account back,
 *    then the nearest. Without a twin the leg waits with that account named.
 * 3. Amount and day (rule 3): two free legs on two accounts, opposite amounts (`Work.opposite`), at
 *    most {@link MATCH_DAYS} days apart, with at least one signal (a leg already a giroconto, or a
 *    bank code of a transfer), and not rejected by the person. The nearest day wins; a pair is made
 *    only when it is the only nearest one from both sides. A tie is a proposal, never a decision.
 *
 * A pair's group id is its smaller id. One spending split into several incomes is never paired:
 * only the same amount pairs. `convert` reads the rates for an Investments leg in another currency
 * than its bank movement (PERS-659). Returns only what changes.
 */
export function planOwnTransfers(
  own: readonly OwnIban[],
  rows: readonly OwnTransferRow[],
  rejected: ReadonlySet<string> = new Set(),
  convert: ConvertCents = NO_CONVERSION,
): OwnTransferPlan {
  const work = new Work(rows, convert);
  leaveBroken(work);
  if (own.length > 0) pairByIban(work, own);
  const proposals = pairByAmount(work, rejected);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sortById = <T extends { id: string }>(list: T[]) =>
    list.sort((left, right) => compareIds(left.id, right.id));
  return {
    groups: sortById(
      [...work.group]
        .filter(([id, transferGroupId]) => byId.get(id)?.transferGroupId !== transferGroupId)
        .map(([id, transferGroupId]) => ({ id, transferGroupId })),
    ),
    transfers: sortById(
      [...work.transfers]
        .filter(([id]) => work.groupOf(byId.get(id)!) === null)
        .map(([id, transferAccountId]) => ({ id, transferAccountId })),
    ),
    proposals: [...proposals.values()]
      .filter((one) => work.free(byId.get(one.outId)!) && work.free(byId.get(one.inId)!))
      .sort((left, right) =>
        compareIds(proposalKey(left.outId, left.inId), proposalKey(right.outId, right.inId)),
      ),
  };
}
