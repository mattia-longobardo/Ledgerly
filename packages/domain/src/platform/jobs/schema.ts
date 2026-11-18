import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { checkIn, createdAtColumn, idColumn, moment, updatedAtColumn } from "../db/columns";

/** A job's result, restricted to JSON-safe values: a `bigint` would fail jsonb serialization and
 * turn a successful job into a recorded failure. */
// `quarter` is the tier `integrations-sync` ran in before the minute tick: kept for the rows it
// wrote, never asked for again.
const RUN_TIERS = ["minute", "hourly", "daily", "monthly", "manual", "quarter"] as const;
const RUN_STATUSES = ["running", "success", "failed", "skipped"] as const;
const QUEUE_STATUSES = ["queued", "running"] as const;

export type JobDetail = Record<string, string | number | boolean | null>;

export const jobRuns = pgTable(
  "job_runs",
  {
    id: idColumn(),
    job: text("job").notNull(),
    tier: text("tier", { enum: RUN_TIERS }).notNull(),
    status: text("status", { enum: RUN_STATUSES }).notNull(),
    startedAt: moment("started_at").notNull().defaultNow(),
    finishedAt: moment("finished_at"),
    detail: jsonb("detail").$type<JobDetail>(),
    error: text("error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("job_runs_job_started_idx").on(table.job, table.startedAt.desc()),
    checkIn("job_runs_tier_ck", table.tier, RUN_TIERS),
    checkIn("job_runs_status_ck", table.status, RUN_STATUSES),
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
    id: idColumn(),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: QUEUE_STATUSES }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: moment("run_after").notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: moment("locked_at"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("job_queue_waiting_key_uq")
      .on(table.key)
      .where(sql`${table.status} = 'queued'`),
    index("job_queue_status_run_after_idx").on(table.status, table.runAfter),
    checkIn("job_queue_status_ck", table.status, QUEUE_STATUSES),
  ],
);

/** The worker says it is alive here, every half minute: the web's health no longer depends on it. */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  version: text("version").notNull(),
  startedAt: moment("started_at").notNull(),
  beatAt: moment("beat_at").notNull().defaultNow(),
});
