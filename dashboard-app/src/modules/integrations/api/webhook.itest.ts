import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb, resetDb, testDb } from "@/test/db";
import { auditEvents, organizations, users, webhookDeliveries } from "@/lib/db/schema";
import { createApiApp, type ApiDeps } from "@/platform/http/app";
import { withSystemContext } from "@/platform/db/context";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { registerProvider, resetProviderRegistry } from "@/platform/integrations/registry";
import { resetCredentialCipher } from "@/platform/integrations/crypto";
import { hmacSignatureVerifier } from "@/platform/integrations/webhook-signature";
import { ITEST_ENCRYPTION_KEY } from "@/test/integration-setup";
import type { IntegrationProvider } from "@/platform/integrations/types";
import { drainSyncQueue } from "@/modules/integrations/application/drain-sync-queue";
import { integrationDeps } from "@/modules/integrations/infrastructure/deps";

const KEY = `k1:${Buffer.alloc(32, 3).toString("base64")}`;

function fakeProvider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({
      token: z.string().min(1),
      webhookSecret: z.string().optional().default(""),
    }),
    credentialFields: [
      { name: "token", label: "API token", secret: true },
      { name: "webhookSecret", label: "Webhook secret", secret: true },
    ],
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
    webhook: {
      verify: hmacSignatureVerifier(),
      toSyncRequests: () => [{ kind: "accounts", event: "accounts.changed" }],
    },
    onDisconnect: async () => {},
  };
}

describe("webhook route", () => {
  beforeEach(async () => {
    await resetDb();
    resetProviderRegistry();
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
    return { app: createApiApp(deps), db, userA: userA! };
  }

  function headers(userId: string, extra: Record<string, string> = {}) {
    return { "content-type": "application/json", "x-test-user": userId, "x-requested-with": "fetch", ...extra };
  }

  it("accepts a signed webhook without a session, queues the sync, and refuses an unsigned one", async () => {
    const { app, db, userA } = await seed();
    await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good", webhookSecret: "hook-secret" } }),
    });

    const body = '{"event":"accounts.changed"}';
    const signature = `sha256=${createHmac("sha256", "hook-secret").update(body, "utf8").digest("hex")}`;

    // No session header, no X-Requested-With: this route is genuinely public.
    const ok = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
    });
    expect(ok.status).toBe(202);
    const okBody = await ok.json();
    expect(okBody.accepted).toBe(true);
    expect(okBody.runIds).toHaveLength(1);

    const unsigned = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(unsigned.status).toBe(404);

    // Queued, not run: spec §3.4 and Ruling P2-C3.
    const queued = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: headers(userA.id) });
    const queuedItems = (await queued.json()).items as { id: string; status: string; trigger: string }[];
    expect(queuedItems).toHaveLength(1);
    expect(queuedItems[0]!.status).toBe("queued");
    expect(queuedItems[0]!.trigger).toBe("webhook");

    // The tick runs it, in the connection owner's own context.
    const drained = await drainSyncQueue(integrationDeps(db))(10);
    expect(drained.map((r) => r.id)).toEqual([queuedItems[0]!.id]);
    expect(drained[0]!.status).toBe("success");

    const after = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: headers(userA.id) });
    expect(((await after.json()).items as { status: string }[])[0]!.status).toBe("success");

    // The audit row the sync wrote names the person, not the system.
    // `audit_events` carries FORCE ROW LEVEL SECURITY (migration 0009), so a
    // plain `db.select()` — with no `app.user_id`/`app.role` set for this
    // connection — would see zero rows regardless of what was written; the
    // read has to run in a context the policy actually grants (mirrors
    // `src/platform/audit/record.itest.ts`).
    const audit = await withSystemContext(db, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, "integration.sync")),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(userA.id);
  });

  it("rejects a wrong signature and an unknown provider without touching sync_runs", async () => {
    const { app, userA } = await seed();
    await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good", webhookSecret: "hook-secret" } }),
    });

    const body = '{"event":"accounts.changed"}';
    const wrongSignature = `sha256=${createHmac("sha256", "not-the-secret").update(body, "utf8").digest("hex")}`;

    const wrong = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": wrongSignature },
      body,
    });
    expect(wrong.status).toBe(404);
    expect((await wrong.json()).error.code).toBe("not_found");

    const unknownProvider = await app.request("/api/v1/webhooks/nope", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": wrongSignature },
      body,
    });
    expect(unknownProvider.status).toBe(404);

    const runs = await app.request("/api/v1/integrations/wallet/sync-runs", { headers: headers(userA.id) });
    expect((await runs.json()).items).toHaveLength(0);
  });

  it("refuses a signed body that is not JSON with the same flat 404, not Hono's own 400", async () => {
    const { app, userA } = await seed();
    await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good", webhookSecret: "hook-secret" } }),
    });

    // This is the assertion that pins the deviation from the brief's literal
    // route body schema (a Zod `z.unknown()`, which `@hono/zod-openapi` would
    // treat as "validate this" and call `c.req.json()` on before the handler
    // — and hence before the signature is ever checked — 400ing a signed,
    // non-JSON delivery with Hono's own "Malformed JSON in request body"
    // instead of this route's flat, uninformative rejection). A future edit
    // that swaps the route's documentation-only schema for a real Zod one
    // would restore parse-before-verify and fail this test.
    const raw = "not json at all";
    const signature = `sha256=${createHmac("sha256", "hook-secret").update(raw, "utf8").digest("hex")}`;
    const res = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body: raw,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("refuses an oversized body with the flat 404 before hashing or opening a transaction", async () => {
    const { app, db, userA } = await seed();
    await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good", webhookSecret: "hook-secret" } }),
    });

    // Larger than the route's 1 MB cap. The signature does not need to be
    // valid — an oversized body is refused before it would ever be checked.
    const oversized = `{"event":"accounts.changed","padding":"${"a".repeat(1_100_000)}"}`;
    const res = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "sha256=0".padEnd(71, "0") },
      body: oversized,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");

    // No transaction was opened for it: unlike every other rejection reason,
    // an oversized body writes no delivery row at all — there would be
    // nothing to attribute it to, and recording one is exactly the write-cost
    // this cap exists to avoid paying on an anonymous caller's say-so.
    const deliveries = await withSystemContext(db, (tx) => tx.select().from(webhookDeliveries));
    expect(deliveries).toHaveLength(0);
  });

  it("refuses an oversized body with no Content-Length header, abandoning the stream instead of buffering it fully", async () => {
    const { app, db, userA } = await seed();
    await app.request("/api/v1/integrations/wallet/connect", {
      method: "POST",
      headers: headers(userA.id),
      body: JSON.stringify({ credentials: { token: "good", webhookSecret: "hook-secret" } }),
    });

    // A `ReadableStream` body, not a string: `fetch`'s `Request` cannot know
    // the total length up front for a stream, so it sends no `Content-Length`
    // at all (the real-world equivalent is `Transfer-Encoding: chunked`) —
    // precisely the case a `Content-Length` pre-check cannot catch, and
    // exactly what an attacker would use to defeat one.
    //
    // `pulls` counts how many chunks the server actually consumed. A body
    // read via `c.req.text()` (buffer everything, then check) would drain
    // every chunk before ever checking the size — i.e. `pulls` would reach
    // `chunkCount`. A capped, incremental read abandons the stream as soon as
    // the running total crosses 1 MB, which happens after 17 of these 64 KiB
    // chunks (1088 KiB) — well before the 32 offered (2 MB total). Asserting
    // `pulls < chunkCount` is what actually distinguishes the two
    // implementations; asserting only the response status would pass against
    // either.
    const chunkSize = 64 * 1024;
    const chunk = new TextEncoder().encode("a".repeat(chunkSize));
    const chunkCount = 32; // 32 * 64 KiB = 2 MiB, comfortably over the 1 MB cap
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > chunkCount) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });

    const res = await app.request("/api/v1/webhooks/wallet", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": `sha256=${"0".repeat(64)}` },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(pulls).toBeLessThan(chunkCount);

    const deliveries = await withSystemContext(db, (tx) => tx.select().from(webhookDeliveries));
    expect(deliveries).toHaveLength(0);
  });
});
