import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Ctx } from "../../context";
import { getDb, type Tx } from "../../db/client";
import { userScoped } from "../../db/scope";
import {
  type ConnectionState,
  entityTypeSchema,
  isKnownProvider,
  isPluginProvider,
  type SyncKind,
  syncErrorText,
} from "../rules";
import { isSyncErrorCode, ORPHAN_AFTER_MS } from "../status";
import {
  integrationConnections,
  providerLinks,
  sourceSettings,
  sourceSkippedAccounts,
  syncJobs,
  syncRuns,
} from "../schema";
import {
  CONNECTION_COLUMNS,
  IntegrationError,
  requireConnection,
  toConnection,
  type Connection,
  type SyncJob,
} from "./connections";

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

/** The person's runs of these connections that are running. */
const runningRunsOf = (ctx: Pick<Ctx, "userId">, connectionIds: readonly string[]) =>
  and(
    userScoped(ctx).owns(syncRuns),
    inArray(syncRuns.connectionId, [...connectionIds]),
    eq(syncRuns.state, "running"),
  );

/**
 * When the oldest reading of these connections that is running now started (a run younger than the
 * orphan limit), or null when none runs: "Turn off" waits for none, as a reading that goes on would
 * write the source's rows again, and the refusal says since when it waits (H56).
 */
export async function runningSince(
  ctx: Pick<Ctx, "userId">,
  connectionIds: readonly string[],
  now: Date = new Date(),
): Promise<Date | null> {
  if (connectionIds.length === 0) return null;
  const [row] = await getDb()
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(
      and(
        runningRunsOf(ctx, connectionIds),
        gte(syncRuns.startedAt, new Date(now.getTime() - ORPHAN_AFTER_MS)),
      ),
    )
    .orderBy(asc(syncRuns.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

/**
 * Stops the readings of these connections that started before `before` and still run (H56, D3 = A):
 * they end as failed now, so "Turn off" no longer waits for them. Returns how many stopped.
 */
export async function stopReadings(
  ctx: Pick<Ctx, "userId">,
  connectionIds: readonly string[],
  before: Date,
  now: Date = new Date(),
): Promise<number> {
  if (connectionIds.length === 0) return 0;
  const rows = await getDb()
    .update(syncRuns)
    .set({ state: "failed", finishedAt: now })
    .where(and(runningRunsOf(ctx, connectionIds), lt(syncRuns.startedAt, before)))
    .returning({ id: syncRuns.id });
  return rows.length;
}

/**
 * The source each of these accounts came from before it was kept by hand (H55: the conversion
 * keeps the source's ids), with until when: the newest link of each. An account never linked is
 * not in the map.
 */
export async function formerSourcesOf(
  ctx: Pick<Ctx, "userId">,
  accountIds: readonly string[],
): Promise<Map<string, { provider: string; until: Date }>> {
  if (accountIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      entityId: providerLinks.entityId,
      provider: providerLinks.provider,
      at: providerLinks.lastSeenAt,
    })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.entityType, "account"),
        inArray(providerLinks.entityId, [...accountIds]),
      ),
    )
    .orderBy(asc(providerLinks.lastSeenAt), asc(providerLinks.provider));
  // In time order: the newest link of an account is the last one written.
  return new Map(rows.map((row) => [row.entityId, { provider: row.provider, until: row.at }]));
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
