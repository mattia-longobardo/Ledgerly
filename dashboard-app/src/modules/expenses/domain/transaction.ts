export type TransactionType = "income" | "expense" | "transfer";
export type TransactionState = "pending" | "cleared" | "reconciled";
export type CategoryKind = "income" | "expense" | "transfer" | "system";
export type RecordSource = "manual" | "provider" | "system" | "migration";

export interface Transaction {
  id: string;
  userId: string;
  accountId: string;
  occurredAt: Date;
  bookedAt: Date | null;
  amount: string;
  currency: string;
  type: TransactionType;
  state: TransactionState;
  categoryId: string | null;
  payee: string | null;
  note: string | null;
  transferGroupId: string | null;
  source: RecordSource;
  syncRunId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionCategory {
  id: string;
  userId: string;
  name: string;
  groupName: string | null;
  kind: CategoryKind;
  color: string | null;
  parentId: string | null;
  source: RecordSource;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionLabel {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  source: RecordSource;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransferCandidate {
  id: string;
  accountId: string;
  amount: string;
  occurredAt: Date;
  externalTransferRef: string | null;
}

/**
 * Pairs transfer legs that share an explicit provider transfer reference.
 * Two legs with no shared reference are never merged on an amount/date
 * coincidence — an unmatched transfer stays two separate transactions, and a
 * reference held by only one leg (the other side hasn't synced yet, or never
 * will) pairs nothing rather than guessing. The group id is the
 * lexicographically smallest of the paired transaction ids, so it is always a
 * real, already-existing uuid and needs no extra column; picking a fixed rule
 * instead of "whichever sorts first in the input" keeps the group id stable
 * no matter what order legs arrive in.
 */
export function pairTransfers(candidates: readonly TransferCandidate[]): Map<string, string> {
  const byRef = new Map<string, TransferCandidate[]>();
  for (const c of candidates) {
    if (!c.externalTransferRef) continue;
    const list = byRef.get(c.externalTransferRef) ?? [];
    list.push(c);
    byRef.set(c.externalTransferRef, list);
  }

  const groupOf = new Map<string, string>();
  for (const legs of byRef.values()) {
    if (legs.length < 2) continue;
    const groupId = [...legs].map((leg) => leg.id).sort()[0]!;
    for (const leg of legs) groupOf.set(leg.id, groupId);
  }
  return groupOf;
}
