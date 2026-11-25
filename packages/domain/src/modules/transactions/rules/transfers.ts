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
