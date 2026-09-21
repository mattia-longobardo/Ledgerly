ALTER TABLE "timeoff_allowances" DROP CONSTRAINT "timeoff_allowances_carried_ck";--> statement-breakpoint
ALTER TABLE "timeoff_allowances" DROP CONSTRAINT "timeoff_allowances_carried_rol_ck";--> statement-breakpoint
ALTER TABLE "timeoff_allowances" DROP CONSTRAINT "timeoff_allowances_rol_ck";--> statement-breakpoint
ALTER TABLE "timeoff_allowances" ADD COLUMN "rol_days" numeric(5, 2);--> statement-breakpoint
-- N9: ROL is stated in days now, like everything else the screen counts. What was stated in
-- minutes becomes days on that user's own working day; `least` keeps a freak figure inside the
-- check that follows rather than failing the migration over it.
UPDATE "timeoff_allowances" a
SET "rol_days" = least(round(a."rol_minutes"::numeric / p."minutes_per_day", 2), 400)
FROM "user_preferences" p
WHERE p."user_id" = a."user_id" AND a."rol_minutes" is not null;--> statement-breakpoint
ALTER TABLE "timeoff_allowances" ADD CONSTRAINT "timeoff_allowances_rol_ck" CHECK ("timeoff_allowances"."rol_days" is null or "timeoff_allowances"."rol_days" between 0 and 400);