DROP TABLE "monthly_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "tracked_accounts" CASCADE;--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "teable_column";--> statement-breakpoint
ALTER TABLE "balance_snapshots" DROP CONSTRAINT IF EXISTS "balance_snapshots_source_ck";