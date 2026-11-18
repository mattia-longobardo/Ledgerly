import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, lt, ne, or, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import { type KeyRing, openJson, parseKeyRing, sealJson } from "@/platform/crypto";
import { getDb, type Tx } from "@/platform/db/client";
import { civilDateIn } from "@/platform/dates";
import { UNIQUE_VIOLATION, hasPgError } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { readEnv } from "@/platform/env";
import { APP_VERSION } from "@/platform/version";
import { currentOrigin } from "./origin";
import {
  type ConnectionState,
  connectionStateAfter,
  credentialsSchema,
  entityTypeSchema,
  isKnownProvider,
  isPluginProvider,
  nextRunAt,
  normalizeCounts,
  outcomeState,
  pluginConnectionBagSchema,
  type ProviderLink,
  providerLinkSchema,
  SYNC_KINDS,
  type SyncKind,
  syncErrorText,
} from "./rules";
import {
  nextSyncAfterPass,
  nextSyncAt,
  parseSyncSchedule,
  type ScheduleProblem,
  scheduleProblems,
  type SyncSchedule,
  syncScheduleSchema,
} from "./schedule";
import { classifyFailure, failureStreak, isSyncErrorCode, ORPHAN_AFTER_MS } from "./status";
import { users } from "@/platform/auth/schema";
import {
  integrationConnections,
  providerLinks,
  sourceSettings,
  sourceSkippedAccounts,
  syncJobs,
  syncRuns,
} from "./schema";

export type { ProviderLink, SyncKind } from "./rules";
// Re-exported so a caller that wants to write a link inside its own transaction has the type to
// hand without reaching into the database client itself.
export type { Tx } from "@/platform/db/client";

/** Every service failure a caller is expected to handle carries one of these codes. */
export type IntegrationErrorCode =
  | "not_found"
  | "unknown_provider"
  | "invalid_credentials"
  | "invalid_link"
  | "link_conflict"
  | "run_closed"
  | "invalid_schedule";

export class IntegrationError extends Error {
  /** `problems`: why an `invalid_schedule` was refused, for the form to say so. */
  constructor(
    readonly code: IntegrationErrorCode,
    readonly problems: ScheduleProblem[] = [],
  ) {
    super(code);
    this.name = "IntegrationError";
  }
}

/**
 * A connection as everything except {@link readCredentials} sees it: no `credentials` column, so
 * no query outside that one function can carry the sealed blob, let alone its contents.
 */
export interface Connection {
  id: string;
  provider: string;
  /** Which of the provider's connections this is; empty for a provider with one. */
  instanceKey: string;
  /** When the access the person gave ends; null for a provider whose access has no end. */
  expiresAt: Date | null;
  state: ConnectionState;
  lastOkAt: Date | null;
  lastError: string | null;
  /** Why the last reading failed, as a code of the closed list; null when there is none. */
  errorCode: string | null;
  /** The readings that failed in a row. */
  consecutiveFailures: number;
  schedule: SyncSchedule;
  /** The next pass the dispatcher owes (D7); null for a `manual` schedule. */
  nextSyncAt: Date | null;
  /** The accounts whose IBAN a new account of the source carries, at the last reading (N4). Ids only. */
  ibanConflicts: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The columns {@link Connection} is made of, for `select()` and for `returning()`. */
const CONNECTION_COLUMNS = {
  id: integrationConnections.id,
  provider: integrationConnections.provider,
  instanceKey: integrationConnections.instanceKey,
  expiresAt: integrationConnections.expiresAt,
  state: integrationConnections.state,
  lastOkAt: integrationConnections.lastOkAt,
  lastError: integrationConnections.lastError,
  errorCode: integrationConnections.errorCode,
  consecutiveFailures: integrationConnections.consecutiveFailures,
  schedule: integrationConnections.schedule,
  nextSyncAt: integrationConnections.nextSyncAt,
  ibanConflicts: integrationConnections.ibanConflicts,
  createdAt: integrationConnections.createdAt,
  updatedAt: integrationConnections.updatedAt,
};

export type SyncRun = typeof syncRuns.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;

let ring: KeyRing | undefined;

/** The key ring of spec §9.4, parsed once: the first key seals, every key still opens. */
function keyRing(): KeyRing {
  ring ??= parseKeyRing(readEnv().APP_ENCRYPTION_KEY);
  return ring;
}

/** True for the unique violation of one named constraint, wherever drizzle wrapped it. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return hasPgError(error, UNIQUE_VIOLATION, constraint);
}

/** A row as {@link Connection}: the stored schedule read back through its schema. */
function toConnection(row: Omit<Connection, "schedule"> & { schedule: unknown }): Connection {
  return { ...row, schedule: parseSyncSchedule(row.schedule) };
}

/** One connection of the person, or `null`: an id that is somebody else's is an id that is not there. */
export async function findConnection(ctx: Pick<Ctx, "userId">, id: string): Promise<Connection | null> {
  if (!UUID.test(id)) return null;
  const [row] = await getDb()
    .select(CONNECTION_COLUMNS)
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, id), userScoped(ctx).owns(integrationConnections)));
  return row ? toConnection(row) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireConnection(ctx: Pick<Ctx, "userId">, id: string): Promise<Connection> {
  const connection = await findConnection(ctx, id);
  if (!connection) throw new IntegrationError("not_found");
  return connection;
}

/**
 * Stores a provider's credentials, sealed (spec §9.4). A provider allows one connection per user,
 * so saving again replaces the credentials of the existing row rather than adding a second one:
 * pasting a fresh token is how a rejected connection is repaired, and it clears `state` and
 * `last_error` while keeping `last_ok_at` — the last time the provider actually answered is a
 * fact, not an opinion.
 *
 * The plaintext lives only in this function's arguments: it is sealed before the insert, so it is
 * never a query parameter either, and a failed statement cannot print it.
 */
export async function saveConnection(
  ctx: Pick<Ctx, "userId">,
  input: { provider: string; credentials: Record<string, string> },
): Promise<Connection> {
  const provider = input.provider.trim();
  if (!isKnownProvider(provider)) throw new IntegrationError("unknown_provider");
  // The schema's own error is dropped on purpose: its issues name the keys they rejected, and a
  // credential bag has no business in a stack trace.
  const parsed = credentialsSchema.safeParse(input.credentials);
  if (!parsed.success) throw new IntegrationError("invalid_credentials");
  const credentials = sealJson(keyRing(), parsed.data);
  return getDb().transaction(async (tx) => {
    // What "Disconnect" kept of the last connection of this source comes back with the new one.
    const [kept] = await tx
      .delete(sourceSettings)
      .where(
        and(
          userScoped(ctx).owns(sourceSettings),
          eq(sourceSettings.provider, provider),
          eq(sourceSettings.instanceKey, ""),
        ),
      )
      .returning({ schedule: sourceSettings.schedule, cursors: sourceSettings.cursors });
    const [row] = await tx
      .insert(integrationConnections)
      // A new connection is due at once: the next tick of the dispatcher makes its first pass (D7).
      .values(
        userScoped(ctx).stamp({
          provider,
          credentials,
          state: "active" as const,
          nextSyncAt: new Date(),
          ...(kept ? { schedule: parseSyncSchedule(kept.schedule) } : {}),
        }),
      )
      .onConflictDoUpdate({
        // A provider of the core has one connection: its instance key is always the empty one. The
        // key on (user, provider) alone went with N2 (06-data.md §6.1).
        target: [
          integrationConnections.userId,
          integrationConnections.provider,
          integrationConnections.instanceKey,
        ],
        set: {
          credentials,
          state: "active" as const,
          lastError: null,
          errorCode: null,
          consecutiveFailures: 0,
          updatedAt: new Date(),
        },
      })
      .returning(CONNECTION_COLUMNS);
    for (const [kind, cursor] of Object.entries(kept?.cursors ?? {})) {
      if (!(SYNC_KINDS as readonly string[]).includes(kind)) continue;
      await tx
        .insert(syncJobs)
        .values(userScoped(ctx).stamp({ connectionId: row.id, kind: kind as SyncKind, cursor }))
        .onConflictDoNothing();
    }
    return toConnection(row);
  });
}

/**
 * Stores the access a plugin got for one of a person's connections, sealed like every credential.
 * A plugin has one connection per `instanceKey` (a bank), so saving again for the same key
 * replaces the access: that is what renewing is. A person has as many connections as banks.
 *
 * The connection is not scheduled here: its schedule has no rule, so the dispatcher never asks
 * for a pass nobody has registered.
 */
export async function savePluginConnection(
  ctx: Pick<Ctx, "userId">,
  input: {
    provider: string;
    instanceKey: string;
    credentials: Record<string, string>;
    expiresAt: Date | null;
  },
  now: Date = new Date(),
): Promise<Connection> {
  const provider = input.provider.trim();
  const instanceKey = input.instanceKey.trim();
  if (!isPluginProvider(provider)) throw new IntegrationError("unknown_provider");
  if (instanceKey.length < 1 || instanceKey.length > 200) throw new IntegrationError("invalid_credentials");
  const parsed = pluginConnectionBagSchema.safeParse(input.credentials);
  if (!parsed.success) throw new IntegrationError("invalid_credentials");
  const credentials = sealJson(keyRing(), parsed.data);
  const [row] = await getDb()
    .insert(integrationConnections)
    .values(
      userScoped(ctx).stamp({
        provider,
        instanceKey,
        credentials,
        expiresAt: input.expiresAt,
        state: "active" as const,
        schedule: { rules: [] },
        nextSyncAt: null,
      }),
    )
    .onConflictDoUpdate({
      target: [
        integrationConnections.userId,
        integrationConnections.provider,
        integrationConnections.instanceKey,
      ],
      set: {
        credentials,
        expiresAt: input.expiresAt,
        state: "active" as const,
        lastError: null,
        // A new access ends what the old one's end had said; any other code waits for a reading.
        errorCode: sql`nullif(${integrationConnections.errorCode}, 'consent_expired')`,
        updatedAt: now,
      },
    })
    .returning(CONNECTION_COLUMNS);
  return toConnection(row);
}

/**
 * The one place credentials come back in the clear, for the one caller that has to speak to the
 * provider. Nothing else — no list, no page, no log — reads the column.
 */
export async function readCredentials(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
): Promise<Record<string, string>> {
  const [row] = await getDb()
    .select({ credentials: integrationConnections.credentials })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), userScoped(ctx).owns(integrationConnections)));
  if (!row) throw new IntegrationError("not_found");
  return openJson(keyRing(), row.credentials);
}

export async function listConnections(ctx: Pick<Ctx, "userId">): Promise<Connection[]> {
  const rows = await getDb()
    .select(CONNECTION_COLUMNS)
    .from(integrationConnections)
    .where(userScoped(ctx).owns(integrationConnections))
    .orderBy(asc(integrationConnections.provider), asc(integrationConnections.id));
  return rows.map(toConnection);
}

/* The schedule of a connection (docs/scheduler.md) */

/**
 * Saves when a connection syncs and works out its next pass in the person's zone. The schedule
 * comes from a form, so it is parsed here and refused as `invalid_schedule` when it is not a list
 * of valid rules, when a rule never runs, or when two passes would come closer than the minimum
 * gap; "Sync now" never goes through here and never moves `next_sync_at`.
 */
export async function saveSchedule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  connectionId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<Connection> {
  const parsed = syncScheduleSchema.safeParse(input);
  if (!parsed.success) throw new IntegrationError("invalid_schedule");
  const problems = scheduleProblems(parsed.data, civilDateIn(now, ctx.timeZone));
  if (problems.length > 0) throw new IntegrationError("invalid_schedule", problems);
  const [row] = await getDb()
    .update(integrationConnections)
    .set({ schedule: parsed.data, nextSyncAt: nextSyncAt(parsed.data, ctx.timeZone, now), updatedAt: now })
    .where(and(eq(integrationConnections.id, connectionId), userScoped(ctx).owns(integrationConnections)))
    .returning(CONNECTION_COLUMNS);
  if (!row) throw new IntegrationError("not_found");
  return toConnection(row);
}

/**
 * Moves a connection's next pass on after the dispatcher has made one (or has tried to) for the
 * slot `connection.nextSyncAt`: the first slot after `now`, never closer than the minimum gap.
 */
export async function advanceSchedule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  connection: Pick<Connection, "id" | "schedule" | "nextSyncAt">,
  now: Date = new Date(),
): Promise<Date | null> {
  const next = nextSyncAfterPass(connection.schedule, ctx.timeZone, connection.nextSyncAt, now);
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: next })
    .where(and(eq(integrationConnections.id, connection.id), userScoped(ctx).owns(integrationConnections)));
  return next;
}

/**
 * Recomputes every connection's next pass of one person, for when their time zone changed: the
 * times of a schedule are local times, so "07:00" has to follow the person to their new zone.
 */
export async function rescheduleConnections(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<number> {
  const connections = await listConnections(ctx);
  for (const connection of connections) {
    await getDb()
      .update(integrationConnections)
      .set({ nextSyncAt: nextSyncAt(connection.schedule, ctx.timeZone, now) })
      .where(and(eq(integrationConnections.id, connection.id), userScoped(ctx).owns(integrationConnections)));
  }
  return connections.length;
}

/**
 * Makes every scheduled connection of the person with one provider due now: the next tick of the
 * dispatcher reads them. For a provider the person has just turned on again (decision H30).
 */
export async function makeDueNow(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  now: Date = new Date(),
): Promise<void> {
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: now })
    .where(
      and(
        userScoped(ctx).owns(integrationConnections),
        eq(integrationConnections.provider, provider),
        sql`${integrationConnections.nextSyncAt} is not null`,
      ),
    );
}

/** A connection the dispatcher owes a pass: whose, which provider, on what schedule, since when. */
export interface DueConnection {
  id: string;
  userId: string;
  provider: string;
  schedule: SyncSchedule;
  nextSyncAt: Date | null;
}

/** Which connections the dispatcher may pass: not revoked, and not of a banned person. */
function dueWhere(now: Date) {
  return and(
    lte(integrationConnections.nextSyncAt, now),
    ne(integrationConnections.state, "revoked"),
    or(isNull(users.banned), eq(users.banned, false)),
  );
}

/**
 * Every connection whose next pass is due, across all users, oldest debt first. An `error`
 * connection is included, because it must keep being retried. A `revoked` one is not, nor any
 * connection of a banned person (PERS-49 SEC-08): a refused token waits for a new one, and a
 * blocked account makes no outbound call. "Sync now" and a new token still reach them.
 */
export async function dueConnections(now: Date = new Date()): Promise<DueConnection[]> {
  const rows = await getDb()
    .select({
      id: integrationConnections.id,
      userId: integrationConnections.userId,
      provider: integrationConnections.provider,
      schedule: integrationConnections.schedule,
      nextSyncAt: integrationConnections.nextSyncAt,
    })
    .from(integrationConnections)
    .innerJoin(users, eq(users.id, integrationConnections.userId))
    .where(dueWhere(now))
    .orderBy(asc(integrationConnections.nextSyncAt), asc(integrationConnections.id));
  return rows.map((row) => ({ ...row, schedule: parseSyncSchedule(row.schedule) }));
}

/**
 * Whether any connection is due: the minute tick asks this first, so a minute with nothing to do
 * writes no `job_runs` row (one index probe on `next_sync_at`).
 */
export async function anyConnectionDue(now: Date = new Date()): Promise<boolean> {
  const rows = await getDb()
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .innerJoin(users, eq(users.id, integrationConnections.userId))
    .where(dueWhere(now))
    .limit(1);
  return rows.length > 0;
}

/**
 * The keys of a cursor that are the person's settings rather than where a reading stands: they
 * outlive "Disconnect" (H55, point 4). How deep the history goes (`BACKFILL_MONTHS` of
 * `wallet/depth.ts`, a string here so the core imports no source) is the only one.
 */
const SETTING_KEYS: Partial<Record<SyncKind, readonly string[]>> = { transactions: ["backfillMonths"] };

/**
 * Disconnects a provider: the credentials and the connection's own history (`sync_jobs`,
 * `sync_runs`, by cascade) go, and `provider_links` stays.
 *
 * Keeping the links is what makes reconnecting safe: the provider's ids still point at the rows
 * they created, so the next sync recognises them instead of importing everything a second time.
 * A link is removed by the module that owns its entity, through {@link unlinkEntities}.
 *
 * The settings stay too (H55, point 4): the schedule and the setting keys of the cursors of a
 * provider of the core wait in `source_settings`, and {@link saveConnection} takes them back. The
 * accounts left out are a memory of the core already (`source_skipped_accounts`).
 */
export async function deleteConnection(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const owned = and(
      eq(integrationConnections.id, connectionId),
      userScoped(ctx).owns(integrationConnections),
    );
    const [connection] = await tx
      .select({
        provider: integrationConnections.provider,
        instanceKey: integrationConnections.instanceKey,
        schedule: integrationConnections.schedule,
      })
      .from(integrationConnections)
      .where(owned)
      .for("update");
    if (!connection) throw new IntegrationError("not_found");
    if (isKnownProvider(connection.provider)) {
      const jobs = await tx
        .select({ kind: syncJobs.kind, cursor: syncJobs.cursor })
        .from(syncJobs)
        .where(and(eq(syncJobs.connectionId, connectionId), userScoped(ctx).owns(syncJobs)))
        .orderBy(asc(syncJobs.kind));
      const cursors: Record<string, Record<string, string>> = {};
      for (const job of jobs) {
        const kept = Object.entries(job.cursor ?? {}).filter(([key]) =>
          SETTING_KEYS[job.kind]?.includes(key),
        );
        if (kept.length > 0) cursors[job.kind] = Object.fromEntries(kept);
      }
      const settings = { schedule: connection.schedule, cursors };
      await tx
        .insert(sourceSettings)
        .values(
          userScoped(ctx).stamp({
            provider: connection.provider,
            instanceKey: connection.instanceKey,
            ...settings,
          }),
        )
        .onConflictDoUpdate({
          target: [sourceSettings.userId, sourceSettings.provider, sourceSettings.instanceKey],
          set: settings,
        });
    }
    await tx.delete(integrationConnections).where(owned);
  });
}

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

/**
 * Records that a provider's `externalId` stands for a local entity, or that it still does.
 *
 * `first_seen_at` is written once and never rewritten, while `last_seen_at` moves and
 * `missing_since` clears: that is the whole of the idempotency promise, so running the same sync
 * twice produces the same row rather than a second one. The second unique key does the other
 * half — one local entity cannot be claimed by two of a provider's ids — and a caller that tries
 * gets `link_conflict` instead of a raw database error.
 *
 * `tx` makes this the sink of spec §4.2: a module that creates a row and its link writes both
 * inside its own transaction, so the pair either exists or does not. Without it, a process that
 * died between the two commits would leave a row no `resolveExternal` can find, and the next pass
 * would import it a second time — a movement counted twice is wrong money in every total.
 *
 * With `tx`, a `link_conflict` has already aborted the caller's transaction by the time it is
 * thrown: Postgres does not survive a constraint violation mid-transaction. The caller catches it
 * to decide *what to say*, not to carry on writing — every statement of that transaction, its own
 * row included, is gone. Deciding beforehand (`resolveExternal`) is the way to avoid the throw.
 */
export async function linkExternal(
  ctx: Pick<Ctx, "userId">,
  input: ProviderLink,
  now: Date = new Date(),
  tx?: Tx,
): Promise<void> {
  const parsed = providerLinkSchema.safeParse(input);
  if (!parsed.success) throw new IntegrationError("invalid_link");
  const link = parsed.data;
  try {
    await (tx ?? getDb())
      .insert(providerLinks)
      .values(
        userScoped(ctx).stamp({
          provider: link.provider,
          entityType: link.entityType,
          entityId: link.entityId,
          externalId: link.externalId,
          metadata: link.metadata,
          firstSeenAt: now,
          lastSeenAt: now,
        }),
      )
      .onConflictDoUpdate({
        target: [
          providerLinks.userId,
          providerLinks.provider,
          providerLinks.entityType,
          providerLinks.externalId,
        ],
        set: {
          entityId: link.entityId,
          lastSeenAt: now,
          missingSince: null,
          updatedAt: now,
          ...(link.metadata === null ? {} : { metadata: link.metadata }),
        },
      });
  } catch (error) {
    if (isUniqueViolation(error, "provider_links_entity_uq")) {
      throw new IntegrationError("link_conflict");
    }
    throw error;
  }
}

/**
 * The other direction of {@link resolveExternal}: local entities mapped to the provider's own ids
 * (`entity_id` → `external_id`), for a caller that holds a local row and has to name it to the
 * provider — F4's interest posting, which files its Wallet record under the *provider's* id of the
 * category the rule was given (spec §7.6, §9.1).
 *
 * An entity with no link is simply absent from the map: "this local row has no counterpart at the
 * provider" is an answer, never an error, and never a reason to invent one.
 */
export async function externalIdsOf(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: string,
  entityIds: readonly string[],
): Promise<Map<string, string>> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(entityIds)];
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select({ entityId: providerLinks.entityId, externalId: providerLinks.externalId })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, provider),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.entityId, wanted),
      ),
    )
    .orderBy(asc(providerLinks.entityId), asc(providerLinks.externalId));
  // One local entity holds at most one link per provider and type (`provider_links_entity_uq`),
  // so the first row per entity is the only row; the order makes even a violated key deterministic.
  const found = new Map<string, string>();
  for (const row of rows) if (!found.has(row.entityId)) found.set(row.entityId, row.externalId);
  return found;
}

/** A provider's own ids, mapped to the local entities they stand for (`external_id` → `entity_id`). */
export async function resolveExternal(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(externalIds)];
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select({ externalId: providerLinks.externalId, entityId: providerLinks.entityId })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, provider),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.externalId, wanted),
      ),
    )
    .orderBy(asc(providerLinks.externalId));
  return new Map(rows.map((row) => [row.externalId, row.entityId]));
}

/**
 * Forgets the links of entities that no longer exist here. Called by the module that owns them:
 * a deleted local row must not leave a link behind holding its half of the entity unique key,
 * claiming a `first_seen_at` for a row nothing can resolve any more (`entity_id` is not a real
 * foreign key — the deviation of §11.4 — so no cascade does this for us).
 *
 * `missing_since` is written by nobody. The disappearance of §7.2 is decided and applied in the
 * transactions module, from the re-read window, and a second copy of that rule here would be a
 * second source of truth (§4.3). The column stays because §4.3 fixes the shape of this table and
 * changing it would take a second migration; {@link linkExternal} only ever clears it.
 */
export async function unlinkEntities(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: string,
  entityIds: string[],
  tx?: Tx,
): Promise<number> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(entityIds)];
  if (wanted.length === 0) return 0;
  const deleted = await (tx ?? getDb())
    .delete(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, provider),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.entityId, wanted),
      ),
    )
    .returning({ id: providerLinks.id });
  return deleted.length;
}

/**
 * {@link unlinkEntities} for every provider at once: what a deleted account took with it may have
 * come from more than one source (an account switched from one to another keeps the links of both).
 */
export async function unlinkEntitiesOfEveryProvider(
  ctx: Pick<Ctx, "userId">,
  entityType: string,
  entityIds: string[],
): Promise<number> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(entityIds)];
  if (wanted.length === 0) return 0;
  const deleted = await getDb()
    .delete(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.entityId, wanted),
      ),
    )
    .returning({ id: providerLinks.id });
  return deleted.length;
}

/** Where a connection's sync stands for one kind: the cursor to resume from and when to run. */
export async function readSyncJob(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  kind: SyncKind,
): Promise<SyncJob | null> {
  const [row] = await getDb()
    .select()
    .from(syncJobs)
    .where(
      and(eq(syncJobs.connectionId, connectionId), eq(syncJobs.kind, kind), userScoped(ctx).owns(syncJobs)),
    );
  return row ?? null;
}

/**
 * Moves a sync's state forward. Only the fields present in `patch` change, so writing a cursor
 * does not reset the schedule and rescheduling does not lose the cursor.
 */
export async function saveSyncJob(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  kind: SyncKind,
  patch: {
    cursor?: Record<string, string> | null;
    nextRunAt?: Date | null;
    lastRunAt?: Date | null;
  },
  now: Date = new Date(),
  /** The caller's transaction, so a cursor commits with the data it describes (A7). */
  tx?: Tx,
): Promise<SyncJob> {
  await requireConnection(ctx, connectionId);
  // `undefined` means "leave this alone": dropping those keys is what keeps a cursor write from
  // clearing the schedule. `updated_at` is set by hand because `$onUpdate` does not reach an
  // upsert's `set`, which would otherwise leave the row claiming it was never touched.
  const changes = {
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    updatedAt: now,
  };
  const [row] = await (tx ?? getDb())
    .insert(syncJobs)
    .values(userScoped(ctx).stamp({ connectionId, kind, ...changes }))
    .onConflictDoUpdate({ target: [syncJobs.connectionId, syncJobs.kind], set: changes })
    .returning();
  return row;
}

/* The accounts of a source the person did not choose (PERS-419, H55 point 5) */

/**
 * The source's ids of the accounts a source does not bring here: the accounts the person left out,
 * or deleted. A reading neither creates nor updates them. A memory of the core, per source and not
 * per connection: it stays when the source is disconnected. Empty when the person never left one out.
 */
export async function sourceSkippedIds(ctx: Pick<Ctx, "userId">, provider: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ externalId: sourceSkippedAccounts.externalId })
    .from(sourceSkippedAccounts)
    .where(and(userScoped(ctx).owns(sourceSkippedAccounts), eq(sourceSkippedAccounts.provider, provider)))
    .orderBy(asc(sourceSkippedAccounts.externalId));
  return new Set(rows.map((row) => row.externalId));
}

/** Adds accounts to the ones a source does not bring here, and takes others out of it. */
export async function changeSourceSkippedIds(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  change: { add?: Iterable<string>; remove?: Iterable<string> },
): Promise<void> {
  const add = [...new Set(change.add ?? [])];
  const remove = [...new Set(change.remove ?? [])].filter((id) => !add.includes(id));
  if (remove.length > 0) {
    await getDb()
      .delete(sourceSkippedAccounts)
      .where(
        and(
          userScoped(ctx).owns(sourceSkippedAccounts),
          eq(sourceSkippedAccounts.provider, provider),
          inArray(sourceSkippedAccounts.externalId, remove),
        ),
      );
  }
  if (add.length > 0) {
    await getDb()
      .insert(sourceSkippedAccounts)
      .values(add.map((externalId) => userScoped(ctx).stamp({ provider, externalId })))
      .onConflictDoNothing();
  }
}

/** The accounts a connection's source does not bring here ({@link sourceSkippedIds}). */
export async function skippedAccounts(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<Set<string>> {
  const connection = await requireConnection(ctx, connectionId);
  return sourceSkippedIds(ctx, connection.provider);
}

/** Writes the accounts a connection's source does not bring here: exactly `ids`, no other. */
export async function saveSkippedAccounts(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  ids: Iterable<string>,
): Promise<void> {
  const connection = await requireConnection(ctx, connectionId);
  const wanted = new Set(ids);
  const before = await sourceSkippedIds(ctx, connection.provider);
  await changeSourceSkippedIds(ctx, connection.provider, {
    add: wanted,
    remove: [...before].filter((id) => !wanted.has(id)),
  });
}

/**
 * A deleted account leaves the accounts its source brings here, so no later reading makes it
 * again: with the source connected, disconnected or connected again (H55, point 5). Returns false
 * for a source Ledgerly does not know.
 */
export async function skipSourceAccount(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  providerAccountId: string,
  /** The account's name here, for "Bring back" on the source's page (plugin-settings.md §3.4). */
  name: string | null = null,
): Promise<boolean> {
  if (!isKnownProvider(provider) && !isPluginProvider(provider)) return false;
  const deleted = { reason: "deleted" as const, name };
  await getDb()
    .insert(sourceSkippedAccounts)
    .values(userScoped(ctx).stamp({ provider, externalId: providerAccountId, ...deleted }))
    .onConflictDoUpdate({
      target: [
        sourceSkippedAccounts.userId,
        sourceSkippedAccounts.provider,
        sourceSkippedAccounts.externalId,
      ],
      set: deleted,
    });
  return true;
}

/** The accounts of a source deleted here, for "Deleted in Ledgerly · Bring back" (§3.4), by name. */
export async function deletedSourceAccounts(
  ctx: Pick<Ctx, "userId">,
  provider: string,
): Promise<{ externalId: string; name: string | null }[]> {
  return getDb()
    .select({ externalId: sourceSkippedAccounts.externalId, name: sourceSkippedAccounts.name })
    .from(sourceSkippedAccounts)
    .where(
      and(
        userScoped(ctx).owns(sourceSkippedAccounts),
        eq(sourceSkippedAccounts.provider, provider),
        eq(sourceSkippedAccounts.reason, "deleted"),
      ),
    )
    .orderBy(asc(sourceSkippedAccounts.name), asc(sourceSkippedAccounts.externalId));
}

/**
 * The source's ids of every entity of one type it gave, mapped to the local entity
 * (`external_id` → `entity_id`): what "Turn on" again ties back (plugin-settings.md §3.4).
 */
export async function linksOf(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: string,
): Promise<Map<string, string>> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const rows = await getDb()
    .select({ externalId: providerLinks.externalId, entityId: providerLinks.entityId })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, provider),
        eq(providerLinks.entityType, type.data),
      ),
    )
    .orderBy(asc(providerLinks.externalId));
  return new Map(rows.map((row) => [row.externalId, row.entityId]));
}

/** Every source's id of one local entity: a converted account keeps them here (§3.2). */
export async function linksOfEntity(
  ctx: Pick<Ctx, "userId">,
  entityType: string,
  entityId: string,
): Promise<{ provider: string; externalId: string }[]> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  return getDb()
    .select({ provider: providerLinks.provider, externalId: providerLinks.externalId })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.entityType, type.data),
        eq(providerLinks.entityId, entityId),
      ),
    )
    .orderBy(asc(providerLinks.provider), asc(providerLinks.externalId));
}

/**
 * "Turn off" a source (plugin-settings.md §3.2), the part of this platform, inside the caller's
 * transaction: every connection of the source goes, with its sync jobs and its log (`on delete
 * cascade`), and so do the settings a "Disconnect" kept and the accounts the person left out. The
 * accounts deleted here stay left out (§3.4), and `provider_links` stays: nobody sees it, and it
 * is what keeps a source turned on again from bringing doubles. Returns how many connections went.
 */
export async function forgetSource(tx: Tx, ctx: Pick<Ctx, "userId">, provider: string): Promise<number> {
  const gone = await tx
    .delete(integrationConnections)
    .where(and(userScoped(ctx).owns(integrationConnections), eq(integrationConnections.provider, provider)))
    .returning({ id: integrationConnections.id });
  await tx
    .delete(sourceSettings)
    .where(and(userScoped(ctx).owns(sourceSettings), eq(sourceSettings.provider, provider)));
  await tx
    .delete(sourceSkippedAccounts)
    .where(
      and(
        userScoped(ctx).owns(sourceSkippedAccounts),
        eq(sourceSkippedAccounts.provider, provider),
        eq(sourceSkippedAccounts.reason, "excluded"),
      ),
    );
  return gone.length;
}

/**
 * Says out loud what the provider answered: `active` after a good call, `error` after a bad one,
 * `revoked` when the token itself was refused (spec §9.1: a 401 or 403 fails immediately). Kept
 * apart from {@link finishRun}, which cannot tell a refused token from a bad afternoon.
 */
/**
 * The accounts here whose IBAN a new account of the source carries, as the last reading found them
 * (rewrite plan N4, case 5): the row of the connection shows a notice while the list is not empty.
 * Every reading writes it again, so the notice goes when the reason goes. Ids only.
 */
export async function saveIbanConflicts(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  accountIds: readonly string[],
): Promise<void> {
  await getDb()
    .update(integrationConnections)
    .set({ ibanConflicts: accountIds.length === 0 ? null : [...accountIds] })
    .where(and(eq(integrationConnections.id, connectionId), userScoped(ctx).owns(integrationConnections)));
}

export async function markConnection(
  ctx: Pick<Ctx, "userId">,
  connectionId: string,
  state: ConnectionState,
  error?: string,
  now: Date = new Date(),
): Promise<Connection> {
  const [row] = await getDb()
    .update(integrationConnections)
    .set(
      state === "active"
        ? { state, lastOkAt: now, lastError: null, errorCode: null, consecutiveFailures: 0 }
        : {
            state,
            lastError: error === undefined ? null : syncErrorText(error) || null,
            // A refused credential is `auth`, unless the caller named the code itself.
            ...(isSyncErrorCode(error)
              ? { errorCode: error }
              : state === "revoked"
                ? { errorCode: "auth" }
                : {}),
          },
    )
    .where(and(eq(integrationConnections.id, connectionId), userScoped(ctx).owns(integrationConnections)))
    .returning(CONNECTION_COLUMNS);
  if (!row) throw new IntegrationError("not_found");
  return toConnection(row);
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
 * pass lasts that long. The connection's health is left alone: nothing was learnt about it.
 */
export async function closeOrphanRuns(now: Date = new Date()): Promise<number> {
  const closed = await getDb()
    .update(syncRuns)
    .set({ state: "failed", finishedAt: now, error: "orphaned" })
    .where(
      and(eq(syncRuns.state, "running"), lt(syncRuns.startedAt, new Date(now.getTime() - ORPHAN_AFTER_MS))),
    )
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
