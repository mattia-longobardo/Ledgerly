DROP TABLE "investment_movements" CASCADE;--> statement-breakpoint
DROP TABLE "investment_platforms" CASCADE;--> statement-breakpoint
DROP TABLE "investment_valuations" CASCADE;--> statement-breakpoint
ALTER TABLE "investment_accounts" DROP COLUMN "legacy_platform_id";--> statement-breakpoint
DROP FUNCTION "investments_legacy_read_only"();
