import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobRuns, monthlySnapshots } from "@/lib/db/schema";
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
 * --retry after a timeout must not produce a second write.
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

export async function getMonthlySnapshot(monthKey: string) {
  const [row] = await db
    .select()
    .from(monthlySnapshots)
    .where(eq(monthlySnapshots.monthKey, monthKey))
    .limit(1);
  return row ?? null;
}

/** Phase 2 of the snapshot job: Postgres is the idempotency authority. */
export async function persistPending(input: {
  monthKey: string;
  ing: string;
  revolut: string;
  capturedAt: Date;
}) {
  const [row] = await db
    .insert(monthlySnapshots)
    .values({ ...input, status: "pending_teable" })
    .onConflictDoNothing({ target: monthlySnapshots.monthKey })
    .returning();
  return row ?? (await getMonthlySnapshot(input.monthKey));
}

/** Phase 3: the Teable record id is the proof the write landed. */
export async function markSnapshotDone(monthKey: string, teableRecordId: string) {
  await db
    .update(monthlySnapshots)
    .set({ status: "done", teableRecordId })
    .where(eq(monthlySnapshots.monthKey, monthKey));
}

export async function markSnapshotStatus(monthKey: string, status: "poisoned" | "missed") {
  await db.update(monthlySnapshots).set({ status }).where(eq(monthlySnapshots.monthKey, monthKey));
}

export async function pendingTeableWrites() {
  return db
    .select()
    .from(monthlySnapshots)
    .where(eq(monthlySnapshots.status, "pending_teable"))
    .orderBy(monthlySnapshots.monthKey);
}

export async function attemptsFor(jobName: JobName, dedupeKey: string): Promise<number> {
  const result = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM job_runs
    WHERE job_name = ${jobName} AND dedupe_key = ${dedupeKey} AND status = 'failed'
  `);
  return Number(result.rows[0]?.n ?? 0);
}

export async function allMonthKeys(): Promise<string[]> {
  const rows = await db.select({ k: monthlySnapshots.monthKey }).from(monthlySnapshots);
  return rows.map((r) => r.k);
}
