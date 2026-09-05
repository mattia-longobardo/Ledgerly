import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { transactionLabelLinks, transactionLabels, transactions, type TransactionRow } from "@/lib/db/schema";
import { InvalidInputError } from "../application/errors";
import type {
  ListTransactionsOptions,
  ListTransactionsPage,
  NewTransaction,
  TransactionPatch,
  TransactionsRepository,
} from "../application/ports";
import type { Transaction } from "../domain/transaction";

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    occurredAt: row.occurredAt,
    bookedAt: row.bookedAt,
    amount: row.amount,
    currency: row.currency,
    type: row.type as Transaction["type"],
    state: row.state as Transaction["state"],
    categoryId: row.categoryId,
    payee: row.payee,
    note: row.note,
    transferGroupId: row.transferGroupId,
    source: row.source as Transaction["source"],
    syncRunId: row.syncRunId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed transactions store. Every method assumes the client is a
 * transaction carrying the caller's RLS context (see `withUserContext`); the
 * explicit `user_id` predicates hold even under the system context, where
 * RLS lets everything through, and keep a caller that forgot to open a user
 * context from silently reading zero rows off a pool-bound client instead of
 * failing loudly.
 */
export class DrizzleTransactionsRepository implements TransactionsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts: ListTransactionsOptions): Promise<ListTransactionsPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conditions = [eq(transactions.userId, userId)];
    if (opts.accountId) conditions.push(eq(transactions.accountId, opts.accountId));
    if (opts.categoryId) conditions.push(eq(transactions.categoryId, opts.categoryId));
    if (opts.type) conditions.push(eq(transactions.type, opts.type));
    if (opts.from) conditions.push(gte(transactions.occurredAt, new Date(opts.from)));
    if (opts.to) conditions.push(lt(transactions.occurredAt, new Date(opts.to)));
    if (opts.labelId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM transaction_label_links l WHERE l.transaction_id = ${transactions.id} AND l.label_id = ${opts.labelId})`,
      );
    }
    if (opts.cursor) {
      const [anchor] = await this.db
        .select({ occurredAt: transactions.occurredAt, id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.id, opts.cursor)))
        .limit(1);
      if (anchor) {
        conditions.push(sql`(${transactions.occurredAt}, ${transactions.id}) < (${anchor.occurredAt}, ${anchor.id})`);
      }
    }
    const rows = await this.db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toTransaction);
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    const labelsByTransaction = await this.labelsFor(
      userId,
      items.map((t) => t.id),
    );
    return { items, labelsByTransaction, nextCursor };
  }

  async get(userId: string, id: string): Promise<Transaction | null> {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
      .limit(1);
    return row ? toTransaction(row) : null;
  }

  async create(input: NewTransaction): Promise<Transaction> {
    const [row] = await this.db.insert(transactions).values(input).returning();
    return toTransaction(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: TransactionPatch,
  ): Promise<Transaction | "version_mismatch" | null> {
    const [row] = await this.db
      .update(transactions)
      .set({ ...patch, version: sql`${transactions.version} + 1`, updatedAt: new Date() })
      .where(and(eq(transactions.userId, userId), eq(transactions.id, id), eq(transactions.version, expectedVersion)))
      .returning();
    if (row) return toTransaction(row);
    const existing = await this.get(userId, id);
    return existing === null ? null : "version_mismatch";
  }

  async setLabels(userId: string, id: string, labelIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
        .limit(1);
      if (!owned) return;
      if (labelIds.length > 0) {
        // FK checks are not subject to RLS, so `transaction_label_links`'s FK
        // to `transaction_labels` alone would happily accept another user's
        // label id. Verify ownership explicitly before writing anything —
        // the whole call is refused rather than silently dropping the
        // offending id, so a caller that built a bad request finds out.
        const ownedLabels = await tx
          .select({ id: transactionLabels.id })
          .from(transactionLabels)
          .where(and(eq(transactionLabels.userId, userId), inArray(transactionLabels.id, labelIds)));
        if (ownedLabels.length !== new Set(labelIds).size) {
          throw new InvalidInputError("labelIds must belong to the caller");
        }
      }
      await tx.delete(transactionLabelLinks).where(eq(transactionLabelLinks.transactionId, id));
      if (labelIds.length > 0) {
        await tx.insert(transactionLabelLinks).values(labelIds.map((labelId) => ({ transactionId: id, labelId })));
      }
    });
  }

  async labelsFor(userId: string, ids: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const id of ids) map.set(id, []);
    if (ids.length === 0) return map;
    // Joins back to `transactions` to filter by userId explicitly, rather
    // than leaning on the `transaction_label_links` RLS policy alone — this
    // method's only call site (`list()`) already scopes `ids` to the caller,
    // but the port takes a `userId` and a system-context caller with an
    // unscoped id list must not see another user's labels.
    const rows = await this.db
      .select({ transactionId: transactionLabelLinks.transactionId, labelId: transactionLabelLinks.labelId })
      .from(transactionLabelLinks)
      .innerJoin(transactions, eq(transactions.id, transactionLabelLinks.transactionId))
      .where(and(eq(transactions.userId, userId), inArray(transactionLabelLinks.transactionId, ids)));
    for (const r of rows) map.get(r.transactionId)?.push(r.labelId);
    return map;
  }

  async listAll(userId: string): Promise<Transaction[]> {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id));
    return rows.map(toTransaction);
  }
}
