import { sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { romeDate } from "@/lib/time";
import type { TransactionsScopeSource } from "../application/ports";

type ExpenseRow = Record<string, unknown> & {
  id: string;
  account_id: string;
  category_id: string | null;
  amount: string;
  // Seconds since epoch, not the timestamptz column itself: drizzle's Postgres
  // driver overrides the wire type parser for TIMESTAMPTZ/TIMESTAMP/DATE to
  // return the raw (non-ISO) text Postgres would print, so `new Date(...)` on
  // it is unreliable. `EXTRACT(EPOCH FROM ...)` sidesteps that entirely.
  occurred_at_epoch: string;
  label_ids: (string | null)[];
};

/**
 * A budget scope must see every expense transaction regardless of `state`
 * (pending, cleared, or reconciled) — only `type = 'expense'` is filtered.
 *
 * The bounds are compared on the Europe/Rome civil date, the same date this
 * source renders back out as `occurredAt`, so the two can never disagree.
 * Comparing UTC instants instead would drop the first one or two hours of
 * `from` (Rome is UTC+1/+2, so 00:30 Rome on `from` is 23:30Z the day before)
 * and wrongly pull in the same slice of the day after `to`.
 */
export function drizzleTransactionsScopeSource(db: DbClient): TransactionsScopeSource {
  return {
    async listExpenses(userId, opts) {
      const result = await db.execute<ExpenseRow>(sql`
        SELECT
          t.id,
          t.account_id,
          t.category_id,
          t.amount,
          EXTRACT(EPOCH FROM t.occurred_at) AS occurred_at_epoch,
          COALESCE(array_agg(l.label_id) FILTER (WHERE l.label_id IS NOT NULL), '{}') AS label_ids
        FROM transactions t
        LEFT JOIN transaction_label_links l ON l.transaction_id = t.id
        WHERE t.user_id = ${userId}
          AND t.type = 'expense'
          AND (t.occurred_at AT TIME ZONE 'Europe/Rome')::date >= ${opts.from}::date
          AND (t.occurred_at AT TIME ZONE 'Europe/Rome')::date <= ${opts.to}::date
        GROUP BY t.id
        ORDER BY t.occurred_at, t.id
      `);
      return result.rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        categoryId: row.category_id,
        labelIds: row.label_ids.filter((labelId): labelId is string => labelId !== null),
        type: "expense" as const,
        amount: row.amount,
        occurredAt: romeDate(new Date(Number(row.occurred_at_epoch) * 1000)),
      }));
    },
  };
}
