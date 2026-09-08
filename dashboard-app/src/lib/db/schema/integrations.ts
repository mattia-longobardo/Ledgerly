import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/** Drizzle 0.45 has no first-class bytea column; this is the documented custom type. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Static catalogue, seeded by the migration; `capabilities` mirrors each adapter's own list. */
export const integrationProviders = pgTable("integration_providers", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  capabilities: jsonb("capabilities").notNull().default([]),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").notNull().references(() => integrationProviders.code),
    status: text("status").notNull().default("disconnected"),
    credentialsCiphertext: bytea("credentials_ciphertext"),
    keyId: text("key_id"),
    settings: jsonb("settings").notNull().default({}),
    lastTestAt: tz("last_test_at"),
    lastSyncAt: tz("last_sync_at"),
    lastError: text("last_error"),
    disconnectPolicy: text("disconnect_policy").notNull().default("keep"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("integration_connections_status_ck", sql`${t.status} IN ('disconnected','connected','error','disabled')`),
    check("integration_connections_policy_ck", sql`${t.disconnectPolicy} IN ('keep','archive','purge')`),
    uniqueIndex("integration_connections_user_provider_uq").on(t.userId, t.provider),
  ],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: id(),
    connectionId: uuid("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The dispatch tier the job registry runs this on, not a cron expression — see Ruling P2-4. */
    schedule: text("schedule").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Spec §6's "cursor state", per (connection, kind). Opaque to the
     * framework: only the provider's own handler reads or writes it, through
     * `SyncApplyContext.cursor` / `setCursor`, and it is persisted only when the
     * run succeeds — a failed pass must not advance a cursor past rows it never
     * imported. Null until a handler sets one (Ruling P2-C5).
     */
    cursor: jsonb("cursor"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("sync_jobs_schedule_ck", sql`${t.schedule} IN ('hourly','daily','monthly')`),
    uniqueIndex("sync_jobs_connection_kind_uq").on(t.connectionId, t.kind),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    connectionId: uuid("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
    /** The `sync_jobs` row this run belongs to, when there is one (Ruling P2-C4). */
    jobId: uuid("job_id").references(() => syncJobs.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    trigger: text("trigger").notNull(),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
    startedAt: tz("started_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
  },
  (t) => [
    /**
     * `queued` is the state a webhook leaves behind (spec §3.4, Ruling P2-C3):
     * the delivery is verified inside the request, the work is not. The hourly
     * `sync_queue` job claims queued rows and runs them in their owner's user
     * context.
     */
    check("sync_runs_status_ck", sql`${t.status} IN ('queued','running','success','failed','skipped')`),
    check("sync_runs_trigger_ck", sql`${t.trigger} IN ('cron','manual','webhook','api')`),
    index("sync_runs_connection_started_idx").on(t.connectionId, t.startedAt.desc()),
    // Spec §5.10 asks for this one by name.
    index("sync_runs_job_started_idx").on(t.jobId, t.startedAt.desc()),
    // The queue drain's read: oldest queued row first, across every connection.
    index("sync_runs_queued_idx").on(t.status, t.startedAt),
  ],
);

/**
 * One row per webhook seen. Every row is `inbound` today: outbound delivery is
 * deferred (see `docs/superpowers/DEFERRED.md`), and `direction` is kept so
 * that work reuses this table instead of adding a near-twin. The inbound rows
 * are also the replay window — `handleWebhook` answers a `(connection,
 * payload_hash)` it has already accepted in the last 10 minutes without
 * enqueuing again (Rulings R9-6, P9-5, P9-7) — and `housekeeping` purges them
 * after 90 days. A row written for a duplicate carries the reserved
 * `duplicate` event so it cannot anchor a window of its own.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    direction: text("direction").notNull().default("inbound"),
    event: text("event").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(1),
    responseCode: integer("response_code"),
    error: text("error"),
    receivedAt: tz("received_at").notNull().defaultNow(),
  },
  (t) => [
    check("webhook_deliveries_direction_ck", sql`${t.direction} IN ('inbound','outbound')`),
    check("webhook_deliveries_status_ck", sql`${t.status} IN ('accepted','rejected','delivered','failed')`),
    index("webhook_deliveries_provider_received_idx").on(t.provider, t.receivedAt.desc()),
  ],
);

export type IntegrationProviderRow = typeof integrationProviders.$inferSelect;
export type IntegrationConnectionRow = typeof integrationConnections.$inferSelect;
export type SyncJobRow = typeof syncJobs.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
