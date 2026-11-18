import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** A job's result, restricted to JSON-safe values: a `bigint` would fail jsonb serialization and
 * turn a successful job into a recorded failure. */
export type JobDetail = Record<string, string | number | boolean | null>;

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    job: text("job").notNull(),
    // `quarter` is the tier `integrations-sync` ran in before the minute tick: kept for the rows
    // it wrote, never asked for again.
    tier: text("tier", { enum: ["minute", "hourly", "daily", "monthly", "manual", "quarter"] }).notNull(),
    status: text("status", { enum: ["running", "success", "failed", "skipped"] }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    detail: jsonb("detail").$type<JobDetail>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("job_runs_job_started_idx").on(table.job, table.startedAt.desc()),
    check(
      "job_runs_tier_ck",
      sql`${table.tier} in ('minute', 'hourly', 'daily', 'monthly', 'manual', 'quarter')`,
    ),
    check("job_runs_status_ck", sql`${table.status} in ('running', 'success', 'failed', 'skipped')`),
  ],
);

/**
 * What the worker has still to run (rewrite plan R1). A row is a task: a tier of the scheduler, a
 * job somebody asked for, or a piece of work a request left behind. `key` says which runs may not
 * go together: one waiting row per key, and none is claimed while another of its key runs. A row
 * is deleted when its task ends; the record of what happened is `job_runs` (and `sync_runs`).
 */
export const jobQueue = pgTable(
  "job_queue",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "running"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_queue_waiting_key_uq")
      .on(table.key)
      .where(sql`${table.status} = 'queued'`),
    index("job_queue_status_run_after_idx").on(table.status, table.runAfter),
    check("job_queue_status_ck", sql`${table.status} in ('queued', 'running')`),
  ],
);

/** The worker says it is alive here, every half minute: the web's health no longer depends on it. */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  version: text("version").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  beatAt: timestamp("beat_at", { withTimezone: true }).notNull().defaultNow(),
});
