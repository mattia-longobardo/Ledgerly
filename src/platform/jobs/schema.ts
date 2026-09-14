import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    job: text("job").notNull(),
    tier: text("tier", { enum: ["hourly", "daily", "monthly"] }).notNull(),
    status: text("status", { enum: ["running", "success", "failed", "skipped"] }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("job_runs_job_started_idx").on(table.job, table.startedAt.desc())],
);
