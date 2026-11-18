import { and, desc, eq, gte, lte, lt, ne, or, sql } from "drizzle-orm";
import type { Ctx } from "../../context";
import { getDb } from "../../db/client";
import { userScoped } from "../../db/scope";
import { APP_VERSION } from "../../version";
import { currentOrigin } from "../origin";
import {
  connectionStateAfter,
  nextRunAt,
  normalizeCounts,
  outcomeState,
  type SyncKind,
  syncErrorText,
} from "../rules";
import { classifyFailure, failureStreak, isSyncErrorCode, ORPHAN_AFTER_MS } from "../status";
import { integrationConnections, syncJobs, syncRuns } from "../schema";
import { IntegrationError, requireConnection, type SyncRun } from "./connections";

/**
 * When a sync last changed the movements, across all users, as the jobs that read them are run
 * for all users. A failed pass counts as a change: it can write rows before it fails, and its run
 * does not carry their count. `updated_at` and not `finished_at`: a scheduled pass closes its run
 * with the time of its tick, and this has to be the time the run really ended.
 */
export async function lastMovementChangeAt(): Promise<Date | null> {
  const changed = sql`coalesce((${syncRuns.counts}->>'created')::int, 0)
    + coalesce((${syncRuns.counts}->>'updated')::int, 0)
    + coalesce((${syncRuns.counts}->>'removed')::int, 0) > 0`;
  const [row] = await getDb()
    .select({ at: syncRuns.updatedAt })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.kind, "transactions"),
        or(eq(syncRuns.state, "failed"), and(eq(syncRuns.state, "success"), changed)),
      ),
    )
    .orderBy(desc(syncRuns.updatedAt))
    .limit(1);
  return row?.at ?? null;
}

/** Opens a sync attempt (spec §10.3 shows the history this builds). */
export async function recordRun(
  ctx: Pick<Ctx, "userId">,
  input: { connectionId: string; kind: SyncKind },
): Promise<SyncRun> {
  await requireConnection(ctx, input.connectionId);
  const [row] = await getDb()
    .insert(syncRuns)
    .values(
      userScoped(ctx).stamp({
        connectionId: input.connectionId,
        kind: input.kind,
        state: "running" as const,
        origin: currentOrigin(),
        appVersion: APP_VERSION,
      }),
    )
    .returning();
  return row;
}

/**
 * Closes the attempt {@link recordRun} opened, and with it everything that depends on the
 * attempt: the run's own row, the schedule of its `sync_jobs` entry, and the connection's health.
 * One transaction, no provider call inside it (spec §4.3) — the caller has already finished
 * talking to the network by the time it gets here.
 *
 * A failure does not overwrite `revoked`: a rejected token stays rejected until a new one is
 * saved, whatever the run that noticed it reported. A success does clear it — the token works.
 */
export async function finishRun(
  ctx: Pick<Ctx, "userId">,
  runId: string,
  outcome: {
    counts: Record<string, number>;
    error?: string;
    /** What was thrown, for its code and its HTTP status (`classifyFailure`); never stored. */
    cause?: unknown;
  },
  now: Date = new Date(),
): Promise<void> {
  const error = outcome.error === undefined ? null : syncErrorText(outcome.error) || null;
  const state = outcomeState({ error });
  // A caller that speaks in codes (a plugin) gives the code as its error.
  const failure =
    state === "success"
      ? { code: null, httpStatus: null }
      : isSyncErrorCode(error) && outcome.cause === undefined
        ? { code: error, httpStatus: null }
        : classifyFailure(outcome.cause ?? { code: error });
  await getDb().transaction(async (tx) => {
    const [run] = await tx
      .select({ state: syncRuns.state, connectionId: syncRuns.connectionId, kind: syncRuns.kind })
      .from(syncRuns)
      .where(and(eq(syncRuns.id, runId), userScoped(ctx).owns(syncRuns)));
    if (!run) throw new IntegrationError("not_found");
    if (run.state !== "running") throw new IntegrationError("run_closed");

    await tx
      .update(syncRuns)
      .set({
        state,
        finishedAt: now,
        counts: normalizeCounts(outcome.counts),
        error,
        errorCode: failure.code,
        httpStatus: failure.httpStatus,
      })
      .where(and(eq(syncRuns.id, runId), userScoped(ctx).owns(syncRuns)));

    await tx
      .insert(syncJobs)
      .values(
        userScoped(ctx).stamp({
          connectionId: run.connectionId,
          kind: run.kind,
          lastRunAt: now,
          nextRunAt: nextRunAt(now),
        }),
      )
      .onConflictDoUpdate({
        target: [syncJobs.connectionId, syncJobs.kind],
        set: { lastRunAt: now, nextRunAt: nextRunAt(now), updatedAt: now },
      });

    // The streak is read back from the runs, this one included: a pass is one run per kind, and
    // only the runs say which kinds are failing now.
    const recent = await tx
      .select({ kind: syncRuns.kind, state: syncRuns.state, errorCode: syncRuns.errorCode })
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, run.connectionId), userScoped(ctx).owns(syncRuns)))
      .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
      .limit(STREAK_RUNS);
    const streak = failureStreak(recent);

    const health =
      connectionStateAfter({ error }) === "active"
        ? { state: "active" as const, lastOkAt: now, lastError: null }
        : { state: "error" as const, lastError: error };
    await tx
      .update(integrationConnections)
      .set({ ...health, errorCode: streak.errorCode, consecutiveFailures: streak.failures })
      .where(
        and(
          eq(integrationConnections.id, run.connectionId),
          userScoped(ctx).owns(integrationConnections),
          health.state === "error" ? ne(integrationConnections.state, "revoked") : undefined,
        ),
      );
  });
}

/** How many runs back the streak of failures is counted: more than any warning asks for. */
const STREAK_RUNS = 40;

/**
 * Closes a run that had nothing to attempt: a `revoked` connection has no work to do, and
 * recording that is more honest than a `success` that proves nothing happened.
 *
 * Deliberately narrower than {@link finishRun}. It leaves the connection's health alone — a
 * skipped run is no evidence the provider answers, and no evidence it does not — and it does not
 * move `sync_jobs` forward: nothing was read, so the next pass is still owed at the time it was
 * already due.
 */
export async function skipRun(
  ctx: Pick<Ctx, "userId">,
  runId: string,
  reason?: string,
  now: Date = new Date(),
): Promise<void> {
  const error = reason === undefined ? null : syncErrorText(reason) || null;
  await getDb().transaction(async (tx) => {
    const [run] = await tx
      .select({ state: syncRuns.state })
      .from(syncRuns)
      .where(and(eq(syncRuns.id, runId), userScoped(ctx).owns(syncRuns)));
    if (!run) throw new IntegrationError("not_found");
    if (run.state !== "running") throw new IntegrationError("run_closed");

    await tx
      .update(syncRuns)
      .set({ state: "skipped", finishedAt: now, counts: {}, error })
      .where(and(eq(syncRuns.id, runId), userScoped(ctx).owns(syncRuns)));
  });
}

const DEFAULT_RUN_PAGE = 20;
const MAX_RUN_PAGE = 200;

/** The log of the readings under "Advanced" (ux §8.3), newest first: the person's own runs only. */
export async function listRuns(
  ctx: Pick<Ctx, "userId">,
  input: { connectionId?: string; limit?: number; since?: Date } = {},
): Promise<SyncRun[]> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_RUN_PAGE, 1), MAX_RUN_PAGE);
  return getDb()
    .select()
    .from(syncRuns)
    .where(
      and(
        userScoped(ctx).owns(syncRuns),
        input.connectionId === undefined ? undefined : eq(syncRuns.connectionId, input.connectionId),
        input.since === undefined ? undefined : gte(syncRuns.startedAt, input.since),
      ),
    )
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(limit);
}

/** A run as the history of a connection reads it: no message, no error text. */
export interface RecentRun {
  connectionId: string;
  kind: SyncKind;
  state: SyncRun["state"];
  origin: string | null;
  errorCode: string | null;
  counts: Record<string, number> | null;
  startedAt: Date;
}

/**
 * The last runs of every connection of the person, newest first, at most `perConnection` each:
 * what the rows of the connections draw their history and "in progress" from, in one query.
 */
export async function recentRuns(
  ctx: Pick<Ctx, "userId">,
  perConnection: number,
  since: Date,
): Promise<RecentRun[]> {
  const ranked = getDb()
    .select({
      connectionId: syncRuns.connectionId,
      kind: syncRuns.kind,
      state: syncRuns.state,
      origin: syncRuns.origin,
      errorCode: syncRuns.errorCode,
      counts: syncRuns.counts,
      startedAt: syncRuns.startedAt,
      id: syncRuns.id,
      place:
        sql<number>`row_number() over (partition by ${syncRuns.connectionId} order by ${syncRuns.startedAt} desc, ${syncRuns.id} desc)`.as(
          "place",
        ),
    })
    .from(syncRuns)
    .where(and(userScoped(ctx).owns(syncRuns), gte(syncRuns.startedAt, since)))
    .as("ranked");
  const rows = await getDb()
    .select()
    .from(ranked)
    .where(lte(ranked.place, perConnection))
    .orderBy(desc(ranked.startedAt), desc(ranked.id));
  return rows.map(({ connectionId, kind, state, origin, errorCode, counts, startedAt }) => ({
    connectionId,
    kind,
    state,
    origin,
    errorCode,
    counts,
    startedAt,
  }));
}

/**
 * Closes the runs nobody is running any more: a process that died in the middle of a pass left
 * its run `running` for ever. Past an hour it is a failed run with the reason `orphaned` — no
 * pass lasts that long — and so is every run started before the worker that starts now
 * (`startedBefore`): it was the worker's. The connection's health is left alone: nothing was
 * learnt about it.
 */
export async function closeOrphanRuns(
  now: Date = new Date(),
  startedBefore: Date = new Date(now.getTime() - ORPHAN_AFTER_MS),
): Promise<number> {
  const closed = await getDb()
    .update(syncRuns)
    .set({ state: "failed", finishedAt: now, error: "orphaned" })
    .where(and(eq(syncRuns.state, "running"), lt(syncRuns.startedAt, startedBefore)))
    .returning({ id: syncRuns.id });
  return closed.length;
}

/**
 * Forgets a code the person has just repaired, on every connection of theirs with a provider: a
 * new key answers `auth` for all the banks it opens.
 */
export async function clearErrorCode(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  code: string,
): Promise<void> {
  await getDb()
    .update(integrationConnections)
    .set({ errorCode: null })
    .where(
      and(
        userScoped(ctx).owns(integrationConnections),
        eq(integrationConnections.provider, provider),
        eq(integrationConnections.errorCode, code),
      ),
    );
}

/** How long a run is kept (rewrite plan, N2: 30 days, the window of the log under "Advanced"). */
export const SYNC_RUN_RETENTION_DAYS = 30;

/**
 * Drops the sync runs past the retention window. Nothing else collects them, and a connection
 * that attempts nothing still records: a revoked token writes two skipped runs an hour, for
 * ever, because {@link skipRun} deliberately does not move `next_run_at`.
 *
 * A run with no `finished_at` — a process killed mid-pass — ages out by `started_at`, exactly as
 * `job_runs` does, so an orphan cannot be kept for ever by the absence of its own end.
 */
export async function deleteOldSyncRuns(cutoff: Date): Promise<number> {
  const deleted = await getDb()
    .delete(syncRuns)
    .where(lt(sql`coalesce(${syncRuns.finishedAt}, ${syncRuns.startedAt})`, cutoff))
    .returning({ id: syncRuns.id });
  return deleted.length;
}
