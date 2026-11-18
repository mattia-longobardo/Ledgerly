// The queue of the worker against a real database (rewrite plan R1, "Test e gate"): a task a dead
// worker left running goes back in the queue and ends; two tasks of one key never run together;
// the runs a dead worker left `running` are closed as `orphaned` when the next one starts.
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@domain/platform/db/client";
import { WALLET_PROVIDER } from "@domain/platform/integrations/rules";
import { closeOrphanRuns, recordRun, saveConnection } from "@domain/platform/integrations/service";
import { syncRuns } from "@domain/platform/integrations/schema";
import {
  claimNext,
  closeOrphanJobRuns,
  enqueue,
  finishTask,
  recoverInterrupted,
} from "@domain/platform/jobs/queue";
import { jobQueue, jobRuns } from "@domain/platform/jobs/schema";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { newContext } from "../../../test/fixtures";

const task = (key: string) => ({ kind: "tier", key, payload: { tier: "minute" } });

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the queue", () => {
  it("puts a task back in the queue when its worker died, and the next worker ends it", async () => {
    await enqueue(task("tier:minute"));
    const first = await claimNext("worker-a");
    expect(first?.attempts).toBe(1);
    // worker-a dies here: its row stays `running`, and nothing else of the key is claimed.
    expect(await claimNext("worker-a")).toBeNull();

    expect(await recoverInterrupted("worker-b")).toEqual({ requeued: 1, abandoned: [] });
    const again = await claimNext("worker-b");
    expect(again).toMatchObject({ id: first?.id, kind: "tier", attempts: 2 });
    await finishTask(again!.id);
    expect(await getDb().select().from(jobQueue)).toEqual([]);
  });

  it("gives up a task interrupted three times, and keeps the one waiting for its key", async () => {
    await enqueue(task("tier:daily"));
    for (const worker of ["a", "b", "c"]) {
      await recoverInterrupted(`worker-${worker}`);
      expect(await claimNext(`worker-${worker}`)).not.toBeNull();
    }
    const { abandoned } = await recoverInterrupted("worker-d");
    expect(abandoned.map((one) => [one.key, one.attempts])).toEqual([["tier:daily", 3]]);
    expect(await getDb().select().from(jobQueue)).toEqual([]);

    // A task of the key already waiting does the same work: the interrupted one only goes.
    await enqueue(task("tier:hourly"));
    await claimNext("worker-e");
    await enqueue(task("tier:hourly"));
    expect(await recoverInterrupted("worker-f")).toEqual({ requeued: 0, abandoned: [] });
    expect(await getDb().select({ status: jobQueue.status }).from(jobQueue)).toEqual([{ status: "queued" }]);
  });

  it("never starts two tasks of one key together, and merges two that wait", async () => {
    expect(await enqueue(task("connection:1"))).toBe(true);
    expect(await enqueue(task("connection:1"))).toBe(false);
    const running = await claimNext("worker");
    // Asked again while it runs: it waits, and is not claimed until the first one ends.
    expect(await enqueue(task("connection:1"))).toBe(true);
    expect(await enqueue(task("connection:2"))).toBe(true);
    expect((await claimNext("worker"))?.key).toBe("connection:2");
    expect(await claimNext("worker")).toBeNull();
    await finishTask(running!.id);
    expect((await claimNext("worker"))?.key).toBe("connection:1");
  });

  it("closes the job and sync runs a worker left running, and only those started before", async () => {
    const ctx = await newContext();
    const connection = await saveConnection(ctx, { provider: WALLET_PROVIDER, credentials: { token: "t" } });
    const before = await recordRun(ctx, { connectionId: connection.id, kind: "transactions" });
    const [orphan] = await getDb()
      .insert(jobRuns)
      .values({ job: "integrations-sync", tier: "minute", status: "running" })
      .returning();
    const bootAt = new Date(Date.now() + 1_000);
    const [later] = await getDb()
      .insert(jobRuns)
      .values({
        job: "housekeeping",
        tier: "daily",
        status: "running",
        startedAt: new Date(bootAt.getTime() + 1),
      })
      .returning();

    expect(await closeOrphanJobRuns(bootAt, bootAt)).toBe(1);
    expect(await closeOrphanRuns(bootAt, bootAt)).toBe(1);

    const [job] = await getDb().select().from(jobRuns).where(eq(jobRuns.id, orphan.id));
    expect([job.status, job.error]).toEqual(["failed", "orphaned"]);
    const [kept] = await getDb().select().from(jobRuns).where(eq(jobRuns.id, later.id));
    expect(kept.status).toBe("running");
    const [run] = await getDb().select().from(syncRuns).where(eq(syncRuns.id, before.id));
    expect([run.state, run.error]).toEqual(["failed", "orphaned"]);
  });
});
