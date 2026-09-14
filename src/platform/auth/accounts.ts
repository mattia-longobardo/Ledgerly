import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import { OIDC_PROVIDER_ID } from "./provider";
import { authAccounts } from "./schema";

/** Better Auth's provider id for an email + password account. */
const PASSWORD_PROVIDER_ID = "credential";

async function hasAccount(userId: string, providerId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, providerId)))
    .limit(1);
  return row !== undefined;
}

/** Whether the user signs in with Authentik, which then manages their name and email (spec §5.1). */
export function hasSsoAccount(userId: string): Promise<boolean> {
  return hasAccount(userId, OIDC_PROVIDER_ID);
}

/** Whether the user has a password to sign in with, change or reset. */
export function hasPasswordAccount(userId: string): Promise<boolean> {
  return hasAccount(userId, PASSWORD_PROVIDER_ID);
}
