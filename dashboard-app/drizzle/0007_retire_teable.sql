ALTER TABLE "monthly_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracked_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "monthly_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "tracked_accounts" CASCADE;--> statement-breakpoint
ALTER TABLE "balance_snapshots" DROP CONSTRAINT "balance_snapshots_source_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "teable_column";