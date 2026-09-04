import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import type { DbClient } from "@/lib/db/client";
import type { AccountBalanceLookup } from "../application/ports";

/** `latestBalancesBefore` is exclusive of its bound, so `asOf` is included by asking for the day after it. */
function dayAfter(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Reuses `DrizzleAccountsRepository.latestBalancesBefore`, which already
 * filters explicitly by `accounts.user_id` via a join to `account_balances`
 * (that table, like `interest_accruals`, owns its user only indirectly).
 */
export function drizzleAccountBalanceLookup(db: DbClient): AccountBalanceLookup {
  return {
    async latestBalanceAsOf(userId, accountId, asOf) {
      const repo = new DrizzleAccountsRepository(db);
      const map = await repo.latestBalancesBefore(userId, [accountId], dayAfter(asOf));
      return map.get(accountId)?.balance ?? null;
    },
  };
}
