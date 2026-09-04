import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionLabels, type TransactionLabelRow } from "@/lib/db/schema";
import type { LabelsRepository, NewLabel } from "../application/ports";
import type { TransactionLabel } from "../domain/transaction";

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

  async create(input: NewLabel): Promise<TransactionLabel> {
    const [row] = await this.db.insert(transactionLabels).values(input).returning();
    return toLabel(row!);
  }
}
