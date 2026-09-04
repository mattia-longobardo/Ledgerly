import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb, resetDb, testDb } from "@/test/db";
import { testPrincipal } from "@/test/principal";
import { organizations, users } from "@/lib/db/schema";
import { registerProvider, resetProviderRegistry } from "@/platform/integrations/registry";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";
import type { IntegrationProvider } from "@/platform/integrations/types";
import { importFileCredentials } from "./import-file-credentials";

/**
 * The unit test in `import-file-credentials.test.ts` runs on
 * `testIntegrationDeps()`, whose `inUserContext` is a no-op `(_, fn) =>
 * fn(deps)` — it cannot tell the difference between a query that resolves RLS
 * correctly and one that is RLS-blind, because there is no RLS in play at all.
 *
 * This suite runs against the real Postgres and its `FORCE ROW LEVEL
 * SECURITY` policy on `integration_connections`, which is the only way to
 * catch a call made on the bare pool (no `app.user_id` set) instead of inside
 * `deps.inUserContext(...)`.
 */
function walletProvider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "Token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {},
    onDisconnect: async () => {},
  };
}

describe("importFileCredentials (real database)", () => {
  beforeEach(async () => {
    await resetDb();
    resetProviderRegistry();
    registerProvider(walletProvider());
  });
  afterAll(closeDb);

  it("skips a provider already connected, without touching its stored credential", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Acme" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const principal = testPrincipal({ userId: user!.id, organizationId: org!.id });
    const deps = integrationDeps(db);

    const first = await importFileCredentials(deps)(principal, { wallet: { token: "first-token" } });
    expect(first.imported).toEqual(["wallet"]);

    const second = await importFileCredentials(deps)(principal, { wallet: { token: "rotated-token" } });
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual([
      { provider: "wallet", reason: "already_connected" },
      { provider: "trek", reason: "no_file" },
    ]);

    const connection = await deps.inUserContext(principal.userId, (d) =>
      d.connections.getByProvider(principal.userId, "wallet"),
    );
    const sealed = await deps.inUserContext(principal.userId, (d) =>
      d.connections.readCredentials(principal.userId, connection!.id),
    );
    expect(deps.cipher.open(sealed!)).toEqual({ token: "first-token" });
  });
});
