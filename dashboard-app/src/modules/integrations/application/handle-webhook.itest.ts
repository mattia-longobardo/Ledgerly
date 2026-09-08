/**
 * The two inbound guards of Ruling R9-6 — replay protection and the
 * per-connection rate limit — against real Postgres.
 *
 * They live in an itest rather than beside the unit tests in
 * `handle-webhook.test.ts` because both are database facts: the replay lookup
 * reads `webhook_deliveries` back through the same system context that wrote
 * it, and the limiter writes `rate_limit_windows`, a FORCE ROW LEVEL SECURITY
 * table keyed by a uuid that here is a *connection* id rather than a user id
 * (Ruling P9-1). A memory repository proves neither.
 */

import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { integrationConnections, organizations, rateLimitWindows, syncRuns, users, webhookDeliveries } from "@/lib/db/schema";
import { withSystemContext } from "@/platform/db/context";
import { resetCredentialCipher } from "@/platform/integrations/crypto";
import { registerProvider, resetProviderRegistry } from "@/platform/integrations/registry";
import type { IntegrationProvider } from "@/platform/integrations/types";
import { hmacSignatureVerifier } from "@/platform/integrations/webhook-signature";
import { permissionsForRoles } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { closeDb, resetDb, testDb } from "@/test/db";
import { integrationDeps } from "../infrastructure/deps";
import { connectIntegration } from "./connect-integration";
import { INBOUND_LIMIT_PER_MINUTE, handleWebhook } from "./handle-webhook";

const SECRET = "hook-secret";
/** A second connection's secret. Different key, same body, therefore the same payload hash. */
const OTHER_SECRET = "other-hook-secret";
const BODY = '{"event":"accounts.changed"}';

/**
 * Pinned so the one-minute window cannot roll over mid-test: 61 deliveries take
 * milliseconds, but a run that started at :59.99 would otherwise count the last
 * few against a fresh window and never trip the limit.
 */
const NOW = new Date("2026-09-04T09:00:30.000Z");

function fakeProvider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1), webhookSecret: z.string().optional().default("") }),
    credentialFields: [
      { name: "token", label: "API token", secret: true },
      { name: "webhookSecret", label: "Webhook secret", secret: true },
    ],
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

function signed(body: string, secret = SECRET): Headers {
  return new Headers({ "x-signature": `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}` });
}

describe("handleWebhook (inbound hardening)", () => {
  beforeEach(async () => {
    await resetDb();
    resetProviderRegistry();
    resetCredentialCipher();
    registerProvider(fakeProvider());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    resetProviderRegistry();
    await closeDb();
  });

  type Db = Awaited<ReturnType<typeof testDb>>;

  /** One organization, one wallet connection per user, each with its own webhook secret. */
  async function connectUser(db: Db, organizationId: string, name: string, secret: string): Promise<string> {
    const [user] = await db.insert(users).values({ organizationId, displayName: name }).returning();
    const principal: Principal = {
      userId: user!.id,
      organizationId,
      roles: ["owner"],
      permissions: permissionsForRoles(["owner"]),
    };
    await connectIntegration(integrationDeps(db))(principal, {
      provider: "wallet",
      credentials: { token: "good", webhookSecret: secret },
    });
    // `integration_connections` is FORCE RLS: on the bare pool this read
    // returns zero rows rather than an error.
    const [connection] = await withSystemContext(db, (tx) =>
      tx.select().from(integrationConnections).where(eq(integrationConnections.userId, user!.id)),
    );
    return connection!.id;
  }

  async function seed() {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Acme" }).returning();
    const connectionId = await connectUser(db, org!.id, "A", SECRET);
    return { db, deps: integrationDeps(db), organizationId: org!.id, connectionId };
  }

  it("acknowledges a replayed body with the same 202 and queues nothing", async () => {
    const { db, deps, connectionId } = await seed();

    const first = await handleWebhook(deps)({ provider: "wallet", rawBody: BODY, headers: signed(BODY) });
    expect(first.status).toBe("accepted");
    expect(first.runIds).toHaveLength(1);

    const replay = await handleWebhook(deps)({ provider: "wallet", rawBody: BODY, headers: signed(BODY) });
    expect(replay.status).toBe("duplicate");
    // Still a 202-worthy answer: a provider retrying a delivery it never got an
    // answer for must not be told "error".
    expect(replay.accepted).toBe(true);
    expect(replay.runIds).toEqual([]);
    expect(replay.connectionId).toBe(connectionId);

    // The whole point: one event, one queued sync.
    const runs = await withSystemContext(db, (tx) => tx.select().from(syncRuns));
    expect(runs).toHaveLength(1);

    // A different body is not a replay.
    const other = '{"event":"accounts.changed","seq":2}';
    const fresh = await handleWebhook(deps)({ provider: "wallet", rawBody: other, headers: signed(other) });
    expect(fresh.status).toBe("accepted");
    expect(fresh.runIds).toHaveLength(1);

    // The replay is recorded rather than dropped, so a retry storm is visible.
    const deliveries = await withSystemContext(db, (tx) =>
      tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.event, "duplicate")),
    );
    expect(deliveries).toHaveLength(1);
  });

  it("keys the replay window on the connection, not the provider (P9-5)", async () => {
    const { db, deps, organizationId, connectionId } = await seed();
    const otherConnectionId = await connectUser(db, organizationId, "B", OTHER_SECRET);

    // Byte-identical body, two connections of the same provider: the payload
    // carries nothing user-specific, so the hashes are equal by construction.
    const first = await handleWebhook(deps)({ provider: "wallet", rawBody: BODY, headers: signed(BODY) });
    expect(first.status).toBe("accepted");
    expect(first.connectionId).toBe(connectionId);
    expect(first.runIds).toHaveLength(1);

    const second = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signed(BODY, OTHER_SECRET),
    });
    // The second connection's work must NOT be swallowed as a replay of the
    // first — a provider-wide key would answer "duplicate" and drop this sync
    // behind a 202, losing it silently.
    expect(second.status).toBe("accepted");
    expect(second.connectionId).toBe(otherConnectionId);
    expect(second.runIds).toHaveLength(1);

    const runs = await withSystemContext(db, (tx) => tx.select().from(syncRuns));
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((r) => r.connectionId))).toEqual(new Set([connectionId, otherConnectionId]));

    // The same connection twice is still a replay.
    const replay = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signed(BODY, OTHER_SECRET),
    });
    expect(replay.status).toBe("duplicate");
    expect(replay.runIds).toEqual([]);
    expect(await withSystemContext(db, (tx) => tx.select().from(syncRuns))).toHaveLength(2);
  });

  it("refuses the 61st delivery of a minute for that connection", async () => {
    const { db, deps, connectionId } = await seed();

    for (let i = 0; i < INBOUND_LIMIT_PER_MINUTE; i += 1) {
      const outcome = await handleWebhook(deps)({ provider: "wallet", rawBody: BODY, headers: signed(BODY) });
      // The first queues; the rest are replays of it, which is beside the point
      // here — every one of them counts against the window.
      expect(outcome.accepted).toBe(true);
    }

    const over = await handleWebhook(deps)({ provider: "wallet", rawBody: BODY, headers: signed(BODY) });
    expect(over.status).toBe("rate_limited");
    expect(over.accepted).toBe(false);

    // Counted against the CONNECTION id, in the shared `rate_limit_windows`
    // table the authenticated limiter uses (Ruling P9-1).
    const windows = await withSystemContext(db, (tx) =>
      tx.select().from(rateLimitWindows).where(eq(rateLimitWindows.principalId, connectionId)),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]!.count).toBe(INBOUND_LIMIT_PER_MINUTE + 1);

    // Refused, and said so on the delivery row.
    const rejected = await withSystemContext(db, (tx) =>
      tx
        .select()
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.event, "rate_limited"), eq(webhookDeliveries.status, "rejected"))),
    );
    expect(rejected).toHaveLength(1);

    // The next minute starts clean.
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const nextMinute = await handleWebhook(deps)({ provider: "wallet", rawBody: BODY, headers: signed(BODY) });
    expect(nextMinute.status).toBe("duplicate");
  });
});
