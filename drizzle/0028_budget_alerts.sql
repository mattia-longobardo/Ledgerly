CREATE TABLE "budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"thresholds" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_alerts_scope_uq" UNIQUE NULLS NOT DISTINCT("user_id","category_id","account_id"),
	CONSTRAINT "budget_alerts_scope_ck" CHECK ("budget_alerts"."category_id" is not null or "budget_alerts"."account_id" is not null),
	CONSTRAINT "budget_alerts_thresholds_ck" CHECK (cardinality("budget_alerts"."thresholds") <= 8 and 1 <= all("budget_alerts"."thresholds") and 200 >= all("budget_alerts"."thresholds"))
);
--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;