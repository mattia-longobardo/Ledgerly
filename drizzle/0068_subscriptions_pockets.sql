-- R5a (ST-13, D1 = B): the list «Connections» of an account closes, with no conversion to
-- subscriptions. On the day of the release it holds no row; one found stops the migration, so that
-- nobody's list is closed with something in it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "account_connections") THEN
    RAISE EXCEPTION 'R5a: account_connections has rows; convert them before this migration';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "pocket_movements" DROP CONSTRAINT "pocket_movements_accrual_day_ck";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_utility_ck";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "utility" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pockets" ADD COLUMN "accrual_day" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "every_unit" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "every_count" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "pocket_movements_accrual_month_uq" ON "pocket_movements" USING btree ("pocket_id",date_trunc('month', "on"::timestamp)) WHERE "pocket_movements"."kind" = 'accrual';--> statement-breakpoint
ALTER TABLE "pocket_movements" ADD CONSTRAINT "pocket_movements_accrual_day_ck" CHECK ("pocket_movements"."kind" <> 'accrual' or extract(day from "pocket_movements"."on") between 1 and 31);--> statement-breakpoint
ALTER TABLE "pockets" ADD CONSTRAINT "pockets_accrual_day_ck" CHECK ("pockets"."accrual_day" between 1 and 31);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_every_ck" CHECK (("subscriptions"."every_unit" is null and "subscriptions"."every_count" is null) or ("subscriptions"."every_unit" = 'week' and "subscriptions"."every_count" between 1 and 12) or ("subscriptions"."every_unit" = 'month' and "subscriptions"."every_count" between 1 and 24));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_utility_ck" CHECK ("subscriptions"."utility" is null or "subscriptions"."utility" between 1 and 10);