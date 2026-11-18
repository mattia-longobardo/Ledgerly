import { and, asc, eq, sql } from "drizzle-orm";
import type { Ctx } from "../../context";
import { type KeyRing, openJson, parseKeyRing, sealJson } from "../../crypto";
import { getDb } from "../../db/client";
import { UNIQUE_VIOLATION, hasPgError } from "../../db/errors";
import { userScoped } from "../../db/scope";
import { readEnv } from "../../env";
import {
  type ConnectionState,
  credentialsSchema,
  isKnownProvider,
  isPluginProvider,
  pluginConnectionBagSchema,
  SYNC_KINDS,
  type SyncKind,
} from "../rules";
import { parseSyncSchedule, type ScheduleProblem, type SyncSchedule } from "../schedule";
import { integrationConnections, sourceSettings, syncJobs, syncRuns } from "../schema";
import { SETTING_KEYS } from "./schedule";

/** Every service failure a caller is expected to handle carries one of these codes. */
type IntegrationErrorCode =
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
export const CONNECTION_COLUMNS = {
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
export function toConnection(row: Omit<Connection, "schedule"> & { schedule: unknown }): Connection {
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

export async function requireConnection(ctx: Pick<Ctx, "userId">, id: string): Promise<Connection> {
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
