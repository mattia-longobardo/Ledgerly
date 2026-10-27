ALTER TABLE "sync_jobs" DROP CONSTRAINT "sync_jobs_kind_ck";--> statement-breakpoint
ALTER TABLE "sync_runs" DROP CONSTRAINT "sync_runs_kind_ck";--> statement-breakpoint
ALTER TABLE "job_runs" DROP CONSTRAINT "job_runs_tier_ck";--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "schedule" jsonb DEFAULT '{"mode":"interval","everyMinutes":60}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "next_sync_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "integration_connections_next_sync_idx" ON "integration_connections" USING btree ("next_sync_at") WHERE "integration_connections"."next_sync_at" is not null;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_schedule_mode_ck" CHECK ("integration_connections"."schedule"->>'mode' in ('interval', 'times', 'manual'));--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_kind_ck" CHECK ("sync_jobs"."kind" in ('accounts', 'transactions', 'leave', 'documents'));--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_kind_ck" CHECK ("sync_runs"."kind" in ('accounts', 'transactions', 'leave', 'documents'));--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tier_ck" CHECK ("job_runs"."tier" in ('quarter', 'hourly', 'daily', 'monthly', 'manual'));--> statement-breakpoint
-- The schedule the existing connections already had: hourly, next at the top of the coming hour,
-- which the :07 tick picks up exactly as wallet-sync and trek-sync did (D7).
UPDATE "integration_connections" SET "next_sync_at" = date_trunc('hour', now()) + interval '1 hour';
