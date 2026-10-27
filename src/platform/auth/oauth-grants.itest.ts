import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";

// Connected apps (PERS-49 SEC-05) against the real database: what the person consented to, the
// revoke that ends it, and the password reset that takes the refresh tokens with the sessions.

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: () => {} }));

const { getAuth, invalidateAuth } = await import("./auth");
const { consentClient, listConnectedApps, revokeConnectedApp, revokeUserOAuthTokens, GrantError } =
  await import("./oauth-grants");
const { oauthClients, oauthConsents, oauthRefreshTokens } = await import("./oauth/schema");

const MCP = "http://127.0.0.1:3000/api/mcp";

async function dcrClient(clientId: string, name = "Claude"): Promise<void> {
  await getDb()
    .insert(oauthClients)
    .values({
      clientId,
      name,
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      tokenEndpointAuthMethod: "none",
      scopes: ["read", "offline_access"],
    });
}

async function grant(userId: string, clientId: string): Promise<void> {
  await getDb()
    .insert(oauthConsents)
    .values({ clientId, userId, resources: [MCP], scopes: ["read", "offline_access"] });
  await getDb()
    .insert(oauthRefreshTokens)
    .values({
      token: `refresh-${clientId}-${userId}`,
      clientId,
      userId,
      resources: [MCP],
      scopes: ["read", "offline_access"],
      expiresAt: new Date(Date.now() + 86_400_000),
    });
}

const refreshTokensOf = (userId: string) =>
  getDb().select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId));

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
});

afterAll(closeDatabase);

describe("connected apps", () => {
  it("shows the consent screen where the code goes and that nobody owns the client", async () => {
    await dcrClient("dcr-1");
    expect(await consentClient("dcr-1")).toEqual({ name: "Claude", hosts: ["claude.ai"], verified: false });
    expect(await consentClient("missing")).toBeNull();
  });

  it("lists the person's consents and revokes one with its refresh tokens, nobody else's", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    await dcrClient("dcr-1");
    await grant(me.id, "dcr-1");
    await grant(other.id, "dcr-1");

    expect(await listConnectedApps({ userId: me.id })).toMatchObject([
      {
        clientId: "dcr-1",
        name: "Claude",
        hosts: ["claude.ai"],
        verified: false,
        scopes: ["read"],
        offline: true,
      },
    ]);

    await revokeConnectedApp({ userId: me.id }, "dcr-1");
    expect(await listConnectedApps({ userId: me.id })).toEqual([]);
    expect(await refreshTokensOf(me.id)).toHaveLength(0);
    expect(await listConnectedApps({ userId: other.id })).toHaveLength(1);
    expect(await refreshTokensOf(other.id)).toHaveLength(1);

    await expect(revokeConnectedApp({ userId: me.id }, "dcr-1")).rejects.toBeInstanceOf(GrantError);
  });

  it("drops the refresh tokens, not the consents, on a password reset", async () => {
    const me = await createTestUser();
    await dcrClient("dcr-1");
    await grant(me.id, "dcr-1");
    const onPasswordReset = (await getAuth()).options.emailAndPassword?.onPasswordReset;
    expect(onPasswordReset).toBeTypeOf("function");
    await onPasswordReset!({ user: { id: me.id } as never });
    expect(await refreshTokensOf(me.id)).toHaveLength(0);
    expect(await listConnectedApps({ userId: me.id })).toHaveLength(1);

    await grant(me.id, "dcr-1");
    await revokeUserOAuthTokens(me.id);
    expect(await refreshTokensOf(me.id)).toHaveLength(0);
  });
});
