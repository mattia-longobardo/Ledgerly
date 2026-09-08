/**
 * The retention sweep against real Postgres (Ruling R9-5).
 *
 * Every table it names is seeded with one row that is past its window and one
 * that is comfortably inside it, so a rule that purged by the wrong column —
 * or purged everything — fails here rather than in production, where the rows
 * are gone by the time anybody notices.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  auditEvents,
  idempotencyKeys,
  integrationConnections,
  jobRuns,
  organizations,
  rateLimitWindows,
  syncRuns,
  users,
  webhookDeliveries,
} from "@/lib/db/schema";
import { JOB_NAME, PURGE_BATCH, RETENTION, runHousekeeping, runHousekeepingJob } from "@/lib/jobs/housekeeping";
import { withSystemContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";

const NOW = new Date("2026-09-08T03:00:00.000Z");
const DAY = 86_400_000;

/** `NOW` minus `days`, give or take an hour so nothing sits exactly on a boundary. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY - 3_600_000);
}

type Db = Awaited<ReturnType<typeof testDb>>;

/**
 * Seeds and reads run in the system context for the same reason the job does:
 * `audit_events`, `idempotency_keys` and `rate_limit_windows` carry FORCE ROW
 * LEVEL SECURITY, so on the bare pool an insert is rejected and a read returns
 * zero rows without saying why.
 */
async function asSystem<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const d = await testDb();
  return withSystemContext(d, (tx) => fn(tx as unknown as Db));
}

async function seedConnection(d: Db): Promise<string> {
  const [org] = await d.insert(organizations).values({ name: "P" }).returning();
  const [user] = await d.insert(users).values({ organizationId: org!.id, displayName: "Owner" }).returning();
  const [conn] = await d
    .insert(integrationConnections)
    .values({ userId: user!.id, provider: "wallet", status: "connected" })
    .returning();
  return conn!.id;
}

async function count(d: Db, table: string): Promise<number> {
  const res = await d.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`);
  return Number(res.rows[0]?.n ?? 0);
}

describe("housekeeping", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("purges what is past its window in every table and keeps what is not", async () => {
    await asSystem(async (d) => {
      const connectionId = await seedConnection(d);

      await d.insert(auditEvents).values([
        { action: "old", entityType: "t", createdAt: daysAgo(731) },
        { action: "recent", entityType: "t", createdAt: daysAgo(729) },
      ]);
      await d.insert(jobRuns).values([
        { jobName: "sweep", trigger: "cron", status: "success", startedAt: daysAgo(100), finishedAt: daysAgo(91) },
        { jobName: "sweep", trigger: "cron", status: "success", startedAt: daysAgo(100), finishedAt: daysAgo(89) },
        // Never finished: aged by `started_at`, so it is collected too.
        { jobName: "sweep", trigger: "cron", status: "running", startedAt: daysAgo(91), finishedAt: null },
      ]);
      await d.insert(syncRuns).values([
        { connectionId, kind: "accounts", status: "success", trigger: "cron", startedAt: daysAgo(100), finishedAt: daysAgo(91) },
        { connectionId, kind: "accounts", status: "success", trigger: "cron", startedAt: daysAgo(100), finishedAt: daysAgo(89) },
      ]);
      await d.insert(webhookDeliveries).values([
        { connectionId, provider: "wallet", event: "e", payloadHash: "old", status: "accepted", receivedAt: daysAgo(91) },
        { connectionId, provider: "wallet", event: "e", payloadHash: "new", status: "accepted", receivedAt: daysAgo(89) },
      ]);
      await d.insert(idempotencyKeys).values([
        {
          principalId: "00000000-0000-7000-8000-0000000000c1",
          key: "expired",
          requestHash: "h",
          expiresAt: new Date(NOW.getTime() - 1_000),
        },
        {
          principalId: "00000000-0000-7000-8000-0000000000c1",
          key: "live",
          requestHash: "h",
          expiresAt: new Date(NOW.getTime() + DAY),
        },
      ]);
      await d.insert(rateLimitWindows).values([
        { principalId: "00000000-0000-7000-8000-0000000000c2", windowStart: daysAgo(2), count: 3 },
        { principalId: "00000000-0000-7000-8000-0000000000c2", windowStart: daysAgo(0), count: 3 },
      ]);
    });

    const result = await runHousekeeping(NOW);

    expect(result.purged).toEqual({
      audit_events: 1,
      job_runs: 2,
      sync_runs: 1,
      webhook_deliveries: 1,
      idempotency_keys: 1,
      rate_limit_windows: 1,
    });
    expect(result.total).toBe(7);
    expect(result.capped).toBe(false);

    const survivors = await asSystem(async (d) => {
      const out: Record<string, number> = {};
      for (const rule of RETENTION) out[rule.table] = await count(d, rule.table);
      return out;
    });
    expect(survivors).toEqual({
      audit_events: 1,
      job_runs: 1,
      sync_runs: 1,
      webhook_deliveries: 1,
      idempotency_keys: 1,
      rate_limit_windows: 1,
    });
  });

  it("caps each table at the batch size, leaving the rest for the next run", async () => {
    const rows = Array.from({ length: PURGE_BATCH + 100 }, () => ({
      action: "old",
      entityType: "t",
      createdAt: daysAgo(800),
    }));
    await asSystem(async (d) => {
      // Chunked: a single 5,100-row INSERT exceeds node-postgres' bind-parameter
      // ceiling once each row carries several columns.
      for (let i = 0; i < rows.length; i += 500) {
        await d.insert(auditEvents).values(rows.slice(i, i + 500));
      }
    });

    const result = await runHousekeeping(NOW);

    expect(result.purged.audit_events).toBe(PURGE_BATCH);
    expect(result.capped).toBe(true);
    expect(await asSystem((d) => count(d, "audit_events"))).toBe(100);
  });

  it("records the per-table counts on its job_runs row", async () => {
    await asSystem((d) =>
      d.insert(auditEvents).values([{ action: "old", entityType: "t", createdAt: daysAgo(731) }]),
    );

    const outcome = await runHousekeepingJob({ trigger: "cron", now: NOW });

    expect(outcome).toMatchObject({ job: JOB_NAME, status: "success" });
    expect(outcome.detail).toMatchObject({ audit_events: 1, total: 1, capped: false });

    const rows = await asSystem((d) =>
      d.select().from(jobRuns).where(eq(jobRuns.jobName, JOB_NAME)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("success");
    expect(rows[0]?.detail).toMatchObject({ audit_events: 1, sync_runs: 0, total: 1 });
  });
});
