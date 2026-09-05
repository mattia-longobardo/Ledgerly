import { DrizzleAccountsRepository } from "@/modules/accounts/infrastructure/drizzle-accounts-repository";
import type { DbClient } from "@/lib/db/client";
import type { AccountOwnershipCheck } from "../application/ports";

/**
 * Ruling P3-C42 (B7). `DrizzleAccountsRepository.get` already scopes by
 * `userId` (an explicit predicate, matching `DrizzleAccountsRepository`'s own
 * defense-in-depth precedent) — reused here rather than duplicating that
 * query, the same way `account-balance-lookup.ts` reuses
 * `latestBalancesBefore`.
 */
export function drizzleAccountOwnershipCheck(db: DbClient): AccountOwnershipCheck {
  return {
    async ownedByUser(userId, accountId) {
      const repo = new DrizzleAccountsRepository(db);
      return (await repo.get(userId, accountId)) !== null;
    },
  };
}
