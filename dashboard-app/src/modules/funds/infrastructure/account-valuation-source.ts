import { sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import type { ValuationSource } from "../application/ports";

/** Account-valued fund history, always scoped through the account owner. */
export function drizzleAccountValuationSource(db: DbClient): ValuationSource {
  return {
    async latest(userId, accountId) {
      const result = await db.execute<{ as_of: string; balance: string }>(sql`
        SELECT b.as_of::text AS as_of, b.balance
        FROM account_balances b
        JOIN accounts a ON a.id = b.account_id
        WHERE a.user_id = ${userId} AND b.account_id = ${accountId}
        ORDER BY b.as_of DESC, b.captured_at DESC, b.id DESC
        LIMIT 1`);
      const row = result.rows[0];
      return row ? { asOf: row.as_of, balance: row.balance } : null;
    },

    async monthly(userId, accountId) {
      const result = await db.execute<{ month: string; balance: string }>(sql`
        SELECT DISTINCT ON (date_trunc('month', b.as_of))
          date_trunc('month', b.as_of)::date::text AS month,
          b.balance
        FROM account_balances b
        JOIN accounts a ON a.id = b.account_id
        WHERE a.user_id = ${userId} AND b.account_id = ${accountId}
        ORDER BY date_trunc('month', b.as_of), b.as_of DESC, b.captured_at DESC, b.id DESC`);
      return result.rows;
    },
  };
}
