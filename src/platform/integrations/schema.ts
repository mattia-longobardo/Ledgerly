import { sql } from "drizzle-orm";
import { check, customType, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";
import { CONNECTION_STATES, ENTITY_TYPES, SYNC_KINDS, SYNC_STATES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

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
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    credentials: bytea("credentials").notNull(),
    state: text("state", { enum: CONNECTION_STATES }).notNull().default("active"),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("integration_connections_user_provider_uq").on(table.userId, table.provider),
    check("integration_connections_state_ck", sql`${table.state} in (${sql.raw(inList(CONNECTION_STATES))})`),
    check("integration_connections_provider_ck", sql`length(btrim(${table.provider})) between 1 and 40`),
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
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    missingSince: timestamp("missing_since", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
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
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SYNC_KINDS }).notNull(),
    cursor: jsonb("cursor").$type<Record<string, string>>(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("sync_jobs_connection_kind_uq").on(table.connectionId, table.kind),
    check("sync_jobs_kind_ck", sql`${table.kind} in (${sql.raw(inList(SYNC_KINDS))})`),
  ],
);

/** One row per sync attempt, for the history Settings › Integrations shows (spec §10.3). */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SYNC_KINDS }).notNull(),
    state: text("state", { enum: SYNC_STATES }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    counts: jsonb("counts").$type<Record<string, number>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("sync_runs_connection_started_idx").on(table.connectionId, table.startedAt.desc()),
    index("sync_runs_user_started_idx").on(table.userId, table.startedAt.desc()),
    check("sync_runs_kind_ck", sql`${table.kind} in (${sql.raw(inList(SYNC_KINDS))})`),
    check("sync_runs_state_ck", sql`${table.state} in (${sql.raw(inList(SYNC_STATES))})`),
  ],
);
