-- Why an account of a source does not come here (N7.3). The rows before this release do not say:
-- they stay `excluded`, which "Turn off" forgets. Production holds artificial data only.
ALTER TABLE "source_skipped_accounts" ADD COLUMN "reason" text DEFAULT 'excluded' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_skipped_accounts" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "source_skipped_accounts" ADD CONSTRAINT "source_skipped_accounts_reason_ck" CHECK ("source_skipped_accounts"."reason" in ('excluded', 'deleted'));
