CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"in_app" boolean NOT NULL,
	"email" boolean NOT NULL,
	"device" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_event_uq" UNIQUE("user_id","event"),
	CONSTRAINT "notification_preferences_event_ck" CHECK ("notification_preferences"."event" in ('connection_failed', 'connection_stale', 'connection_expiring', 'account_low_balance', 'budget_threshold', 'monthly_summary', 'transactions_to_categorize', 'payslips_to_review', 'transfers_to_confirm', 'fund_to_verify'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"subject" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_id" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_event_ck" CHECK ("notifications"."event" in ('connection_failed', 'connection_stale', 'connection_expiring', 'account_low_balance', 'budget_threshold', 'monthly_summary', 'transactions_to_categorize', 'payslips_to_review', 'transfers_to_confirm', 'fund_to_verify'))
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "hide_amounts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_open_uq" ON "notifications" USING btree ("user_id","event","subject") WHERE "notifications"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_opened_idx" ON "notifications" USING btree ("user_id","opened_at");