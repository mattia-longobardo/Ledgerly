import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionLabels, type TransactionLabelRow } from "@/lib/db/schema";
import type { LabelsRepository, NewLabel } from "../application/ports";
import type { TransactionLabel } from "../domain/transaction";

/** Postgres reports a unique-index violation as pg error code 23505, wrapped by drizzle-orm 0.45 on `.cause`. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { cause?: { code?: string } } | undefined)?.cause?.code === "23505";
}

function toLabel(row: TransactionLabelRow): TransactionLabel {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    color: row.color,
    source: row.source as TransactionLabel["source"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed labels store. Every method assumes the client is a
 * transaction carrying the caller's RLS context (see `withUserContext`); the
 * explicit `user_id` predicates hold even under the system context, where
 * RLS lets everything through.
 */
export class DrizzleLabelsRepository implements LabelsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<TransactionLabel[]> {
    const rows = await this.db
      .select()
      .from(transactionLabels)
      .where(eq(transactionLabels.userId, userId))
      .orderBy(asc(transactionLabels.name));
    return rows.map(toLabel);
  }

  async findByName(userId: string, name: string): Promise<TransactionLabel | null> {
    const [row] = await this.db
      .select()
      .from(transactionLabels)
      .where(and(eq(transactionLabels.userId, userId), eq(transactionLabels.name, name)))
      .limit(1);
    return row ? toLabel(row) : null;
  }

  async create(input: NewLabel): Promise<TransactionLabel | "duplicate_name"> {
    try {
      // Runs in a nested transaction (a Postgres SAVEPOINT under drizzle-orm
      // 0.45's node-postgres session) so that a caught unique-violation rolls
      // back only this statement: without the savepoint, the surrounding
      // withUserContext transaction would be left aborted and every later
      // query on it would fail with "current transaction is aborted".
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(transactionLabels).values(input).returning();
        return toLabel(row!);
      });
    } catch (err) {
      if (isUniqueViolation(err)) return "duplicate_name";
      throw err;
    }
  }
}
