CREATE TABLE "investment_plan_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"price" numeric(30, 12),
	"price_currency" text,
	"price_on" date,
	"waiting_since" date,
	"reason" text,
	"recorded_by" text,
	"debit_transaction_id" uuid,
	"debit_linked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_plan_runs_due_uq" UNIQUE("plan_id","due_on"),
	CONSTRAINT "investment_plan_runs_state_ck" CHECK ("investment_plan_runs"."state" in ('pending', 'waiting_price', 'proposed', 'recorded', 'skipped')),
	CONSTRAINT "investment_plan_runs_price_ck" CHECK ("investment_plan_runs"."price" is null or "investment_plan_runs"."price" > 0),
	CONSTRAINT "investment_plan_runs_recorded_ck" CHECK ("investment_plan_runs"."recorded_by" is null or "investment_plan_runs"."recorded_by" in ('person', 'job')),
	CONSTRAINT "investment_plan_runs_reason_ck" CHECK ("investment_plan_runs"."reason" is null or length("investment_plan_runs"."reason") <= 40)
);
--> statement-breakpoint
CREATE TABLE "investment_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint,
	"quantity" numeric(38, 18),
	"fractions" boolean DEFAULT true NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"day" integer NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date,
	"runs_limit" integer,
	"debit_account_id" uuid,
	"fee_cents" bigint,
	"fee_rate" numeric(20, 10),
	"mode" text DEFAULT 'propose' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_plans_name_ck" CHECK (length(btrim("investment_plans"."name")) between 1 and 80),
	CONSTRAINT "investment_plans_size_ck" CHECK (("investment_plans"."amount_cents" is null) <> ("investment_plans"."quantity" is null) and ("investment_plans"."amount_cents" is null or "investment_plans"."amount_cents" > 0) and ("investment_plans"."quantity" is null or "investment_plans"."quantity" > 0)),
	CONSTRAINT "investment_plans_frequency_ck" CHECK ("investment_plans"."frequency" in ('week', 'month', 'quarter')),
	CONSTRAINT "investment_plans_interval_ck" CHECK ("investment_plans"."interval" between 1 and 12),
	CONSTRAINT "investment_plans_day_ck" CHECK ("investment_plans"."day" between 1 and (case when "investment_plans"."frequency" = 'week' then 7 else 31 end)),
	CONSTRAINT "investment_plans_end_ck" CHECK ("investment_plans"."end_on" is null or "investment_plans"."runs_limit" is null),
	CONSTRAINT "investment_plans_runs_ck" CHECK ("investment_plans"."runs_limit" is null or "investment_plans"."runs_limit" between 1 and 600),
	CONSTRAINT "investment_plans_fee_ck" CHECK (("investment_plans"."fee_cents" is null or "investment_plans"."fee_cents" >= 0) and ("investment_plans"."fee_rate" is null or "investment_plans"."fee_rate" >= 0) and ("investment_plans"."fee_cents" is null or "investment_plans"."fee_rate" is null)),
	CONSTRAINT "investment_plans_mode_ck" CHECK ("investment_plans"."mode" in ('propose', 'auto')),
	CONSTRAINT "investment_plans_state_ck" CHECK ("investment_plans"."state" in ('active', 'paused', 'ended'))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_event_ck";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_event_ck";--> statement-breakpoint
ALTER TABLE "investment_operations" ADD COLUMN "plan_run_id" uuid;--> statement-breakpoint
ALTER TABLE "investment_plan_runs" ADD CONSTRAINT "investment_plan_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_runs" ADD CONSTRAINT "investment_plan_runs_plan_id_investment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."investment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_runs" ADD CONSTRAINT "investment_plan_runs_debit_transaction_id_transactions_id_fk" FOREIGN KEY ("debit_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_debit_account_id_accounts_id_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_plan_runs_user_idx" ON "investment_plan_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_plans_account_idx" ON "investment_plans" USING btree ("investment_account_id");--> statement-breakpoint
CREATE INDEX "investment_plans_user_idx" ON "investment_plans" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_plan_run_id_investment_plan_runs_id_fk" FOREIGN KEY ("plan_run_id") REFERENCES "public"."investment_plan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_plan_run_uq" UNIQUE("plan_run_id");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_event_ck" CHECK ("notification_preferences"."event" in ('connection_failed', 'connection_stale', 'connection_expiring', 'account_low_balance', 'budget_threshold', 'monthly_summary', 'transactions_to_categorize', 'payslips_to_review', 'transfers_to_confirm', 'fund_to_verify', 'plan_run_to_confirm', 'plan_run_no_cash', 'plan_run_price_missing'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_ck" CHECK ("notifications"."event" in ('connection_failed', 'connection_stale', 'connection_expiring', 'account_low_balance', 'budget_threshold', 'monthly_summary', 'transactions_to_categorize', 'payslips_to_review', 'transfers_to_confirm', 'fund_to_verify', 'plan_run_to_confirm', 'plan_run_no_cash', 'plan_run_price_missing'));