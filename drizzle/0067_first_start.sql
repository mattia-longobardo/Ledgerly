ALTER TABLE "user_preferences" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_country_ck" CHECK ("user_preferences"."country" is null or "user_preferences"."country" ~ '^[A-Z]{2}$');--> statement-breakpoint
-- R5a: the people of today have finished the first start; a person without a row gets one, with the
-- defaults the application read for them until now (DEFAULT_PREFERENCES) and every addon on.
UPDATE "user_preferences" SET "onboarded_at" = now() WHERE "onboarded_at" IS NULL;--> statement-breakpoint
INSERT INTO "user_preferences" ("user_id", "time_zone", "locale", "number_format", "week_start", "theme", "default_range", "monthly_summary", "minutes_per_day", "onboarded_at")
SELECT "id", 'Europe/Rome', 'en', 'it-IT', 1, 'light', 'this_month', false, 480, now() FROM "users"
WHERE NOT EXISTS (SELECT 1 FROM "user_preferences" WHERE "user_preferences"."user_id" = "users"."id");
