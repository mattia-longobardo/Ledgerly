import { sql } from "drizzle-orm";
import { check, customType, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../db/columns";
import { users } from "../auth/schema";
import { CONNECTION_STATES, ENTITY_TYPES, SKIP_REASONS, SYNC_KINDS, SYNC_STATES } from "./rules";
import { DEFAULT_SYNC_SCHEDULE, type SyncSchedule } from "./schedule";
import { inList } from "../db/checks";

/** `bytea` as a Node `Buffer`: `seal`/`open` (spec §9.4) speak Buffer, and pg returns one. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * One provider connection per user (spec §6). `credentials` is the blob `sealJson` produced, so a
 * database dump never carries a usable token; only `readCredentials` opens it.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // Which of a provider's connections this is, for a provider that allows more than one per
    // person (a plugin: one per bank). Empty for the providers with one connection (rewrite plan,
    // 06-data.md §6.1).
    instanceKey: text("instance_key").notNull().default(""),
    credentials: bytea("credentials").notNull(),
    // When the access the person gave ends, for a provider whose access has an end.
    expiresAt: moment("expires_at"),
    state: text("state", { enum: CONNECTION_STATES }).notNull().default("active"),
    lastOkAt: moment("last_ok_at"),
    lastError: text("last_error"),
    // Why the last reading failed, as a code of the closed list (`status.ts`); null when the
    // connection works or the failure has no code. Never what a provider said.
    errorCode: text("error_code"),
    // The readings that failed in a row (`failureStreak`): 0 after a good one.
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    // When the dispatcher syncs this connection (docs/scheduler.md): a list of rules, checked by
    // `syncScheduleSchema` and, as a list, by the constraint below; `next_sync_at` is null when
    // there is no rule (manual only).
    schedule: jsonb("schedule").$type<SyncSchedule>().notNull().default(DEFAULT_SYNC_SCHEDULE),
    nextSyncAt: moment("next_sync_at"),
    // The accounts here whose IBAN a new account of the source carries, at the last reading: the
    // source's account was not added (rewrite plan N4, H39, case 5). Ids only, never an IBAN.
    ibanConflicts: jsonb("iban_conflicts").$type<string[]>(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    // One connection per provider and instance: a person has as many banks as they connect. The
    // key on the provider alone went with N2 (second half of a two-step change).
    unique("integration_connections_user_provider_instance_uq").on(
      table.userId,
      table.provider,
      table.instanceKey,
    ),
    check("integration_connections_state_ck", sql`${table.state} in (${sql.raw(inList(CONNECTION_STATES))})`),
    check("integration_connections_provider_ck", sql`length(btrim(${table.provider})) between 1 and 40`),
    check(
      "integration_connections_schedule_rules_ck",
      sql`jsonb_typeof(${table.schedule}->'rules') = 'array'`,
    ),
    index("integration_connections_next_sync_idx")
      .on(table.nextSyncAt)
      .where(sql`${table.nextSyncAt} is not null`),
  ],
);

/**
 * The one place a provider's own ids live (spec §4.3). Both unique keys matter: the first stops
 * two local rows claiming the same remote object, the second stops one local row being claimed by
 * two remote objects — which is what makes a sync idempotent.
 *
 * `entity_id` is a plain uuid, not a foreign key: §4.3 fixes this table's columns, and a real FK
 * would need one nullable column per linkable entity, inverting the platform → module direction
 * that `src/architecture.test.ts` enforces. The owning module's service deletes its own links.
 */
export const providerLinks = pgTable(
  "provider_links",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    firstSeenAt: moment("first_seen_at").notNull().defaultNow(),
    lastSeenAt: moment("last_seen_at").notNull().defaultNow(),
    missingSince: moment("missing_since"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("provider_links_external_uq").on(table.userId, table.provider, table.entityType, table.externalId),
    unique("provider_links_entity_uq").on(table.userId, table.provider, table.entityType, table.entityId),
    index("provider_links_lookup_idx").on(table.userId, table.provider, table.entityType, table.lastSeenAt),
    check("provider_links_entity_type_ck", sql`${table.entityType} in (${sql.raw(inList(ENTITY_TYPES))})`),
    check("provider_links_external_id_ck", sql`length(btrim(${table.externalId})) between 1 and 200`),
  ],
);

/** Where a connection's sync stands, one row per kind: the cursor to resume from and when to run. */
export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SYNC_KINDS }).notNull(),
    cursor: jsonb("cursor").$type<Record<string, string>>(),
    nextRunAt: moment("next_run_at"),
    lastRunAt: moment("last_run_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("sync_jobs_connection_kind_uq").on(table.connectionId, table.kind),
    check("sync_jobs_kind_ck", sql`${table.kind} in (${sql.raw(inList(SYNC_KINDS))})`),
  ],
);

/**
 * The accounts of a source that do not come here: the ones the person left out (`excluded`), and
 * the ones they deleted here (`deleted`, rewrite plan H55, point 5). A memory of the core, apart
 * from any connection: it outlives "Disconnect", so connecting the same source again brings none of
 * them back. "Turn off" forgets the `excluded` ones only (plugin-settings.md §3.2). `name` is the
 * account's name here when it was deleted, for "Bring back" (§3.4); `null` for the others.
 */
export const sourceSkippedAccounts = pgTable(
  "source_skipped_accounts",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    reason: text("reason", { enum: SKIP_REASONS }).notNull().default("excluded"),
    name: text("name"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("source_skipped_accounts_uq").on(table.userId, table.provider, table.externalId),
    check("source_skipped_accounts_reason_ck", sql`${table.reason} in (${sql.raw(inList(SKIP_REASONS))})`),
    check(
      "source_skipped_accounts_external_id_ck",
      sql`length(btrim(${table.externalId})) between 1 and 200`,
    ),
  ],
);

/**
 * What a disconnected connection leaves for when the same source is connected again (H55, point
 * 4): its schedule and the settings its cursors hold (how deep the history goes). Written by
 * "Disconnect", taken back and removed by the next connection of the same source and instance.
 */
export const sourceSettings = pgTable(
  "source_settings",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    instanceKey: text("instance_key").notNull().default(""),
    schedule: jsonb("schedule").$type<SyncSchedule>().notNull(),
    cursors: jsonb("cursors").$type<Record<string, Record<string, string>>>().notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (table) => [unique("source_settings_uq").on(table.userId, table.provider, table.instanceKey)],
);

/** One row per sync attempt, for the history Settings › Integrations shows (spec §10.3). */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SYNC_KINDS }).notNull(),
    state: text("state", { enum: SYNC_STATES }).notNull().default("running"),
    startedAt: moment("started_at").notNull().defaultNow(),
    finishedAt: moment("finished_at"),
    counts: jsonb("counts").$type<Record<string, number>>(),
    error: text("error"),
    // Who started the reading: the schedule (`auto`) or the person (`manual`).
    origin: text("origin"),
    // The code of a failed reading, the HTTP status the provider answered with, and the version
    // of the app that made the reading: what the log under "Advanced" shows.
    errorCode: text("error_code"),
    httpStatus: integer("http_status"),
    appVersion: text("app_version"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("sync_runs_connection_started_idx").on(table.connectionId, table.startedAt.desc()),
    index("sync_runs_user_started_idx").on(table.userId, table.startedAt.desc()),
    check("sync_runs_kind_ck", sql`${table.kind} in (${sql.raw(inList(SYNC_KINDS))})`),
    check("sync_runs_state_ck", sql`${table.state} in (${sql.raw(inList(SYNC_STATES))})`),
  ],
);
