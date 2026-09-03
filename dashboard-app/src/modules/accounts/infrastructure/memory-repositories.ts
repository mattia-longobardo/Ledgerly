import type { Account, AccountGroup, BalancePoint } from "../domain/account";
import type {
  AccountPatch,
  AccountsRepository,
  Clock,
  GroupsRepository,
  NewAccount,
  NewBalance,
  ProviderLink,
  ProviderLinksRepository,
} from "../application/ports";

/** In-memory stand-in for the Drizzle-backed repository, used by unit tests and Phase 1 wiring before Task 14 lands persistence. */
export class MemoryAccountsRepository implements AccountsRepository {
  private accounts: Account[] = [];
  private balances: BalancePoint[] = [];

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<Account[]> {
    const includeArchived = opts?.includeArchived ?? false;
    return this.accounts
      .filter((a) => a.userId === userId && (includeArchived || a.status !== "archived"))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async get(userId: string, id: string): Promise<Account | null> {
    return this.accounts.find((a) => a.userId === userId && a.id === id) ?? null;
  }

  async create(input: NewAccount): Promise<Account> {
    const now = new Date();
    const account: Account = {
      ...input,
      id: crypto.randomUUID(),
      version: 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.push(account);
    return account;
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: AccountPatch,
  ): Promise<Account | "version_mismatch" | null> {
    const index = this.accounts.findIndex((a) => a.userId === userId && a.id === id);
    if (index === -1) return null;
    const current = this.accounts[index]!;
    if (current.version !== expectedVersion) return "version_mismatch";
    const updated: Account = { ...current, ...patch, version: current.version + 1, updatedAt: new Date() };
    this.accounts[index] = updated;
    return updated;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const index = this.accounts.findIndex((a) => a.userId === userId && a.id === id);
    if (index === -1) return false;
    this.accounts.splice(index, 1);
    return true;
  }

  async latestBalances(userId: string): Promise<Map<string, BalancePoint>> {
    const ownedIds = new Set(this.accounts.filter((a) => a.userId === userId).map((a) => a.id));
    const latest = new Map<string, BalancePoint>();
    for (const b of this.balances) {
      if (!ownedIds.has(b.accountId)) continue;
      const current = latest.get(b.accountId);
      if (!current || b.asOf > current.asOf || (b.asOf === current.asOf && b.capturedAt > current.capturedAt)) {
        latest.set(b.accountId, b);
      }
    }
    return latest;
  }

  async history(userId: string, accountIds: string[], sinceAsOf: string): Promise<BalancePoint[]> {
    const ownedIds = new Set(this.accounts.filter((a) => a.userId === userId).map((a) => a.id));
    const wanted = new Set(accountIds.filter((id) => ownedIds.has(id)));
    return this.balances
      .filter((b) => wanted.has(b.accountId) && b.asOf >= sinceAsOf)
      .sort((a, b) => a.asOf.localeCompare(b.asOf));
  }

  async latestBalancesBefore(
    userId: string,
    accountIds: string[],
    beforeAsOf: string,
  ): Promise<Map<string, BalancePoint>> {
    const ownedIds = new Set(this.accounts.filter((a) => a.userId === userId).map((a) => a.id));
    const wanted = new Set(accountIds.filter((id) => ownedIds.has(id)));
    const seeds = new Map<string, BalancePoint>();
    for (const b of this.balances) {
      if (!wanted.has(b.accountId) || b.asOf >= beforeAsOf) continue;
      const current = seeds.get(b.accountId);
      if (!current || b.asOf > current.asOf || (b.asOf === current.asOf && b.capturedAt > current.capturedAt)) {
        seeds.set(b.accountId, b);
      }
    }
    return seeds;
  }

  async recordBalances(rows: NewBalance[]): Promise<void> {
    for (const row of rows) {
      const point: BalancePoint = { ...row, capturedAt: row.capturedAt ?? new Date() };
      const index = this.balances.findIndex(
        (b) => b.accountId === point.accountId && b.asOf === point.asOf && b.source === point.source,
      );
      if (index === -1) this.balances.push(point);
      else this.balances[index] = point;
    }
  }

  async hasReferences(_accountId: string): Promise<boolean> {
    return false;
  }
}

interface StoredProviderLink extends ProviderLink {
  userId: string;
  seenAt: Date;
}

/** In-memory stand-in for the Drizzle-backed provider-link repository. */
export class MemoryProviderLinksRepository implements ProviderLinksRepository {
  private links: StoredProviderLink[] = [];

  async byExternal(
    userId: string,
    provider: string,
    entityType: "account",
    externalIds: string[],
  ): Promise<Map<string, ProviderLink>> {
    const wanted = new Set(externalIds);
    const result = new Map<string, ProviderLink>();
    for (const link of this.links) {
      if (link.userId !== userId || link.provider !== provider || link.entityType !== entityType) continue;
      if (!wanted.has(link.externalId)) continue;
      result.set(link.externalId, link);
    }
    return result;
  }

  async liveFor(entityType: "account", entityId: string): Promise<ProviderLink | null> {
    const link = this.links.find((l) => l.entityType === entityType && l.entityId === entityId);
    if (!link || link.missingSince !== null) return null;
    return link;
  }

  async upsertSeen(userId: string, link: Omit<ProviderLink, "missingSince">, seenAt: Date): Promise<void> {
    const index = this.links.findIndex(
      (l) => l.provider === link.provider && l.entityType === link.entityType && l.externalId === link.externalId,
    );
    const stored: StoredProviderLink = { ...link, userId, missingSince: null, seenAt };
    if (index === -1) this.links.push(stored);
    else this.links[index] = stored;
  }

  async markMissing(
    userId: string,
    provider: string,
    entityType: "account",
    seenExternalIds: string[],
    at: Date,
  ): Promise<string[]> {
    const seen = new Set(seenExternalIds);
    const newlyMissing: string[] = [];
    for (const link of this.links) {
      if (link.userId !== userId || link.provider !== provider || link.entityType !== entityType) continue;
      if (seen.has(link.externalId) || link.missingSince !== null) continue;
      link.missingSince = at;
      newlyMissing.push(link.entityId);
    }
    return newlyMissing;
  }
}

/** In-memory stand-in for the Drizzle-backed groups repository. */
export class MemoryGroupsRepository implements GroupsRepository {
  private groups: AccountGroup[] = [];

  async list(userId: string): Promise<AccountGroup[]> {
    return this.groups
      .filter((g) => g.userId === userId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async get(userId: string, id: string): Promise<AccountGroup | null> {
    return this.groups.find((g) => g.userId === userId && g.id === id) ?? null;
  }

  async create(userId: string, name: string, sortOrder = 0): Promise<AccountGroup | "duplicate_name"> {
    if (this.groups.some((g) => g.userId === userId && g.name === name)) return "duplicate_name";
    const now = new Date();
    const group: AccountGroup = { id: crypto.randomUUID(), userId, name, sortOrder, createdAt: now, updatedAt: now };
    this.groups.push(group);
    return group;
  }

  async rename(userId: string, id: string, name: string): Promise<AccountGroup | "duplicate_name" | null> {
    const index = this.groups.findIndex((g) => g.userId === userId && g.id === id);
    if (index === -1) return null;
    if (this.groups.some((g) => g.userId === userId && g.id !== id && g.name === name)) return "duplicate_name";
    const updated: AccountGroup = { ...this.groups[index]!, name, updatedAt: new Date() };
    this.groups[index] = updated;
    return updated;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const index = this.groups.findIndex((g) => g.userId === userId && g.id === id);
    if (index === -1) return false;
    this.groups.splice(index, 1);
    return true;
  }
}

/** Settable clock for deterministic tests. */
export class MemoryClock implements Clock {
  private current: Date;

  constructor(at: Date) {
    this.current = at;
  }

  now(): Date {
    return this.current;
  }

  set(at: Date): void {
    this.current = at;
  }
}
