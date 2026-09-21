ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_rol_minutes_ck";--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_day_fraction_ck";--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_minutes_value_ck";--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_fraction_value_ck";--> statement-breakpoint
-- N0: ROL stops being free-form minutes and becomes half a day or a whole one, like every other
-- kind. The rows that already exist are converted before the column can be made NOT NULL: a ROL of
-- at least half the person's working day becomes a whole day, anything shorter becomes a half.
-- Their own `minutes_per_day` decides, and 480 stands in for anybody who never set a preference.
UPDATE "leave_days" ld
SET "fraction" = CASE WHEN ld."minutes" * 2 >= up."minutes_per_day" THEN 1.0 ELSE 0.5 END
FROM "user_preferences" up
WHERE up."user_id" = ld."user_id" AND ld."kind" = 'rol' AND ld."fraction" IS NULL;--> statement-breakpoint
UPDATE "leave_days"
SET "fraction" = CASE WHEN "minutes" * 2 >= 480 THEN 1.0 ELSE 0.5 END
WHERE "kind" = 'rol' AND "fraction" IS NULL;--> statement-breakpoint
-- Whatever is left has no minutes either: a whole day is the only honest guess.
UPDATE "leave_days" SET "fraction" = 1.0 WHERE "fraction" IS NULL;--> statement-breakpoint
ALTER TABLE "leave_days" ALTER COLUMN "fraction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "timeoff_allowances" ADD COLUMN "carried_rol_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "timeoff_allowances" ADD COLUMN "total_days" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "leave_days" DROP COLUMN "minutes";--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_fraction_value_ck" CHECK ("leave_days"."fraction" in (0.5, 1.0));--> statement-breakpoint
ALTER TABLE "timeoff_allowances" ADD CONSTRAINT "timeoff_allowances_carried_rol_ck" CHECK ("timeoff_allowances"."carried_rol_minutes" between 0 and 576000);--> statement-breakpoint
ALTER TABLE "timeoff_allowances" ADD CONSTRAINT "timeoff_allowances_total_ck" CHECK ("timeoff_allowances"."total_days" is null or "timeoff_allowances"."total_days" between 0 and 400);