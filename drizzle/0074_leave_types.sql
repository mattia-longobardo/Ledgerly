-- Release R5g, pull request 1 "Time off" (rewrite plan 03-releases.md "R5g", decisions ST-20, H20):
-- the types of leave become data of the person. Additive only: the old columns (`leave_days.kind`,
-- `timeoff_allowances.vacation_days`/`rol_days`, the patron saint of `user_preferences`) stay and stay
-- written until R5f, so the image before reads a true year. Data, at the end: every person gets the
-- four types of the old kinds without sickness (H20), every day its type, every allowance a row per
-- type, the patron saint a day off of the year. Way back: docs/design/rewrite-plan/r5g-timeoff-rollback.sql.
CREATE TABLE "leave_allowances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"days" numeric(5, 2),
	"carried_days" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_allowances_type_year_uq" UNIQUE("user_id","type_id","year"),
	CONSTRAINT "leave_allowances_year_ck" CHECK ("leave_allowances"."year" between 1990 and 2200),
	CONSTRAINT "leave_allowances_days_ck" CHECK ("leave_allowances"."days" is null or "leave_allowances"."days" between 0 and 400),
	CONSTRAINT "leave_allowances_carried_ck" CHECK ("leave_allowances"."carried_days" is null or "leave_allowances"."carried_days" between -400 and 400)
);
--> statement-breakpoint
CREATE TABLE "leave_rest_days" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"month" smallint NOT NULL,
	"day" smallint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_rest_days_user_date_uq" UNIQUE("user_id","month","day"),
	CONSTRAINT "leave_rest_days_month_ck" CHECK ("leave_rest_days"."month" between 1 and 12),
	CONSTRAINT "leave_rest_days_day_ck" CHECK ("leave_rest_days"."day" between 1 and 31),
	CONSTRAINT "leave_rest_days_name_ck" CHECK (length("leave_rest_days"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "leave_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"year_start_month" smallint DEFAULT 1 NOT NULL,
	"work_days" smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_settings_start_ck" CHECK ("leave_settings"."year_start_month" between 1 and 12),
	CONSTRAINT "leave_settings_days_ck" CHECK (cardinality("leave_settings"."work_days") between 1 and 7 and "leave_settings"."work_days" <@ array[0,1,2,3,4,5,6]::smallint[])
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"unit" text NOT NULL,
	"has_allowance" boolean NOT NULL,
	"to_calendar" boolean NOT NULL,
	"balance_key" text,
	"calendar_kind" text,
	"legacy_kind" text,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "leave_types_name_ck" CHECK (length("leave_types"."name") between 1 and 40),
	CONSTRAINT "leave_types_color_ck" CHECK ("leave_types"."color" in ('primary', 'warn', 'accent', 'neg', 'faint', 'pos', 'muted')),
	CONSTRAINT "leave_types_unit_ck" CHECK ("leave_types"."unit" in ('day', 'half_day', 'hours')),
	CONSTRAINT "leave_types_words_ck" CHECK (coalesce("leave_types"."balance_key" ~ '^[a-z][a-z0-9_-]{0,39}$', true)
        and coalesce("leave_types"."calendar_kind" ~ '^[a-z][a-z0-9_-]{0,39}$', true)
        and coalesce("leave_types"."legacy_kind" ~ '^[a-z][a-z0-9_-]{0,39}$', true))
);
--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_pending_delete_ck";--> statement-breakpoint
ALTER TABLE "leave_days" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_days" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_days" ADD COLUMN "minutes" smallint;--> statement-breakpoint
ALTER TABLE "leave_allowances" ADD CONSTRAINT "leave_allowances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_allowances" ADD CONSTRAINT "leave_allowances_type_id_leave_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_rest_days" ADD CONSTRAINT "leave_rest_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_types_user_idx" ON "leave_types" USING btree ("user_id","position");--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_type_id_leave_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_days_type_idx" ON "leave_days" USING btree ("type_id");--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_user_on_type_uq" UNIQUE("user_id","on","type_id");--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_minutes_ck" CHECK ("leave_days"."minutes" is null or "leave_days"."minutes" between 1 and 1440);--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_pending_delete_ck" CHECK ("leave_days"."pending" <> 'delete' or "leave_days"."origin" <> 'manual' or "leave_days"."synced_at" is not null);--> statement-breakpoint
INSERT INTO "leave_settings" ("user_id", "work_days")
SELECT "id", ARRAY[1, 2, 3, 4, 5]::smallint[] FROM "users"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "leave_types" ("user_id", "name", "color", "unit", "has_allowance", "to_calendar", "balance_key", "calendar_kind", "legacy_kind", "position")
SELECT u."id",
       CASE WHEN coalesce(p."locale", 'en') = 'it' THEN t."name_it" ELSE t."name_en" END,
       t."color", 'half_day', t."has_allowance", t."to_calendar", t."balance_key", t."calendar_kind", t."legacy_kind", t."position"
FROM "users" u
LEFT JOIN "user_preferences" p ON p."user_id" = u."id"
CROSS JOIN (VALUES
  ('Ferie', 'Vacation', 'primary', true, true, 'vacation', 'vacation', 'vacation', 0),
  ('ROL', 'ROL', 'warn', true, true, 'rol', NULL, 'rol', 1),
  ('Recupero', 'Time off in lieu', 'accent', false, true, NULL, 'comp', 'comp', 2),
  ('Altro', 'Other', 'faint', false, false, NULL, NULL, 'other', 3)
) AS t("name_it", "name_en", "color", "has_allowance", "to_calendar", "balance_key", "calendar_kind", "legacy_kind", "position");--> statement-breakpoint
-- Every day gets the type of its kind; a day of sickness (none in production) the type "other".
UPDATE "leave_days" d SET "type_id" = t."id"
FROM "leave_types" t
WHERE t."user_id" = d."user_id" AND d."type_id" IS NULL
  AND t."legacy_kind" = CASE WHEN d."kind" = 'sick' THEN 'other' ELSE d."kind" END;--> statement-breakpoint
INSERT INTO "leave_allowances" ("user_id", "type_id", "year", "days")
SELECT a."user_id", t."id", a."year", CASE t."legacy_kind" WHEN 'vacation' THEN a."vacation_days" ELSE a."rol_days" END
FROM "timeoff_allowances" a
JOIN "leave_types" t ON t."user_id" = a."user_id" AND t."legacy_kind" IN ('vacation', 'rol')
WHERE CASE t."legacy_kind" WHEN 'vacation' THEN a."vacation_days" ELSE a."rol_days" END IS NOT NULL;--> statement-breakpoint
INSERT INTO "leave_rest_days" ("user_id", "month", "day", "name")
SELECT "user_id", "patron_month", "patron_day", CASE WHEN "locale" = 'it' THEN 'Santo patrono' ELSE 'Patron saint' END
FROM "user_preferences"
WHERE "patron_month" IS NOT NULL AND "patron_day" IS NOT NULL;
