export type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "investment"
  | "pension_fund"
  | "crypto"
  | "credit"
  | "other";

export type AccountStatus = "active" | "unavailable" | "archived";
export type AccountOrigin = "manual" | "synced";
export type BalanceSource = "manual" | "provider" | "system" | "migration";

export interface Account {
  id: string;
  userId: string;
  groupId: string | null;
  name: string;
  type: AccountType;
  currency: string;
  origin: AccountOrigin;
  provider: string | null;
  status: AccountStatus;
  includeInNetWorth: boolean;
  notes: string | null;
  sortOrder: number;
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BalancePoint {
  accountId: string;
  asOf: string; // YYYY-MM-DD
  balance: string;
  available: string | null;
  source: BalanceSource;
  capturedAt: Date;
}

export type DeletionDecision = "hard_delete" | "archive" | "blocked_linked";

/**
 * A synced account that is still live upstream can never be deleted from
 * here — the provider owns it, so unlinking has to happen first. Otherwise,
 * anything with references (budgets, interest rules, or simply being a
 * synced account whose history matters) gets archived rather than removed;
 * a fully manual, unreferenced account is safe to hard-delete.
 */
export function deletionDecision(
  a: Account,
  f: { hasLiveProviderLink: boolean; hasReferences: boolean },
): DeletionDecision {
  if (a.origin === "synced" && f.hasLiveProviderLink) return "blocked_linked";
  if (f.hasReferences || a.origin === "synced") return "archive";
  return "hard_delete";
}
