ALTER TABLE "integration_connections" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "http_status" integer;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "unreachable_since" timestamp with time zone;