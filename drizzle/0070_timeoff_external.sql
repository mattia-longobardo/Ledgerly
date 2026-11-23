-- R5c P2: the observed pair of a leave day in the words of contract 2, beside `trek_*` (which stays
-- until a later release), and `origin = 'external'` allowed beside `trek` (the data keeps `trek`
-- until P3). The new columns start as a copy of what Trek was last observed holding.
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_origin_ck";--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_pending_delete_ck";--> statement-breakpoint
ALTER TABLE "leave_days" ADD COLUMN "external_kind" text;--> statement-breakpoint
ALTER TABLE "leave_days" ADD COLUMN "external_fraction" numeric(2, 1);--> statement-breakpoint
ALTER TABLE "leave_days" ADD COLUMN "external_state" text;--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_external_ck" CHECK (coalesce("leave_days"."external_kind" ~ '^[a-z][a-z0-9_-]{0,39}$', true)
        and coalesce("leave_days"."external_fraction" in (0.5, 1.0), true)
        and coalesce("leave_days"."external_state" in ('synced', 'refused'), true));--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_origin_ck" CHECK ("leave_days"."origin" in ('manual', 'trek', 'external'));--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_pending_delete_ck" CHECK ("leave_days"."pending" <> 'delete' or "leave_days"."origin" in ('trek', 'external') or "leave_days"."synced_at" is not null);--> statement-breakpoint
UPDATE "leave_days"
SET "external_kind" = "trek_kind", "external_fraction" = "trek_fraction", "external_state" = 'synced'
WHERE "trek_kind" IS NOT NULL OR "trek_fraction" IS NOT NULL;
