import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { createCredentialCipher } from "@/platform/integrations/crypto";
import { DrizzleConnectionsRepository } from "./drizzle-connections-repository";
import { DrizzleSyncJobsRepository } from "./drizzle-sync-jobs-repository";
import { DrizzleSyncRunsRepository } from "./drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "./drizzle-webhook-deliveries-repository";

const KEY = `k1:${Buffer.alloc(32, 7).toString("base64")}`;

describe("integration repositories", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("stores a connection with sealed credentials, records runs and deliveries", async () => {
    const db = await testDb();
    const cipher = createCredentialCipher(KEY);
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();

    const created = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).create({
        userId: user!.id,
        provider: "wallet",
        // "connected", not "disconnected": the system-context block below
        // exercises `candidatesForWebhook`, which (per its port doc) only
        // returns connected connections — a disconnected fixture here would
        // make that assertion fail for a reason unrelated to the query itself.
        status: "connected",
        settings: { note: "primary" },
        disconnectPolicy: "keep",
      }),
    );
    expect(created.version).toBe(1);
    expect(created.settings).toEqual({ note: "primary" });

    await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).writeCredentials(user!.id, created.id, cipher.seal({ token: "secret" })),
    );
    const sealed = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).readCredentials(user!.id, created.id),
    );
    expect(cipher.open(sealed!)).toEqual({ token: "secret" });

    const bumped = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).update(user!.id, created.id, 1, { disconnectPolicy: "archive" }),
    );
    // Narrowed, not cast — same reason as the memory repository's test.
    if (bumped === null || bumped === "version_mismatch") {
      throw new Error(`expected the updated connection, got ${String(bumped)}`);
    }
    expect(bumped.version).toBe(2);
    expect(bumped.disconnectPolicy).toBe("archive");
    const stale = await withUserContext(db, { userId: user!.id }, (tx) =>
      new DrizzleConnectionsRepository(tx).update(user!.id, created.id, 1, { disconnectPolicy: "purge" }),
    );
    expect(stale).toBe("version_mismatch");

    const jobId = await withUserContext(db, { userId: user!.id }, async (tx) => {
      const jobs = new DrizzleSyncJobsRepository(tx);
      const job = await jobs.ensure({ connectionId: created.id, kind: "accounts", schedule: "daily" });
      // Idempotent: connecting twice must not create a second job row.
      expect((await jobs.ensure({ connectionId: created.id, kind: "accounts", schedule: "daily" })).id).toBe(job.id);
      expect(job.enabled).toBe(true);
      await jobs.setCursor(job.id, { since: "2026-09-01" });
      expect((await jobs.find(created.id, "accounts"))?.cursor).toEqual({ since: "2026-09-01" });
      return job.id;
    });

    await withUserContext(db, { userId: user!.id }, async (tx) => {
      const runs = new DrizzleSyncRunsRepository(tx);
      const run = await runs.start({
        connectionId: created.id,
        jobId,
        kind: "accounts",
        trigger: "manual",
        startedAt: new Date("2026-09-04T08:00:00Z"),
      });
      expect(run.jobId).toBe(jobId);
      expect((await runs.running(created.id, "accounts"))?.id).toBe(run.id);
      await runs.finish(run.id, {
        status: "success",
        stats: { created: 3 },
        error: null,
        finishedAt: new Date("2026-09-04T08:00:02Z"),
      });
      expect(await runs.running(created.id, "accounts")).toBeNull();
      expect((await runs.recent(created.id, 5))[0]?.stats).toEqual({ created: 3 });

      await new DrizzleWebhookDeliveriesRepository(tx).record({
        connectionId: created.id,
        provider: "wallet",
        event: "sync.requested",
        payloadHash: "abc",
        status: "accepted",
        error: null,
        receivedAt: new Date("2026-09-04T08:01:00Z"),
      });
    });

    // The three system-context reads: no principal exists on the webhook and
    // queue-drain paths, so they are exercised the way those paths run them.
    await withSystemContext(db, async (tx) => {
      const connections = new DrizzleConnectionsRepository(tx);
      expect((await connections.candidatesForWebhook("wallet")).map((c) => c.id)).toEqual([created.id]);
      expect((await connections.getById(created.id))?.userId).toBe(user!.id);

      const runs = new DrizzleSyncRunsRepository(tx);
      const queued = await runs.enqueue({
        connectionId: created.id,
        jobId,
        kind: "accounts",
        trigger: "webhook",
        queuedAt: new Date("2026-09-04T08:02:00Z"),
      });
      expect(queued.status).toBe("queued");
      // A queued run is not in flight: it must not make the next trigger join it.
      expect(await runs.running(created.id, "accounts")).toBeNull();
      expect((await runs.queued(10)).map((r) => r.id)).toEqual([queued.id]);

      const claimed = await runs.claim(queued.id, new Date("2026-09-04T08:03:00Z"));
      expect(claimed?.status).toBe("running");
      expect(await runs.queued(10)).toEqual([]);
      // The losing tick of a race gets nothing, so the row runs exactly once.
      expect(await runs.claim(queued.id, new Date("2026-09-04T08:03:01Z"))).toBeNull();
    });
  });
});
