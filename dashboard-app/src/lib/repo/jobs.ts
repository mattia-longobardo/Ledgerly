import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
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
 * Serialises a job against itself for the length of the transaction. curl
 * --retry after a timeout must not produce a second write — for a job whose
 * own write is a single local transaction (e.g. `monthly-close.ts`) this
 * lock is the whole story.
 *
 * For the interest accrual job specifically, this lock is *not* that
 * guarantee (Ruling P3-C39, B2 review finding): `fn` there wraps a Wallet
 * round trip that can run for minutes, held across a transaction whose
 * session can die mid-flight (`idle_in_transaction_session_timeout`, a
 * pooler kill, a failover) — releasing `pg_try_advisory_xact_lock` while the
 * POST it was meant to guard is still in the air, with no way for the
 * caller to learn about it. `interest-accrual.ts`'s `tryPost` does not rely
 * on this lock for correctness; it claims the accrual as a committed
 * database row (`InterestAccrualsRepository.claimForPosting`) *before* ever
 * calling Wallet. This lock still helps there — it usually stops a second
 * concurrent tick from wasting a Wallet round trip it would lose the claim
 * race on anyway — but it is an optimisation, not the defence.
 */
export async function withJobLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`,
    );
    if (!res.rows[0]?.locked) return null;
    return fn();
  });
}

