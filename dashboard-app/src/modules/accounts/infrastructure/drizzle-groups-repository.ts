import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { accountGroups, type AccountGroupRow } from "@/lib/db/schema";
import type { AccountGroup } from "../domain/account";
import type { GroupsRepository } from "../application/ports";

function toGroup(row: AccountGroupRow): AccountGroup {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed account groups. Like the accounts repository, it expects a
 * client already inside `withUserContext`, so RLS scopes every statement to
 * the caller on top of the explicit predicates below.
 */
export class DrizzleGroupsRepository implements GroupsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<AccountGroup[]> {
    const rows = await this.db
      .select()
      .from(accountGroups)
      .where(eq(accountGroups.userId, userId))
      .orderBy(asc(accountGroups.sortOrder), asc(accountGroups.name));
    return rows.map(toGroup);
  }

  async get(userId: string, id: string): Promise<AccountGroup | null> {
    const [row] = await this.db
      .select()
      .from(accountGroups)
      .where(and(eq(accountGroups.userId, userId), eq(accountGroups.id, id)))
      .limit(1);
    return row ? toGroup(row) : null;
  }

  async create(userId: string, name: string, sortOrder = 0): Promise<AccountGroup | "duplicate_name"> {
    try {
      // Runs in a nested transaction (a Postgres SAVEPOINT under drizzle-orm
      // 0.45's node-postgres session) so that a caught unique-violation rolls
      // back only this statement: without the savepoint, the surrounding
      // withUserContext transaction would be left aborted and every later
      // query on it would fail with "current transaction is aborted".
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(accountGroups).values({ userId, name, sortOrder }).returning();
        return toGroup(row!);
      });
    } catch (err) {
      if (isUniqueViolation(err)) return "duplicate_name";
      throw err;
    }
  }

  async rename(userId: string, id: string, name: string): Promise<AccountGroup | "duplicate_name" | null> {
    try {
      // Same savepoint reasoning as create() above.
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(accountGroups)
          .set({ name, updatedAt: new Date() })
          .where(and(eq(accountGroups.userId, userId), eq(accountGroups.id, id)))
          .returning();
        return row ? toGroup(row) : null;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return "duplicate_name";
      throw err;
    }
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(accountGroups)
      .where(and(eq(accountGroups.userId, userId), eq(accountGroups.id, id)))
      .returning({ id: accountGroups.id });
    return rows.length > 0;
  }
}
