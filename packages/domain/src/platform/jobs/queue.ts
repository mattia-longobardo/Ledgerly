import { and, eq, lt, ne, or, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { APP_VERSION } from "../version";
import { jobQueue, jobRuns, workerHeartbeats } from "./schema";

/** A piece of work for the worker: what to run (`kind`, `payload`) and what it may not run beside. */
export interface Task {
  kind: string;
  /** One waiting task per key; two tasks of one key never run together. */
  key: string;
  payload: Record<string, unknown>;
}

export interface QueuedTask extends Task {
  id: string;
  attempts: number;
}

/** A task interrupted this many times (a worker that died running it) is given up. */
const MAX_ATTEMPTS = 3;

/**
 * Puts a task in the queue. False when a task of the same key is already waiting: that one will
 * do the same work, after anything of the key that is running now.
 */
export async function enqueue(task: Task): Promise<boolean> {
  const rows = await getDb()
    .insert(jobQueue)
    .values({ key: task.key, kind: task.kind, payload: task.payload })
    .onConflictDoNothing({ target: jobQueue.key, where: sql`${jobQueue.status} = 'queued'` })
    .returning({ id: jobQueue.id });
  return rows.length > 0;
}

/**
 * The oldest waiting task whose key nothing is running, marked as `workerId`'s. A task is due by the
 * app's clock or by the database's, which stamped its `run_after`: a few milliseconds between the
 * two must not hide a task just queued. `SKIP LOCKED`
 * passes over a row another claim holds; the one worker claims one task at a time, so the check on
 * the running rows reads committed rows only.
 */
export async function claimNext(workerId: string, now: Date = new Date()): Promise<QueuedTask | null> {
  const { rows } = await getDb().execute<{
    id: string;
    kind: string;
    key: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(sql`
    update job_queue set status = 'running', locked_by = ${workerId}, locked_at = ${now.toISOString()}::timestamptz,
      attempts = attempts + 1
    where id = (
      select q.id from job_queue q
      where q.status = 'queued'
        and q.run_after <= greatest(${now.toISOString()}::timestamptz, now())
        and not exists (select 1 from job_queue r where r.key = q.key and r.status = 'running')
      order by q.run_after, q.id
      for update skip locked
      limit 1
    )
    returning id, kind, key, payload, attempts`);
  return rows[0] ?? null;
}

/** The task has ended, however it went: its record is the job's own. */
export async function finishTask(id: string): Promise<void> {
  await getDb().delete(jobQueue).where(eq(jobQueue.id, id));
}

/**
 * The tasks a worker that is gone left `running` (every worker but `workerId`): back in the queue,
 * to run again from the start, or given up after {@link MAX_ATTEMPTS}. A task whose key already has
 * one waiting is only removed: the waiting one does the same work.
 */
export async function recoverInterrupted(
  workerId: string,
): Promise<{ requeued: number; abandoned: QueuedTask[] }> {
  return getDb().transaction(async (trx) => {
    const orphans = await trx
      .select()
      .from(jobQueue)
      .where(
        and(eq(jobQueue.status, "running"), or(isNull(jobQueue.lockedBy), ne(jobQueue.lockedBy, workerId))),
      )
      .for("update");
    let requeued = 0;
    const abandoned: QueuedTask[] = [];
    for (const row of orphans) {
      const [waiting] = await trx
        .select({ id: jobQueue.id })
        .from(jobQueue)
        .where(and(eq(jobQueue.key, row.key), eq(jobQueue.status, "queued")));
      if (row.attempts >= MAX_ATTEMPTS || waiting) {
        await trx.delete(jobQueue).where(eq(jobQueue.id, row.id));
        if (!waiting) abandoned.push(row);
        continue;
      }
      await trx
        .update(jobQueue)
        .set({ status: "queued", lockedBy: null, lockedAt: null })
        .where(eq(jobQueue.id, row.id));
      requeued += 1;
    }
    return { requeued, abandoned };
  });
}

/** The worker is alive: one row per worker, its version and when it started. */
export async function beat(workerId: string, startedAt: Date, now: Date = new Date()): Promise<void> {
  await getDb()
    .insert(workerHeartbeats)
    .values({ workerId, version: APP_VERSION, startedAt, beatAt: now })
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { beatAt: now, version: APP_VERSION } });
  // The rows of the workers before this one: a day is long past any of them.
  await getDb()
    .delete(workerHeartbeats)
    .where(lt(workerHeartbeats.beatAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
}

/** The last beat of any worker, or null when none has ever beaten. */
export async function lastBeatAt(): Promise<Date | null> {
  const [row] = await getDb()
    .select({ at: sql<string | null>`max(${workerHeartbeats.beatAt})` })
    .from(workerHeartbeats);
  return row?.at ? new Date(row.at) : null;
}

/**
 * Closes the job runs nobody is running any more, started before `startedBefore`: failed, with the
 * reason `orphaned`. The worker calls it as it starts (every run before it was a worker's that
 * died); `housekeeping` with an hour's margin, the net under it.
 */
export async function closeOrphanJobRuns(startedBefore: Date, now: Date = new Date()): Promise<number> {
  const closed = await getDb()
    .update(jobRuns)
    .set({ status: "failed", finishedAt: now, error: "orphaned" })
    .where(and(eq(jobRuns.status, "running"), lt(jobRuns.startedAt, startedBefore)))
    .returning({ id: jobRuns.id });
  return closed.length;
}
