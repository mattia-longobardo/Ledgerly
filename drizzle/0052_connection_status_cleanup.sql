-- N2, second half of the two-step change of the key (rewrite plan, 06-data.md §6.1): the image of
-- N1 already writes with the key on (user, provider, instance), so the key on (user, provider)
-- goes and a person can have more than one bank.
ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_user_provider_uq";--> statement-breakpoint
-- A connection of a plugin kept the code of its last failure in "last_error": the same code, in
-- its own column.
UPDATE "integration_connections" SET "error_code" = CASE WHEN "last_error" = 'plugin_down' THEN 'provider_down' ELSE "last_error" END
  WHERE "state" <> 'active' AND "last_error" IN ('auth', 'consent_expired', 'rate_limited', 'provider_down', 'invalid_data', 'plugin_down');--> statement-breakpoint
-- A run that nobody is running any more: the process that started it died.
UPDATE "sync_runs" SET "state" = 'failed', "finished_at" = now(), "error" = 'orphaned', "updated_at" = now()
  WHERE "state" = 'running' AND "started_at" < now() - interval '1 hour';--> statement-breakpoint
UPDATE "job_runs" SET "status" = 'failed', "finished_at" = now(), "error" = 'orphaned', "updated_at" = now()
  WHERE "status" = 'running' AND "started_at" < now() - interval '1 hour';--> statement-breakpoint
-- The log of the readings is kept for 30 days, no longer 90.
DELETE FROM "sync_runs" WHERE coalesce("finished_at", "started_at") < now() - interval '30 days';--> statement-breakpoint
-- The keys of the warnings no longer carry the name of a provider (anticipation AN3).
UPDATE "notifications_log" SET "kind" = 'sync_failed' WHERE "kind" = 'wallet_sync_failed';--> statement-breakpoint
UPDATE "notifications_log" SET "kind" = 'sync_stale' WHERE "kind" = 'wallet_sync_stale';
