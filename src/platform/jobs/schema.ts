import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    tier: text("tier", { enum: ["hourly", "daily", "monthly", "manual"] }).notNull(),
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
    check("job_runs_tier_ck", sql`${table.tier} in ('hourly', 'daily', 'monthly', 'manual')`),
    check("job_runs_status_ck", sql`${table.status} in ('running', 'success', 'failed', 'skipped')`),
  ],
);
