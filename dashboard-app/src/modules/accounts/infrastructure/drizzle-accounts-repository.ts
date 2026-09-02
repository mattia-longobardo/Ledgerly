import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { accountBalances, accounts, type AccountRow } from "@/lib/db/schema";
import type {
  Account,
  AccountOrigin,
  AccountStatus,
  AccountType,
  BalancePoint,
  BalanceSource,
} from "../domain/account";
import type { AccountPatch, AccountsRepository, NewAccount, NewBalance } from "../application/ports";

/** The table stores the enums as text, so the domain types are re-applied on the way out. */
function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    userId: row.userId,
    groupId: row.groupId,
    name: row.name,
    type: row.type as AccountType,
    currency: row.currency,
    origin: row.origin as AccountOrigin,
    provider: row.provider,
    status: row.status as AccountStatus,
    includeInNetWorth: row.includeInNetWorth,
    notes: row.notes,
    sortOrder: row.sortOrder,
    version: row.version,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed accounts store. Every method assumes the client is a
 * transaction carrying the caller's RLS context (see `withUserContext`);
 * the explicit `user_id` predicates keep the intent readable and hold even
 * under the system context, where RLS lets everything through.
 */
export class DrizzleAccountsRepository implements AccountsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<Account[]> {
    const owned = eq(accounts.userId, userId);
    const rows = await this.db
      .select()
      .from(accounts)
      .where(opts?.includeArchived ? owned : and(owned, ne(accounts.status, "archived")))
      .orderBy(asc(accounts.sortOrder), asc(accounts.name));
    return rows.map(toAccount);
  }

  async get(userId: string, id: string): Promise<Account | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
      .limit(1);
    return row ? toAccount(row) : null;
  }

  async create(input: NewAccount): Promise<Account> {
    const [row] = await this.db.insert(accounts).values(input).returning();
    return toAccount(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: AccountPatch,
  ): Promise<Account | "version_mismatch" | null> {
    const [row] = await this.db
      .update(accounts)
      .set({ ...patch, version: sql`${accounts.version} + 1`, updatedAt: new Date() })
      .where(and(eq(accounts.userId, userId), eq(accounts.id, id), eq(accounts.version, expectedVersion)))
      .returning();
    if (row) return toAccount(row);
    // Nothing matched: either the account is gone, or somebody else moved the version on.
    return (await this.get(userId, id)) ? "version_mismatch" : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
      .returning({ id: accounts.id });
    return rows.length > 0;
  }

  async latestBalances(userId: string): Promise<Map<string, BalancePoint>> {
    const res = await this.db.execute<{
      account_id: string;
      as_of: string;
      balance: string;
      available: string | null;
      source: string;
      captured_at: string;
    }>(sql`
      SELECT DISTINCT ON (b.account_id) b.account_id, b.as_of::text, b.balance, b.available, b.source, b.captured_at
      FROM account_balances b JOIN accounts a ON a.id = b.account_id
      WHERE a.user_id = ${userId}
      ORDER BY b.account_id, b.as_of DESC, b.captured_at DESC`);
    return new Map(
      res.rows.map((r) => [
        r.account_id,
        {
          accountId: r.account_id,
          asOf: r.as_of,
          balance: r.balance,
          available: r.available,
          source: r.source as BalanceSource,
          capturedAt: new Date(r.captured_at),
        },
      ]),
    );
  }

  async history(userId: string, accountIds: string[], sinceAsOf: string): Promise<BalancePoint[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.db
      .select({
        accountId: accountBalances.accountId,
        asOf: accountBalances.asOf,
        balance: accountBalances.balance,
        available: accountBalances.available,
        source: accountBalances.source,
        capturedAt: accountBalances.capturedAt,
      })
      .from(accountBalances)
      .innerJoin(accounts, eq(accounts.id, accountBalances.accountId))
      .where(
        and(
          eq(accounts.userId, userId),
          inArray(accountBalances.accountId, accountIds),
          gte(accountBalances.asOf, sinceAsOf),
        ),
      )
      .orderBy(asc(accountBalances.asOf));
    return rows.map((r) => ({ ...r, source: r.source as BalanceSource }));
  }

  async recordBalances(rows: NewBalance[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(accountBalances)
      .values(
        rows.map((r) => ({
          accountId: r.accountId,
          asOf: r.asOf,
          balance: r.balance,
          available: r.available,
          source: r.source,
          capturedAt: r.capturedAt ?? new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [accountBalances.accountId, accountBalances.asOf, accountBalances.source],
        set: {
          balance: sql`excluded.balance`,
          available: sql`excluded.available`,
          capturedAt: sql`excluded.captured_at`,
        },
      });
  }

  async hasReferences(_accountId: string): Promise<boolean> {
    // Nothing points at an account yet: budgets (Phase 2) and interest rules
    // (Phase 3) are the consumers that will make this answer meaningful.
    return false;
  }
}
