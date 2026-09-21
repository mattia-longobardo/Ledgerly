ALTER TABLE "interest_rules" ADD COLUMN "run_hour" smallint;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "decimal_separator" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "currency_position" text;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_run_hour_ck" CHECK ("interest_rules"."run_hour" is null or "interest_rules"."run_hour" between 0 and 23);--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_decimal_separator_ck" CHECK ("user_preferences"."decimal_separator" is null or "user_preferences"."decimal_separator" in ('.', ','));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_currency_position_ck" CHECK ("user_preferences"."currency_position" is null or "user_preferences"."currency_position" in ('before', 'after'));