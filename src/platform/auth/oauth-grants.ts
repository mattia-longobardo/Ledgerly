import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import { API_SCOPES, type ApiScope, redirectHosts } from "./oauth";
import { oauthAccessTokens, oauthClients, oauthConsents, oauthRefreshTokens } from "./oauth/schema";

/**
 * What a person has said yes to on the consent screen, and the way to take it back (PERS-49
 * SEC-05). A grant is a consent row plus the refresh tokens the client got from it; the access
 * tokens are JWTs that are not stored, so a revoked grant keeps working for at most their hour.
 */

/** A client as the consent screen shows it: whose callback hosts, and whether anyone owns it. */
export interface ConsentClient {
  name: string | null;
  hosts: string[];
  /** A client a person made in Settings; a self-registered (DCR) one has no owner. */
  verified: boolean;
}

export async function consentClient(clientId: string): Promise<ConsentClient | null> {
  const [row] = await getDb()
    .select({ name: oauthClients.name, redirectUris: oauthClients.redirectUris, userId: oauthClients.userId })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId));
  if (!row) return null;
  return { name: row.name, hosts: redirectHosts(row.redirectUris), verified: row.userId !== null };
}

export interface ConnectedApp {
  clientId: string;
  name: string;
  hosts: string[];
  verified: boolean;
  scopes: ApiScope[];
  offline: boolean;
  createdAt: Date;
}

/** The person's consents, one per client, oldest first. */
export async function listConnectedApps(ctx: Pick<Ctx, "userId">): Promise<ConnectedApp[]> {
  const rows = await getDb()
    .select({
      clientId: oauthConsents.clientId,
      scopes: oauthConsents.scopes,
      createdAt: oauthConsents.createdAt,
      name: oauthClients.name,
      redirectUris: oauthClients.redirectUris,
      ownerId: oauthClients.userId,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
    .where(userScoped(ctx).owns(oauthConsents))
    .orderBy(asc(oauthConsents.createdAt), asc(oauthConsents.id));
  // One consent per resource is possible: the screen shows one row per client, scopes merged.
  const byClient = new Map<string, { row: (typeof rows)[number]; scopes: Set<string> }>();
  for (const row of rows) {
    const seen = byClient.get(row.clientId);
    if (seen) for (const scope of row.scopes) seen.scopes.add(scope);
    else byClient.set(row.clientId, { row, scopes: new Set(row.scopes) });
  }
  return [...byClient.values()].map(({ row, scopes }) => ({
    clientId: row.clientId,
    name: row.name ?? row.clientId,
    hosts: redirectHosts(row.redirectUris),
    verified: row.ownerId !== null,
    scopes: API_SCOPES.filter((scope) => scopes.has(scope)),
    offline: scopes.has("offline_access"),
    createdAt: row.createdAt,
  }));
}

export class GrantError extends Error {
  constructor(readonly code: "invalid" | "not_found") {
    super(code);
    this.name = "GrantError";
  }
}

/**
 * Takes one consent back: the consent row, so the next authorize asks again, and the client's
 * refresh tokens for this person, so it cannot mint a new access token.
 */
export async function revokeConnectedApp(ctx: Pick<Ctx, "userId">, clientId: string): Promise<void> {
  const parsed = z.string().min(1).max(200).safeParse(clientId);
  if (!parsed.success) throw new GrantError("invalid");
  const scope = userScoped(ctx);
  const deleted = await getDb().transaction(async (tx) => {
    const consents = await tx
      .delete(oauthConsents)
      .where(and(eq(oauthConsents.clientId, parsed.data), scope.owns(oauthConsents)))
      .returning({ id: oauthConsents.id });
    await tx
      .delete(oauthRefreshTokens)
      .where(and(eq(oauthRefreshTokens.clientId, parsed.data), scope.owns(oauthRefreshTokens)));
    await tx
      .delete(oauthAccessTokens)
      .where(and(eq(oauthAccessTokens.clientId, parsed.data), scope.owns(oauthAccessTokens)));
    return consents.length;
  });
  if (deleted === 0) throw new GrantError("not_found");
}

/**
 * Every OAuth token the person holds through a consent, for the moments that end all their
 * sessions: a password reset and a two-factor reset. The consents stay, so the person's apps ask
 * for a new sign-in and not for a new yes. A Client API has no refresh token and is not touched.
 */
export async function revokeUserOAuthTokens(
  userId: string,
  db: Pick<ReturnType<typeof getDb>, "delete"> = getDb(),
): Promise<void> {
  await db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId));
  await db.delete(oauthAccessTokens).where(eq(oauthAccessTokens.userId, userId));
}
