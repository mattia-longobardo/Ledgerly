ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_schedule_mode_ck";--> statement-breakpoint
ALTER TABLE "job_runs" DROP CONSTRAINT "job_runs_tier_ck";--> statement-breakpoint
-- The D7 schedules in the rule shape they mean (docs/scheduler.md): an interval is the same
-- interval over the whole day (aligned to local midnight, as before), times are the same times
-- every day, manual is no rule. The instants do not change, so `next_sync_at` stays as it is.
UPDATE "integration_connections" SET "schedule" = CASE "schedule"->>'mode'
  WHEN 'manual' THEN '{"rules":[]}'::jsonb
  WHEN 'times' THEN jsonb_build_object('rules', jsonb_build_array(jsonb_build_object(
    'kind', 'times', 'times', "schedule"->'times', 'days', '{"kind":"every"}'::jsonb)))
  ELSE jsonb_build_object('rules', jsonb_build_array(jsonb_build_object(
    'kind', 'interval', 'everyMinutes', coalesce("schedule"->'everyMinutes', '60'::jsonb),
    'from', '00:00', 'until', '23:59', 'days', '{"kind":"every"}'::jsonb)))
  END
WHERE "schedule" ? 'mode';--> statement-breakpoint
ALTER TABLE "integration_connections" ALTER COLUMN "schedule" SET DEFAULT '{"rules":[{"kind":"interval","everyMinutes":60,"from":"00:00","until":"23:59","days":{"kind":"every"}}]}'::jsonb;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_schedule_rules_ck" CHECK (jsonb_typeof("integration_connections"."schedule"->'rules') = 'array');--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tier_ck" CHECK ("job_runs"."tier" in ('minute', 'hourly', 'daily', 'monthly', 'manual', 'quarter'));
