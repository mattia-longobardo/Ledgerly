import type { Account, AccountGroup, AccountType, BalancePoint } from "../domain/account";

export type NewAccount = Omit<Account, "id" | "version" | "createdAt" | "updatedAt" | "archivedAt">;

export type AccountPatch = Partial<
  Pick<
    Account,
    | "name"
    | "type"
    | "currency"
    | "groupId"
    | "includeInNetWorth"
    | "notes"
    | "sortOrder"
    | "status"
    | "archivedAt"
    | "provider"
    | "origin"
  >
>;

export type NewBalance = Omit<BalancePoint, "capturedAt"> & { capturedAt?: Date };

export interface AccountsRepository {
  list(userId: string, opts?: { includeArchived?: boolean }): Promise<Account[]>;
  get(userId: string, id: string): Promise<Account | null>;
  create(input: NewAccount): Promise<Account>;
  update(userId: string, id: string, expectedVersion: number, patch: AccountPatch): Promise<Account | "version_mismatch" | null>;
  delete(userId: string, id: string): Promise<boolean>;
  latestBalances(userId: string): Promise<Map<string, BalancePoint>>; // keyed by accountId
  history(userId: string, accountIds: string[], sinceAsOf: string): Promise<BalancePoint[]>;
  /** The newest balance strictly before `beforeAsOf`, per account: the seed a windowed series carries forward from. Keyed by accountId. */
  latestBalancesBefore(userId: string, accountIds: string[], beforeAsOf: string): Promise<Map<string, BalancePoint>>;
  recordBalances(rows: NewBalance[]): Promise<void>; // upsert on (accountId, asOf, source)
  hasReferences(accountId: string): Promise<boolean>; // false in Phase 1; budgets and interest rules will consult it
}

export interface ProviderLink {
  provider: string;
  entityType: "account";
  entityId: string;
  externalId: string;
  metadata: Record<string, unknown>;
  missingSince: Date | null;
}

export interface ProviderLinksRepository {
  byExternal(userId: string, provider: string, entityType: "account", externalIds: string[]): Promise<Map<string, ProviderLink>>; // keyed by externalId
  liveFor(entityType: "account", entityId: string): Promise<ProviderLink | null>; // null when missingSince is set
  upsertSeen(userId: string, link: Omit<ProviderLink, "missingSince">, seenAt: Date): Promise<void>;
  markMissing(userId: string, provider: string, entityType: "account", seenExternalIds: string[], at: Date): Promise<string[]>; // entityIds newly marked missing
}

export interface ProviderAccount {
  externalId: string;
  name: string;
  type: AccountType;
  currency: string;
  archived: boolean;
  balance: string;
  available: string | null;
  asOf: string;
  updatedAt: Date | null;
}

export interface AccountsSource {
  provider: string;
  fetchAccounts(): Promise<ProviderAccount[]>;
}

export interface Clock {
  now(): Date;
}

export interface GroupsRepository {
  list(userId: string): Promise<AccountGroup[]>;
  get(userId: string, id: string): Promise<AccountGroup | null>;
  create(userId: string, name: string, sortOrder?: number): Promise<AccountGroup | "duplicate_name">;
  rename(userId: string, id: string, name: string): Promise<AccountGroup | "duplicate_name" | null>;
  delete(userId: string, id: string): Promise<boolean>;
}
