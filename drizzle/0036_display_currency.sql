ALTER TABLE "snapshot_runs" ADD COLUMN "total_currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "display_currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_total_currency_ck" CHECK ("snapshot_runs"."total_currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_display_currency_ck" CHECK ("user_preferences"."display_currency" ~ '^[A-Z]{3}$');