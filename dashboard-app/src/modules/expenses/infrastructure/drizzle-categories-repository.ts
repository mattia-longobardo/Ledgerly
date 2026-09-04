import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionCategories, type TransactionCategoryRow } from "@/lib/db/schema";
import type { CategoriesRepository, NewCategory } from "../application/ports";
import type { TransactionCategory } from "../domain/transaction";

/** Postgres reports a unique-index violation as pg error code 23505, wrapped by drizzle-orm 0.45 on `.cause`. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { cause?: { code?: string } } | undefined)?.cause?.code === "23505";
}

function toCategory(row: TransactionCategoryRow): TransactionCategory {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    groupName: row.groupName,
    kind: row.kind as TransactionCategory["kind"],
    color: row.color,
    parentId: row.parentId,
    source: row.source as TransactionCategory["source"],
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed categories store. Every method assumes the client is a
 * transaction carrying the caller's RLS context (see `withUserContext`); the
 * explicit `user_id` predicates hold even under the system context, where
 * RLS lets everything through.
 */
export class DrizzleCategoriesRepository implements CategoriesRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts?: { includeArchived?: boolean }): Promise<TransactionCategory[]> {
    const conditions = [eq(transactionCategories.userId, userId)];
    if (!opts?.includeArchived) conditions.push(isNull(transactionCategories.archivedAt));
    const rows = await this.db
      .select()
      .from(transactionCategories)
      .where(and(...conditions))
      .orderBy(asc(transactionCategories.name));
    return rows.map(toCategory);
  }

  async get(userId: string, id: string): Promise<TransactionCategory | null> {
    const [row] = await this.db
      .select()
      .from(transactionCategories)
      .where(and(eq(transactionCategories.userId, userId), eq(transactionCategories.id, id)))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findByName(userId: string, name: string): Promise<TransactionCategory | null> {
    const [row] = await this.db
      .select()
      .from(transactionCategories)
      .where(and(eq(transactionCategories.userId, userId), eq(transactionCategories.name, name)))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async create(input: NewCategory): Promise<TransactionCategory | "duplicate_name"> {
    try {
      // Runs in a nested transaction (a Postgres SAVEPOINT under drizzle-orm
      // 0.45's node-postgres session) so that a caught unique-violation rolls
      // back only this statement: without the savepoint, the surrounding
      // withUserContext transaction would be left aborted and every later
      // query on it would fail with "current transaction is aborted".
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(transactionCategories).values(input).returning();
        return toCategory(row!);
      });
    } catch (err) {
      if (isUniqueViolation(err)) return "duplicate_name";
      throw err;
    }
  }
}
