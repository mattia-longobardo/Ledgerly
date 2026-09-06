import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { accounts, funds } from "@/lib/db/schema";
import type { OwnershipCheck } from "../application/ports";

export function drizzleOwnershipCheck(db: DbClient): OwnershipCheck {
  return {
    async accountExists(userId, id) {
      const [row] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.id, id))).limit(1);
      return row !== undefined;
    },

    async fundExists(userId, id) {
      const [row] = await db.select({ id: funds.id }).from(funds).where(and(eq(funds.userId, userId), eq(funds.id, id))).limit(1);
      return row !== undefined;
    },
  };
}
