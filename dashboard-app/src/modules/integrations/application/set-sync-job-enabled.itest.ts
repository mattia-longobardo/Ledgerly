/**
 * The per-kind sync toggle (Phase 9), through the API against real Postgres.
 *
 * The `sync_jobs` rows it flips are created by `connectIntegration`, so the test
 * connects a real (fake-adapter) provider first: proving the toggle without
 * that would prove nothing about the "not connected → 422" rule, which is the
 * one the plan calls out.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { integrationConnections, organizations, syncJobs, users } from "@/lib/db/schema";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { withSystemContext } from "@/platform/db/context";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { resetCredentialCipher } from "@/platform/integrations/crypto";
import { registerProvider, resetProviderRegistry } from "@/platform/integrations/registry";
import type { IntegrationProvider } from "@/platform/integrations/types";
import { hmacSignatureVerifier } from "@/platform/integrations/webhook-signature";
import { closeDb, resetDb, testDb } from "@/test/db";

function fakeProvider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {
      accounts: { schedule: "daily", fetch: async () => ["one"], apply: async () => ({ created: 1 }) },
    },
    webhook: {
      verify: hmacSignatureVerifier(),
      toSyncRequests: () => [{ kind: "accounts", event: "accounts.changed" }],
    },
    onDisconnect: async () => {},
  };
}

describe("setSyncJobEnabled", () => {
  beforeEach(async () => {
    await resetDb();
    resetProviderRegistry();
    resetCredentialCipher();
    registerProvider(fakeProvider());
  });
  afterAll(async () => {
    resetProviderRegistry();
    await closeDb();
  });

  async function seed() {
    const db = await testDb();
    const [organization] = await db.insert(organizations).values({ name: "Household" }).returning();
    const [userA] = await db.insert(users).values({ organizationId: organization!.id, displayName: "A" }).returning();
    const deps: ApiDeps = {
      db,
      authenticate: async (request: Request) => {
        const userId = request.headers.get("x-test-user");
        if (!userId) return null;
        const roles = [(request.headers.get("x-test-role") ?? "owner") as RoleCode];
        const principal: Principal = {
          userId,
          organizationId: organization!.id,
          roles,
          permissions: permissionsForRoles(roles),
        };
        return { principal, method: "session" as const };
      },
      now: () => new Date("2026-09-08T10:00:00.000Z"),
      rateLimitEnabled: false,
    };
    return { app: createApiApp(deps), db, userA: userA! };
  }

  function headers(userId: string, extra: Record<string, string> = {}) {
    return { "content-type": "application/json", "x-test-user": userId, "x-requested-with": "fetch", ...extra };
  }

  function connect(app: ReturnType<typeof createApiApp>, userId: string) {
    return app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userId),
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
  }

  function toggle(app: ReturnType<typeof createApiApp>, userId: string, enabled: boolean, kind = "accounts", extra = {}) {
    return app.request(`/api/v1/integrations/wallet/sync-jobs/${kind}`, {
      method: "PATCH",
      headers: headers(userId, extra),
      body: JSON.stringify({ enabled }),
    });
  }

  it("switches a kind off and back on without touching the connection", async () => {
    const { app, db, userA } = await seed();
    expect((await connect(app, userA.id)).status).toBe(200);

    const off = await toggle(app, userA.id, false);
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ kind: "accounts", schedule: "daily", enabled: false });

    const rows = await withSystemContext(db, (tx) => tx.select().from(syncJobs));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);

    // The connection itself is untouched — that is the point of a per-kind switch.
    const connections = await withSystemContext(db, (tx) =>
      tx.select().from(integrationConnections).where(eq(integrationConnections.userId, userA.id)),
    );
    expect(connections[0]!.status).toBe("connected");

    // Idempotent: setting it to what it already is is a no-op that still answers 200.
    expect((await toggle(app, userA.id, false)).status).toBe(200);

    const on = await toggle(app, userA.id, true);
    expect((await on.json()).enabled).toBe(true);
  });

  it("refuses a provider that is not connected, and an unknown kind", async () => {
    const { app, userA } = await seed();

    const disconnected = await toggle(app, userA.id, false);
    expect(disconnected.status).toBe(422);
    const body = await disconnected.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toMatch(/not connected/);

    expect((await connect(app, userA.id)).status).toBe(200);
    const unknownKind = await toggle(app, userA.id, false, "leave");
    expect(unknownKind.status).toBe(422);
    expect((await unknownKind.json()).error.message).toMatch(/no "leave" sync/);

    const unknownProvider = await app.request("/api/v1/integrations/nope/sync-jobs/accounts", {
      method: "PATCH",
      headers: headers(userA.id),
      body: JSON.stringify({ enabled: false }),
    });
    expect(unknownProvider.status).toBe(404);
  });

  it("needs integrations.manage, and never reaches another user's connection", async () => {
    const { app, db, userA } = await seed();
    expect((await connect(app, userA.id)).status).toBe(200);
    const [userB] = await db
      .insert(users)
      .values({ organizationId: userA.organizationId, displayName: "B" })
      .returning();

    const viewer = await toggle(app, userA.id, false, "accounts", { "x-test-role": "viewer" });
    expect(viewer.status).toBe(403);
    expect((await viewer.json()).error.code).toBe("permission_denied");

    // B has no wallet connection of their own; A's is invisible to them.
    const other = await toggle(app, userB!.id, false);
    expect(other.status).toBe(422);

    const rows = await withSystemContext(db, (tx) => tx.select().from(syncJobs));
    expect(rows[0]!.enabled).toBe(true);
  });
});
