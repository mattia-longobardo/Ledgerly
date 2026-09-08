import { sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import type { SourceBalanceSource } from "../application/ports";

async function latestAccountBalance(db: DbClient, userId: string, accountId: string): Promise<string | null> {
  const result = await db.execute<{ balance: string }>(sql`
    SELECT b.balance
    FROM account_balances b
    JOIN accounts a ON a.id = b.account_id
    WHERE a.user_id = ${userId} AND b.account_id = ${accountId}
    ORDER BY b.as_of DESC, b.captured_at DESC, b.id DESC
    LIMIT 1`);
  return result.rows[0]?.balance ?? null;
}

/**
 * Never fabricates a balance: an account with no `account_balances` row, an
 * unlinked fund, or a source owned by another user all resolve to `null` —
 * the caller renders an empty state, never `"0.00"`.
 */
export function drizzleSourceBalanceSource(db: DbClient): SourceBalanceSource {
  return {
    async latestBalance(userId, source) {
      if (source.kind === "account") {
        return latestAccountBalance(db, userId, source.id);
      }
      const result = await db.execute<{ account_id: string | null }>(sql`
        SELECT account_id FROM funds WHERE id = ${source.id} AND user_id = ${userId} LIMIT 1`);
      const accountId = result.rows[0]?.account_id ?? null;
      if (accountId === null) return null;
      return latestAccountBalance(db, userId, accountId);
    },
  };
}
