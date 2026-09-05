import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, users } from "@/lib/db/schema";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { registerProvider, resetProviderRegistry } from "@/platform/integrations/registry";
import { resetCredentialCipher } from "@/platform/integrations/crypto";
import { ITEST_ENCRYPTION_KEY } from "@/test/integration-setup";
import { z } from "zod";
import type { IntegrationProvider } from "@/platform/integrations/types";
import {
  ConnectionSchema,
  IntegrationListResponseSchema,
  SyncRunSchema,
  SyncRunsPageSchema,
  TestResultSchema,
} from "./schemas";
import { ErrorResponseSchema } from "@/modules/accounts/api/schemas";

const KEY = `k1:${Buffer.alloc(32, 3).toString("base64")}`;

function fakeProvider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async (credentials) =>
      credentials.token === "good"
        ? { ok: true, message: "Reached the provider." }
        : { ok: false, message: "Refused." },
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: async () => ["one"],
        apply: async () => ({ created: 1 }),
      },
    },
    onDisconnect: async () => {},
  };
}

describe("integration routes", () => {
  beforeEach(async () => {
    await resetDb();
    resetProviderRegistry();
    // The suite's own key comes from `src/test/integration-setup.ts`; this file
    // uses a different one to prove the cipher really is re-read, so the cache
    // has to be dropped first.
    resetCredentialCipher();
    process.env.APP_ENCRYPTION_KEY = KEY;
    registerProvider(fakeProvider());
  });
  afterAll(async () => {
    process.env.APP_ENCRYPTION_KEY = ITEST_ENCRYPTION_KEY;
    resetCredentialCipher();
    await closeDb();
  });

  async function seed() {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Acme" }).returning();
    const [userA] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const deps: ApiDeps = {
      db,
      authenticate: async (req: Request) => {
        const id = req.headers.get("x-test-user");
        if (!id) return null;
        const roles = [(req.headers.get("x-test-role") ?? "owner") as RoleCode];
        const principal: Principal = {
          userId: id,
          organizationId: org!.id,
          roles,
          permissions: permissionsForRoles(roles),
        };
        return { principal, method: "session" as const };
      },
      now: () => new Date("2026-09-04T09:00:00Z"),
      rateLimitEnabled: false,
    };
    return { app: createApiApp(deps), userA: userA! };
  }

  function headers(userId: string, extra: Record<string, string> = {}) {
    return { "content-type": "application/json", "x-test-user": userId, "x-requested-with": "fetch", ...extra };
  }

  it("lists, connects, tests, syncs, lists runs and disconnects", async () => {
    const { app, userA } = await seed();
    const h = headers(userA.id);

    const before = await app.request("/api/v1/integrations", { headers: h });
    expect(before.status).toBe(200);
    const beforeBody = await before.json();
    expect(IntegrationListResponseSchema.parse(beforeBody)).toBeTruthy();
    expect(beforeBody.items[0].connection).toBeNull();

    const connect = await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(connect.status).toBe(200);
    const connected = await connect.json();
    expect(ConnectionSchema.parse(connected.connection)).toBeTruthy();
    expect(connected.connection.status).toBe("connected");
    // The response must never carry the credential back.
    expect(JSON.stringify(connected)).not.toContain("good");

    const test = await app.request("/api/v1/integrations/wallet/test", { method: "POST", headers: h });
    expect(test.status).toBe(200);
    expect(TestResultSchema.parse(await test.json())).toBeTruthy();

    const sync = await app.request("/api/v1/integrations/wallet/sync", {
      method: "POST",
      headers: h,
      body: JSON.stringify({}),
    });
    expect(sync.status).toBe(200);
    const syncBody = await sync.json();
    expect(SyncRunSchema.parse(syncBody.run)).toBeTruthy();
    expect(syncBody.run.status).toBe("success");
    expect(syncBody.run.stats).toEqual({ created: 1 });

    const runs = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: h });
    expect(runs.status).toBe(200);
    const runsBody = await runs.json();
    expect(SyncRunsPageSchema.parse(runsBody)).toBeTruthy();
    expect(runsBody.items).toHaveLength(1);

    const disconnect = await app.request("/api/v1/integrations/wallet/disconnect", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ policy: "keep" }),
    });
    expect(disconnect.status).toBe(200);
    expect(await disconnect.json()).toEqual({ policy: "keep" });
  });

  it("refuses an unknown provider, a viewer's write and a cookie write without X-Requested-With", async () => {
    const { app, userA } = await seed();

    const unknown = await app.request("/api/v1/integrations/nope/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(unknown.status).toBe(404);
    expect(ErrorResponseSchema.parse(await unknown.json())).toBeTruthy();

    const viewer = await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id, { "x-test-role": "viewer" }),
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(viewer.status).toBe(403);

    const noCsrf = await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": userA.id },
      body: JSON.stringify({ credentials: { token: "good" } }),
    });
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error.code).toBe("csrf_required");
  });

  it("refuses a sync for a provider that was never connected", async () => {
    const { app, userA } = await seed();
    const res = await app.request("/api/v1/integrations/wallet/sync", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });

  it("accepts a sync-runs limit of 1-10, defaults to 10, and rejects anything else with 422", async () => {
    const { app, userA } = await seed();
    const h = headers(userA.id);

    const defaulted = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: h });
    expect(defaulted.status).toBe(200);
    expect(SyncRunsPageSchema.parse(await defaulted.json())).toBeTruthy();

    const lowerBound = await app.request("/api/v1/integrations/wallet/sync-runs?limit=1", { headers: h });
    expect(lowerBound.status).toBe(200);

    const upperBound = await app.request("/api/v1/integrations/wallet/sync-runs?limit=10", { headers: h });
    expect(upperBound.status).toBe(200);

    const tooHigh = await app.request("/api/v1/integrations/wallet/sync-runs?limit=11", { headers: h });
    expect(tooHigh.status).toBe(422);
    expect((await tooHigh.json()).error.code).toBe("validation_failed");

    const tooLow = await app.request("/api/v1/integrations/wallet/sync-runs?limit=0", { headers: h });
    expect(tooLow.status).toBe(422);
    expect((await tooLow.json()).error.code).toBe("validation_failed");

    const notAnInteger = await app.request("/api/v1/integrations/wallet/sync-runs?limit=abc", { headers: h });
    expect(notAnInteger.status).toBe(422);
    expect((await notAnInteger.json()).error.code).toBe("validation_failed");
  });
});
