import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import type { AccountLinkSource } from "../application/ports";

export function drizzleAccountLinkSource(db: DbClient): AccountLinkSource {
  return {
    async get(userId, accountId) {
      const [row] = await db
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
        .limit(1);
      return row ?? null;
    },
  };
}
