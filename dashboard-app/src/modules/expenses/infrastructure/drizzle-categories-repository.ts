import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionCategories, type TransactionCategoryRow } from "@/lib/db/schema";
import type { CategoriesRepository, NewCategory } from "../application/ports";
import type { TransactionCategory } from "../domain/transaction";

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

  async create(input: NewCategory): Promise<TransactionCategory> {
    const [row] = await this.db.insert(transactionCategories).values(input).returning();
    return toCategory(row!);
  }
}
