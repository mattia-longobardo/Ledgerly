import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
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

/** Postgres reports a unique-index violation as pg error code 23505, wrapped by drizzle-orm 0.45 on `.cause`. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { cause?: { code?: string } } | undefined)?.cause?.code === "23505";
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
      const [row] = await this.db.insert(accountGroups).values({ userId, name, sortOrder }).returning();
      return toGroup(row!);
    } catch (err) {
      if (isUniqueViolation(err)) return "duplicate_name";
      throw err;
    }
  }

  async rename(userId: string, id: string, name: string): Promise<AccountGroup | "duplicate_name" | null> {
    try {
      const [row] = await this.db
        .update(accountGroups)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(accountGroups.userId, userId), eq(accountGroups.id, id)))
        .returning();
      return row ? toGroup(row) : null;
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
