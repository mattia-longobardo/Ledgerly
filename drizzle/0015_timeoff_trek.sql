CREATE TABLE "leave_days" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"on" date NOT NULL,
	"kind" text NOT NULL,
	"fraction" numeric(2, 1),
	"minutes" integer,
	"note" text,
	"origin" text DEFAULT 'manual' NOT NULL,
	"pending" text DEFAULT 'none' NOT NULL,
	"synced_at" timestamp with time zone,
	"trek_fraction" numeric(2, 1),
	"trek_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_days_user_on_kind_uq" UNIQUE("user_id","on","kind"),
	CONSTRAINT "leave_days_kind_ck" CHECK ("leave_days"."kind" in ('vacation', 'rol', 'comp', 'sick', 'other')),
	CONSTRAINT "leave_days_origin_ck" CHECK ("leave_days"."origin" in ('manual', 'trek')),
	CONSTRAINT "leave_days_pending_ck" CHECK ("leave_days"."pending" in ('none', 'upsert', 'delete')),
	CONSTRAINT "leave_days_rol_minutes_ck" CHECK (("leave_days"."kind" = 'rol') = ("leave_days"."minutes" is not null)),
	CONSTRAINT "leave_days_day_fraction_ck" CHECK (("leave_days"."kind" <> 'rol') = ("leave_days"."fraction" is not null)),
	CONSTRAINT "leave_days_fraction_value_ck" CHECK ("leave_days"."fraction" is null or "leave_days"."fraction" in (0.5, 1.0)),
	CONSTRAINT "leave_days_minutes_value_ck" CHECK ("leave_days"."minutes" is null or "leave_days"."minutes" between 1 and 1440),
	CONSTRAINT "leave_days_note_ck" CHECK ("leave_days"."note" is null or length("leave_days"."note") <= 200),
	CONSTRAINT "leave_days_trek_kind_ck" CHECK ("leave_days"."trek_kind" is null or "leave_days"."trek_kind" in ('vacation', 'comp')),
	CONSTRAINT "leave_days_pending_delete_ck" CHECK ("leave_days"."pending" <> 'delete' or "leave_days"."origin" = 'trek' or "leave_days"."synced_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "timeoff_allowances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"vacation_days" numeric(5, 2),
	"rol_minutes" integer,
	"carried_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_allowances_user_year_uq" UNIQUE("user_id","year"),
	CONSTRAINT "timeoff_allowances_year_ck" CHECK ("timeoff_allowances"."year" between 1990 and 2200),
	CONSTRAINT "timeoff_allowances_vacation_ck" CHECK ("timeoff_allowances"."vacation_days" is null or "timeoff_allowances"."vacation_days" between 0 and 400),
	CONSTRAINT "timeoff_allowances_rol_ck" CHECK ("timeoff_allowances"."rol_minutes" is null or "timeoff_allowances"."rol_minutes" >= 0),
	CONSTRAINT "timeoff_allowances_carried_ck" CHECK ("timeoff_allowances"."carried_days" between 0 and 400),
	CONSTRAINT "timeoff_allowances_note_ck" CHECK ("timeoff_allowances"."note" is null or length("timeoff_allowances"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "sync_jobs" DROP CONSTRAINT "sync_jobs_kind_ck";--> statement-breakpoint
ALTER TABLE "sync_runs" DROP CONSTRAINT "sync_runs_kind_ck";--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_allowances" ADD CONSTRAINT "timeoff_allowances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_days_user_on_idx" ON "leave_days" USING btree ("user_id","on");--> statement-breakpoint
CREATE INDEX "leave_days_pending_idx" ON "leave_days" USING btree ("user_id","on") WHERE "leave_days"."pending" <> 'none';--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_kind_ck" CHECK ("sync_jobs"."kind" in ('accounts', 'transactions', 'leave'));--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_kind_ck" CHECK ("sync_runs"."kind" in ('accounts', 'transactions', 'leave'));