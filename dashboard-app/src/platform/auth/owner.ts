import { and, asc, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { userRoles, users } from "@/lib/db/schema";

/**
 * The oldest active owner; there is only ever one in practice.
 *
 * Lifted out of `wallet-accounts-sync.ts` because three jobs now need it. It
 * queries `users`/`user_roles`, which carry no RLS, so it is safe on the bare
 * pool — and must be, since it runs before any user context exists.
 */
export async function ownerUserId(db: DbClient): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, "owner"), eq(users.status, "active")))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return row?.id ?? null;
}
