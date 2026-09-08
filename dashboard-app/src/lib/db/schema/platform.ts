import { bigint, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    principalId: uuid("principal_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body"),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.key] })],
);

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    principalId: uuid("principal_id").notNull(),
    windowStart: tz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.windowStart] })],
);

/**
 * One row per job invocation. Platform bookkeeping, not user data: it predates
 * the platform rebuild and lived in `schema/legacy.ts` until Phase 7 dropped
 * that file along with every legacy table (R7-5').
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    jobName: text("job_name").notNull(),
    dedupeKey: text("dedupe_key"),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: tz("started_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
    error: text("error"),
    detail: jsonb("detail"),
  },
  (t) => [
    check("job_runs_trigger_ck", sql`${t.trigger} IN ('cron','sweep','manual','webhook')`),
    check(
      "job_runs_status_ck",
      sql`${t.status} IN ('running','success','success_after_retry','already_done','failed','poisoned','missed')`,
    ),
    index("job_runs_name_started_idx").on(t.jobName, t.startedAt.desc()),
  ],
);

/** Deployment-wide key/value settings (`hours_per_day`, the LLM config, …). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export type JobRun = typeof jobRuns.$inferSelect;
