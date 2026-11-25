import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getMetrics } from "@/app/api/metrics/route";
import { getDb } from "@domain/platform/db/client";
import { withJobLock } from "@domain/platform/jobs/lock";
import type { JobDefinition } from "./registry";
import { jobRuns } from "@domain/platform/jobs/schema";
import { runTier } from "./tick";
import { holdingRun, recordRun, saveConnection } from "@domain/platform/integrations";
import { createTestUser } from "../../../../../test/users";
import { WALLET_PROVIDER } from "../../../../../test/fixtures/providers";

const job = (name: string, run: JobDefinition["run"]): JobDefinition => ({ name, tier: "hourly", run });

/**
 * Takes a job's lock and keeps it until `release`. It answers when the lock is held: a short wait
 * that hopes so loses the race on a busy machine.
 */
async function holdJob(key: string): Promise<{ held: Promise<unknown>; release: () => void }> {
  let release: () => void = () => {};
  let taken: () => void = () => {};
  const isTaken = new Promise<void>((resolve) => (taken = resolve));
  const held = withJobLock(key, () => {
    taken();
    return new Promise<void>((resolve) => (release = resolve));
  });
  await isTaken;
  return { held, release: () => release() };
}

describe("jobs", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("records success and failure independently", async () => {
    const outcomes = await runTier("hourly", [
      job("ok", async () => ({ processed: 3 })),
      job("broken", async () => {
        throw new Error("provider down");
      }),
    ]);
    expect(outcomes).toEqual([
      { job: "ok", status: "success" },
      { job: "broken", status: "failed" },
    ]);
    const runs = await getDb().select().from(jobRuns).orderBy(jobRuns.job);
    expect(runs.map((r) => [r.job, r.status, r.error])).toEqual([
      ["broken", "failed", "provider down"],
      ["ok", "success", null],
    ]);
  });

  it("strips NUL bytes from a stored error so later jobs still run", async () => {
    const outcomes = await runTier("hourly", [
      job("poison", async () => {
        throw new Error("bad\u0000byte");
      }),
      job("after", async () => ({ ok: true })),
    ]);
    expect(outcomes).toEqual([
      { job: "poison", status: "failed" },
      { job: "after", status: "success" },
    ]);
    const [poisoned] = await getDb().select().from(jobRuns).where(eq(jobRuns.job, "poison"));
    expect(poisoned.status).toBe("failed");
    expect(poisoned.error).toBe("badbyte");
    const [after] = await getDb().select().from(jobRuns).where(eq(jobRuns.job, "after"));
    expect(after.status).toBe("success");
  });

  it("skips a job that is already running elsewhere", async () => {
    const { held, release } = await holdJob("job:slow");
    const outcomes = await runTier("hourly", [job("slow", async () => ({}))]);
    release();
    await held;
    expect(outcomes).toEqual([{ job: "slow", status: "skipped" }]);
    const [run] = await getDb()
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, "slow"))
      .orderBy(desc(jobRuns.startedAt));
    expect(run.status).toBe("skipped");
  });

  it("runs the daily tier of the registry, each job recorded on its own", async () => {
    expect({ tier: "daily", outcomes: await runTier("daily") }).toMatchObject({
      tier: "daily",
      outcomes: [
        { job: "housekeeping", status: "success" },
        { job: "accounts-alerts", status: "success" },
        { job: "subscriptions-check", status: "success" },
        // Daily since R5a (D6): each pocket on its own day of the month.
        { job: "pockets-accrual", status: "success" },
        { job: "pockets-planned-cleanup", status: "success" },
        { job: "documents-retention", status: "success" },
        { job: "holidays-refresh", status: "success" },
        // No balance in the database, so nothing to convert: it asks Frankfurter for nothing.
        { job: "fx-rates-refresh", status: "success" },
        // No prices plugin configured here: it reads nothing (R5d).
        { job: "instrument-prices", status: "success" },
        // No plan here: nothing comes due (R5d).
        { job: "investment-plans", status: "success" },
        // The real daily backup, which genuinely fails here: `pg_dump` is in the *application*
        // image (Dockerfile) and not in the bare `node:26-bookworm-slim` this suite runs in. That
        // it is recorded as failed rather than stopping the tier is the point of the assertion.
        { job: "database-backup", status: "failed" },
      ],
    });
  });

  it("protects metrics with a bearer token and serves Prometheus lines once authorized", async () => {
    await runTier("hourly", [job("ok", async () => ({}))]);
    const call = (authorization?: string) =>
      getMetrics(
        new Request(
          "http://localhost/api/metrics",
          authorization ? { headers: { authorization } } : undefined,
        ),
      );
    expect((await call()).status).toBe(404);
    expect((await call("Bearer wrong-token-wrong-token-wrong-token")).status).toBe(404);
    const ok = await call("Bearer integration-metrics-token-integration-metrics-token");
    expect(ok.status).toBe(200);
    const body = await ok.text();
    expect(body).toContain("# TYPE job_last_success_timestamp gauge");
    expect(body).toContain("# TYPE job_runs_total counter");
    expect(body).toContain('job_runs_total{job="ok",status="success"} 1');
    expect(body).toContain("documents_awaiting_review 0");
  });
});

describe("readings at once and the pool (SEC-09)", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("more readings than the pool has connections leave it free, and /api/health answers", async () => {
    const READINGS = 12; // the pool has 10
    const { id: userId } = await createTestUser();
    const ctx = { userId };
    const connection = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    const releases: (() => void)[] = [];
    let holding!: () => void;
    const allHolding = new Promise<void>((resolve) => (holding = resolve));
    const readings = Array.from({ length: READINGS }, async (_, n) => {
      const run = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
      // As a reading does: the lock of its connection, its run held, a write through the pool.
      return withJobLock(`plugin-sync:reading-${n}`, () =>
        holdingRun(ctx, run.id, async () => {
          await getDb()
            .insert(jobRuns)
            .values({ job: `reading-${n}`, tier: "manual", status: "success" });
          await new Promise<void>((resolve) => {
            releases.push(resolve);
            if (releases.length === READINGS) holding();
          });
          return n;
        }),
      );
    });
    await allHolding;

    expect((await getHealth()).status).toBe(200);
    // A second reading of a connection being read is refused at once, it does not wait in a queue.
    expect(await withJobLock("plugin-sync:reading-0", async () => "twice")).toEqual({ ran: false });

    releases.forEach((release) => release());
    expect((await Promise.all(readings)).map((outcome) => outcome.ran)).toEqual(
      Array.from({ length: READINGS }, () => true),
    );
    expect(await getDb().$count(jobRuns)).toBe(READINGS);
  });
});
