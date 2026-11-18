import type { Cents } from "../../../shared/money";
import { DAY_MS, type TransactionType } from "./vocabulary";

/* Transfers */

/** One side of a possible transfer: a stored row, or one this sync is about to write. */
export interface TransferLeg {
  id: string;
  externalId: string;
  counterpartExternalId: string | null;
  transferGroupId: string | null;
}

interface TransferAssignment {
  id: string;
  transferGroupId: string;
}

/**
 * The identity of a transfer: the pair of external ids, ordered, so both legs compute the same key
 * whichever one is looked at and whichever sync each arrived in (spec §7.2).
 */
export function transferPairKey(externalId: string, counterpartExternalId: string): string {
  return JSON.stringify([externalId, counterpartExternalId].sort());
}

/**
 * Pairs transfer legs, and only ever on the counterpart reference the provider gave — never on a
 * matching amount and date, which is a coincidence and not a fact (spec §7.2). The group id is the
 * smallest local id of the pair: an id that already exists (the column is a self foreign key) and
 * that does not depend on the order the legs arrived in, so re-running a sync decides the same
 * group again.
 *
 * Pass every leg that could take part, not only this run's: a stored leg whose twin arrives weeks
 * later pairs the moment both are in the list, which is how pairing works across syncs. A leg
 * whose twin has not been seen yet pairs nothing and stays a single movement; a reference held by
 * one side only is enough, because the pair key is built from both external ids either way.
 * Returns only the legs whose group id actually changes.
 */
export function pairTransfers(legs: readonly TransferLeg[]): TransferAssignment[] {
  const byExternalId = new Map<string, TransferLeg>();
  for (const leg of legs) {
    if (!byExternalId.has(leg.externalId)) byExternalId.set(leg.externalId, leg);
  }

  const groups = new Map<string, TransferLeg[]>();
  for (const leg of legs) {
    const counterpartExternalId = leg.counterpartExternalId;
    if (counterpartExternalId === null || counterpartExternalId === leg.externalId) continue;
    const counterpart = byExternalId.get(counterpartExternalId);
    if (!counterpart) continue;
    const key = transferPairKey(leg.externalId, counterpartExternalId);
    const members = groups.get(key) ?? [];
    for (const member of [leg, counterpart]) {
      if (!members.some((known) => known.id === member.id)) members.push(member);
    }
    groups.set(key, members);
  }

  const assignments: TransferAssignment[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const transferGroupId = members.map((member) => member.id).sort()[0];
    for (const member of members) {
      if (member.transferGroupId === transferGroupId) continue;
      assignments.push({ id: member.id, transferGroupId });
    }
  }
  return assignments.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* Giroconti by IBAN */

/** The longest gap between the two legs of a giroconto found by IBAN: a bank transfer's clearing. */
const IBAN_TRANSFER_MAX_DAYS = 5;

/** Spaces and dashes out, upper case: the form an IBAN is compared in. */
function compact(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

/** One of the user's accounts that has an IBAN. */
export interface OwnIban {
  accountId: string;
  iban: string;
}

/** A stored movement as the IBAN rule reads it. */
export interface IbanRuleRow {
  id: string;
  accountId: string;
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  type: TransactionType;
  transferGroupId: string | null;
  payee: string | null;
  note: string | null;
}

/** A change of pairing the IBAN rule decides: the row's new group, or `null` to leave a pair. */
interface IbanPairing {
  id: string;
  transferGroupId: string | null;
}

/**
 * Pairs the two legs of a giroconto by IBAN (F2.5, 2026-09-18). Which movements *are* giroconti is
 * the provider's call, never this rule's: Wallet files one under its Transfer category, or links
 * its two legs, and the app follows it so its totals reconcile with Wallet's own. A movement Wallet
 * counts as income or spending stays one here too, whatever IBAN its details name.
 *
 * What Wallet often leaves undone is the link between the legs. A transfer whose payee or note holds
 * the IBAN of *another* of the user's accounts is looked for in the account that IBAN names: a
 * transfer of the opposite amount, in the same currency, at most {@link IBAN_TRANSFER_MAX_DAYS}
 * days apart, not in a pair already — preferring one that names this account's IBAN back, then the
 * nearest in time. The IBAN is what makes the match a fact rather than a coincidence of amount and
 * date. The pair's group id is the smaller local id, as for the provider's pairs.
 *
 * A row that is no longer a transfer (Wallet re-filed it under a category of the user's) leaves its
 * group, and so does a group of one — both left behind by an earlier version of this rule. A pair
 * of two transfers is never taken apart. Returns only the rows whose group changes.
 */
export function planIbanTransfers(
  own: readonly OwnIban[],
  rows: readonly IbanRuleRow[],
  maxDays = IBAN_TRANSFER_MAX_DAYS,
): IbanPairing[] {
  const changes = new Map<string, string | null>();
  const groupOf = (row: IbanRuleRow) => (changes.has(row.id) ? changes.get(row.id)! : row.transferGroupId);

  // Leaving: a grouped row that is not a transfer, then any group left with a single member.
  for (const row of rows) {
    if (row.type !== "transfer" && row.transferGroupId !== null) changes.set(row.id, null);
  }
  const members = new Map<string, number>();
  for (const row of rows) {
    const group = groupOf(row);
    if (group !== null) members.set(group, (members.get(group) ?? 0) + 1);
  }
  for (const row of rows) {
    const group = groupOf(row);
    if (group !== null && members.get(group) === 1) changes.set(row.id, null);
  }

  if (own.length > 0) {
    const single = (row: IbanRuleRow) => row.type === "transfer" && groupOf(row) === null;
    const ibanOf = new Map(own.map((one) => [one.accountId, one.iban]));
    const textOf = (row: IbanRuleRow) => compact(`${row.payee ?? ""} ${row.note ?? ""}`);
    const ordered = [...rows].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const leg of ordered) {
      if (!single(leg)) continue;
      const text = textOf(leg);
      const target = own.find((one) => one.accountId !== leg.accountId && text.includes(one.iban));
      if (!target) continue;
      const back = ibanOf.get(leg.accountId);
      const distance = (row: IbanRuleRow) => Math.abs(row.occurredAt.getTime() - leg.occurredAt.getTime());
      const namesBack = (row: IbanRuleRow) => (back !== undefined && textOf(row).includes(back) ? 0 : 1);
      const twin = ordered
        .filter(
          (other) =>
            other.accountId === target.accountId &&
            single(other) &&
            other.currency === leg.currency &&
            other.amountCents === -leg.amountCents &&
            distance(other) <= maxDays * DAY_MS,
        )
        .sort(
          (a, b) => namesBack(a) - namesBack(b) || distance(a) - distance(b) || (a.id < b.id ? -1 : 1),
        )[0];
      if (!twin) continue;
      const group = leg.id < twin.id ? leg.id : twin.id;
      changes.set(leg.id, group);
      changes.set(twin.id, group);
    }
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...changes]
    .filter(([id, group]) => byId.get(id)?.transferGroupId !== group)
    .map(([id, transferGroupId]) => ({ id, transferGroupId }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
