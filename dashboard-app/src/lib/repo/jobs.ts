import { and, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import type { JobName, JobStatus } from "@/lib/contracts";

export async function startRun(input: {
  jobName: JobName;
  trigger: "cron" | "sweep" | "manual" | "webhook";
  dedupeKey?: string | null;
  attempt?: number;
}) {
  const [row] = await db
    .insert(jobRuns)
    .values({
      jobName: input.jobName,
      trigger: input.trigger,
      dedupeKey: input.dedupeKey ?? null,
      attempt: input.attempt ?? 1,
      status: "running",
    })
    .returning();
  return row!;
}

export async function finishRun(
  id: number,
  status: JobStatus,
  extra?: { error?: string; detail?: Record<string, unknown> },
) {
  await db
    .update(jobRuns)
    .set({
      status,
      finishedAt: new Date(),
      error: extra?.error ?? null,
      detail: extra?.detail ?? null,
    })
    .where(eq(jobRuns.id, id));
}

export async function recentRuns(jobName?: JobName, limit = 20) {
  const q = db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit);
  return jobName ? q.where(eq(jobRuns.jobName, jobName)) : q;
}

export async function lastSuccess(jobName: JobName) {
  const [row] = await db
    .select()
    .from(jobRuns)
    .where(
      and(
        eq(jobRuns.jobName, jobName),
        sql`${jobRuns.status} IN ('success','success_after_retry','already_done')`,
      ),
    )
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Serialises a job against itself for the whole of `fn`, network I/O included
 * (Ruling R9-1). One client is checked out of the pool and the lock is taken on
 * that *session* with `pg_try_advisory_lock`; `fn` then runs with **no
 * transaction open on that client**, so a job body is free to open its own
 * transactions (`withUserContext`, `withSystemContext`) and to spend minutes in
 * an HTTP round trip without an idle transaction hanging off the pool. The lock
 * is released in `finally`, and a client death releases it too — the session
 * that holds it is the one that dies.
 *
 * Non-blocking: a second concurrent call on the same key returns `null` rather
 * than waiting, so a cron tick that overlaps the previous one is a no-op. curl
 * --retry after a timeout must not produce a second write — for a job whose own
 * write is a single local transaction (e.g. `monthly-close.ts`) this lock is the
 * whole story.
 *
 * `fn` runs off `db` (the pool), not off the locked client: the client exists
 * only to own the lock. That is deliberate — routing the body through it would
 * bypass Drizzle and the RLS context helpers.
 *
 * For the interest accrual job the lock is now a real serialisation guarantee
 * for the length of the Wallet round trip, and no longer only an optimisation
 * (this is the P3-C39 / B2 review finding, fixed here). `interest-accrual.ts`'s
 * `tryPost` keeps claiming the accrual as a committed database row
 * (`InterestAccrualsRepository.claimForPosting`) before it calls Wallet: that
 * defence stands on its own across a process crash, which no lock survives.
 */
export async function withJobLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let locked = false;
  try {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [key],
    );
    locked = res.rows[0]?.locked === true;
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => undefined);
    client.release();
  }
}

