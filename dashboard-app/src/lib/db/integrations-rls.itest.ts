import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { integrationConnections, integrationProviders, organizations, syncJobs, syncRuns, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("integration tables RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("seeds the provider catalogue and scopes connections and runs per user", async () => {
    const db = await testDb();
    const providers = await db.select().from(integrationProviders);
    expect(providers.map((p) => p.code).sort()).toEqual(["trek", "wallet"]);

    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    const created = await withSystemContext(db, (tx) =>
      tx
        .insert(integrationConnections)
        .values([
          { userId: a!.id, provider: "wallet", status: "connected" },
          { userId: b!.id, provider: "wallet", status: "connected" },
        ])
        .returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(syncRuns).values([
        { connectionId: created[0]!.id, kind: "accounts", status: "success", trigger: "manual" },
        { connectionId: created[1]!.id, kind: "accounts", status: "success", trigger: "manual" },
      ]),
    );

    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(integrationConnections));
    expect(mine).toHaveLength(1);
    const myRuns = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(syncRuns));
    expect(myRuns).toHaveLength(1);
    expect(await db.select().from(integrationConnections)).toEqual([]);
  });

  it("accepts a queued run and a job carrying a cursor", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();

    const { run, job } = await withSystemContext(db, async (tx) => {
      const [connection] = await tx
        .insert(integrationConnections)
        .values({ userId: user!.id, provider: "wallet", status: "connected" })
        .returning();
      const [createdJob] = await tx
        .insert(syncJobs)
        .values({ connectionId: connection!.id, kind: "accounts", schedule: "daily", cursor: { page: 3 } })
        .returning();
      const [createdRun] = await tx
        .insert(syncRuns)
        .values({
          connectionId: connection!.id,
          jobId: createdJob!.id,
          kind: "accounts",
          status: "queued",
          trigger: "webhook",
        })
        .returning();
      return { run: createdRun!, job: createdJob! };
    });

    expect(run.status).toBe("queued");
    expect(run.jobId).toBe(job.id);
    expect(job.cursor).toEqual({ page: 3 });
    expect(job.enabled).toBe(true);
  });
});
