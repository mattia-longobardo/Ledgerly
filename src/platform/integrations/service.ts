import "server-only";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type { Ctx } from "@/platform/context";
import { type KeyRing, openJson, parseKeyRing, sealJson } from "@/platform/crypto";
import { getDb, type Tx } from "@/platform/db/client";
import { UNIQUE_VIOLATION, hasPgError } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { readEnv } from "@/platform/env";
import {
  type ConnectionState,
  connectionStateAfter,
  credentialsSchema,
  entityTypeSchema,
  isKnownProvider,
  nextRunAt,
  normalizeCounts,
  outcomeState,
  type ProviderLink,
  providerLinkSchema,
  type SyncKind,
  syncErrorText,
} from "./rules";
import { integrationConnections, providerLinks, syncJobs, syncRuns } from "./schema";

export type { ProviderLink, SyncKind } from "./rules";
// Re-exported so a caller that wants to write a link inside its own transaction has the type to
// hand without reaching into the database client itself.
export type { Tx } from "@/platform/db/client";

/** Every service failure a caller is expected to handle carries one of these codes. */
export type IntegrationErrorCode =
  "not_found" | "unknown_provider" | "invalid_credentials" | "invalid_link" | "link_conflict" | "run_closed";

export class IntegrationError extends Error {
  constructor(readonly code: IntegrationErrorCode) {
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
  state: ConnectionState;
  lastOkAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The columns {@link Connection} is made of, for `select()` and for `returning()`. */
const CONNECTION_COLUMNS = {
  id: integrationConnections.id,
  provider: integrationConnections.provider,
  state: integrationConnections.state,
  lastOkAt: integrationConnections.lastOkAt,
  lastError: integrationConnections.lastError,
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

async function requireConnection(ctx: Pick<Ctx, "userId">, id: string): Promise<Connection> {
  const [row] = await getDb()
    .select(CONNECTION_COLUMNS)
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, id), userScoped(ctx).owns(integrationConnections)));
  if (!row) throw new IntegrationError("not_found");
  return row;
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
  const [row] = await getDb()
    .insert(integrationConnections)
    .values(userScoped(ctx).stamp({ provider, credentials, state: "active" as const }))
    .onConflictDoUpdate({
      target: [integrationConnections.userId, integrationConnections.provider],
      set: { credentials, state: "active" as const, lastError: null, updatedAt: new Date() },
    })
    .returning(CONNECTION_COLUMNS);
  return row;
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
  return getDb()
    .select(CONNECTION_COLUMNS)
    .from(integrationConnections)
    .where(userScoped(ctx).owns(integrationConnections))
    .orderBy(asc(integrationConnections.provider), asc(integrationConnections.id));
}

/**
 * Disconnects a provider: the credentials and the connection's own history (`sync_jobs`,
 * `sync_runs`, by cascade) go, and `provider_links` stays.
 *
 * Keeping the links is what makes reconnecting safe: the provider's ids still point at the rows
 * they created, so the next sync recognises them instead of importing everything a second time.
 * A link is removed by the module that owns its entity, through {@link unlinkEntities}.
 */
export async function deleteConnection(ctx: Pick<Ctx, "userId">, connectionId: string): Promise<void> {
  const deleted = await getDb()
    .delete(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), userScoped(ctx).owns(integrationConnections)))
    .returning({ id: integrationConnections.id });
  if (deleted.length === 0) throw new IntegrationError("not_found");
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
  outcome: { counts: Record<string, number>; error?: string },
  now: Date = new Date(),
): Promise<void> {
  const error = outcome.error === undefined ? null : syncErrorText(outcome.error) || null;
  const state = outcomeState({ error });
  await getDb().transaction(async (tx) => {
    const [run] = await tx
      .select({ state: syncRuns.state, connectionId: syncRuns.connectionId, kind: syncRuns.kind })
      .from(syncRuns)
      .where(and(eq(syncRuns.id, runId), userScoped(ctx).owns(syncRuns)));
    if (!run) throw new IntegrationError("not_found");
    if (run.state !== "running") throw new IntegrationError("run_closed");

    await tx
      .update(syncRuns)
      .set({ state, finishedAt: now, counts: normalizeCounts(outcome.counts), error })
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

    const health =
      connectionStateAfter({ error }) === "active"
        ? { state: "active" as const, lastOkAt: now, lastError: null }
        : { state: "error" as const, lastError: error };
    await tx
      .update(integrationConnections)
      .set(health)
      .where(
        and(
          eq(integrationConnections.id, run.connectionId),
          userScoped(ctx).owns(integrationConnections),
          health.state === "error" ? ne(integrationConnections.state, "revoked") : undefined,
        ),
      );
  });
}

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
        eq(providerLinks.provider, provider),
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
): Promise<SyncJob> {
  await requireConnection(ctx, connectionId);
  // `undefined` means "leave this alone": dropping those keys is what keeps a cursor write from
  // clearing the schedule. `updated_at` is set by hand because `$onUpdate` does not reach an
  // upsert's `set`, which would otherwise leave the row claiming it was never touched.
  const changes = {
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    updatedAt: now,
  };
  const [row] = await getDb()
    .insert(syncJobs)
    .values(userScoped(ctx).stamp({ connectionId, kind, ...changes }))
    .onConflictDoUpdate({ target: [syncJobs.connectionId, syncJobs.kind], set: changes })
    .returning();
  return row;
}

/**
 * Says out loud what the provider answered: `active` after a good call, `error` after a bad one,
 * `revoked` when the token itself was refused (spec §9.1: a 401 or 403 fails immediately). Kept
 * apart from {@link finishRun}, which cannot tell a refused token from a bad afternoon.
 */
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
        ? { state, lastOkAt: now, lastError: null }
        : { state, lastError: error === undefined ? null : syncErrorText(error) || null },
    )
    .where(and(eq(integrationConnections.id, connectionId), userScoped(ctx).owns(integrationConnections)))
    .returning(CONNECTION_COLUMNS);
  if (!row) throw new IntegrationError("not_found");
  return row;
}

const DEFAULT_RUN_PAGE = 20;
const MAX_RUN_PAGE = 200;

/** The sync history Settings › Integrations shows (spec §10.3), newest first. */
export async function listRuns(
  ctx: Pick<Ctx, "userId">,
  input: { connectionId?: string; limit?: number } = {},
): Promise<SyncRun[]> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_RUN_PAGE, 1), MAX_RUN_PAGE);
  return getDb()
    .select()
    .from(syncRuns)
    .where(
      and(
        userScoped(ctx).owns(syncRuns),
        input.connectionId === undefined ? undefined : eq(syncRuns.connectionId, input.connectionId),
      ),
    )
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(limit);
}

/**
 * Drops the sync runs past the retention window (spec §10.2: "executions and logs older than 90
 * days" — a sync run is an execution). Nothing else collects them, and a connection that attempts
 * nothing still records: a revoked token writes two skipped runs an hour, for ever, because
 * {@link skipRun} deliberately does not move `next_run_at`.
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
