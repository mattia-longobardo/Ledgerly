CREATE TABLE "holiday_calendars" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"country" text NOT NULL,
	"subdivision" text,
	"label" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_calendars_source_ck" CHECK ("holiday_calendars"."source" in ('openholidays', 'nager')),
	CONSTRAINT "holiday_calendars_country_ck" CHECK ("holiday_calendars"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "holiday_calendars_subdivision_ck" CHECK ("holiday_calendars"."subdivision" is null or length("holiday_calendars"."subdivision") between 2 and 20),
	CONSTRAINT "holiday_calendars_label_ck" CHECK (length(btrim("holiday_calendars"."label")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "holiday_days" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"on" date NOT NULL,
	"year" smallint NOT NULL,
	"name" text NOT NULL,
	"nationwide" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_days_entry_uq" UNIQUE("calendar_id","on","name"),
	CONSTRAINT "holiday_days_year_ck" CHECK ("holiday_days"."year" = extract(year from "holiday_days"."on")),
	CONSTRAINT "holiday_days_name_ck" CHECK (length(btrim("holiday_days"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "holiday_calendars" ADD CONSTRAINT "holiday_calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_days" ADD CONSTRAINT "holiday_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_days" ADD CONSTRAINT "holiday_days_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_calendars_place_uq" ON "holiday_calendars" USING btree ("user_id","source","country",coalesce("subdivision", ''));--> statement-breakpoint
CREATE INDEX "holiday_days_user_on_idx" ON "holiday_days" USING btree ("user_id","on");--> statement-breakpoint
CREATE INDEX "holiday_days_calendar_year_idx" ON "holiday_days" USING btree ("calendar_id","year");