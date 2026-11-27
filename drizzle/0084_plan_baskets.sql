CREATE TABLE "investment_plan_instruments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"weight_bp" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_plan_instruments_uq" UNIQUE("plan_id","asset_id"),
	CONSTRAINT "investment_plan_instruments_weight_ck" CHECK ("investment_plan_instruments"."weight_bp" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "investment_plan_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"weight_bp" integer NOT NULL,
	"price" numeric(30, 12),
	"price_currency" text,
	"price_on" date,
	"fx_rate" numeric(20, 10),
	"target_cents" bigint NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"spent_cents" bigint NOT NULL,
	"state" text NOT NULL,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_plan_run_lines_uq" UNIQUE("run_id","asset_id"),
	CONSTRAINT "investment_plan_run_lines_event_uq" UNIQUE("event_id"),
	CONSTRAINT "investment_plan_run_lines_state_ck" CHECK ("investment_plan_run_lines"."state" in ('buy', 'too_expensive', 'price_missing'))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_event_ck";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_event_ck";--> statement-breakpoint
ALTER TABLE "investment_plan_runs" DROP CONSTRAINT "investment_plan_runs_state_ck";--> statement-breakpoint
ALTER TABLE "investment_plans" DROP CONSTRAINT "investment_plans_frequency_ck";--> statement-breakpoint
ALTER TABLE "investment_plan_runs" ADD COLUMN "budget_cents" bigint;--> statement-breakpoint
ALTER TABLE "investment_plan_runs" ADD COLUMN "carry_in_cents" bigint;--> statement-breakpoint
ALTER TABLE "investment_plan_runs" ADD COLUMN "carry_out_cents" bigint;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD COLUMN "model" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD COLUMN "execution_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "investment_plan_instruments" ADD CONSTRAINT "investment_plan_instruments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_instruments" ADD CONSTRAINT "investment_plan_instruments_plan_id_investment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."investment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_instruments" ADD CONSTRAINT "investment_plan_instruments_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_run_lines" ADD CONSTRAINT "investment_plan_run_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_run_lines" ADD CONSTRAINT "investment_plan_run_lines_run_id_investment_plan_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."investment_plan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_run_lines" ADD CONSTRAINT "investment_plan_run_lines_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_run_lines" ADD CONSTRAINT "investment_plan_run_lines_event_id_investment_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."investment_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_plan_instruments_user_idx" ON "investment_plan_instruments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_plan_run_lines_user_idx" ON "investment_plan_run_lines" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_event_ck" CHECK ("notification_preferences"."event" in ('connection_failed', 'connection_stale', 'connection_expiring', 'account_low_balance', 'budget_threshold', 'monthly_summary', 'transactions_to_categorize', 'payslips_to_review', 'transfers_to_confirm', 'fund_to_verify', 'plan_run_to_confirm', 'plan_run_no_cash', 'plan_run_price_missing', 'plan_amount_missing'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_ck" CHECK ("notifications"."event" in ('connection_failed', 'connection_stale', 'connection_expiring', 'account_low_balance', 'budget_threshold', 'monthly_summary', 'transactions_to_categorize', 'payslips_to_review', 'transfers_to_confirm', 'fund_to_verify', 'plan_run_to_confirm', 'plan_run_no_cash', 'plan_run_price_missing', 'plan_amount_missing'));--> statement-breakpoint
ALTER TABLE "investment_plan_runs" ADD CONSTRAINT "investment_plan_runs_state_ck" CHECK ("investment_plan_runs"."state" in ('pending', 'waiting_price', 'proposed', 'recorded', 'skipped', 'expired'));--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_model_ck" CHECK ("investment_plans"."model" in ('single', 'basket'));--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_execution_ck" CHECK ("investment_plans"."execution_amount_cents" is null or "investment_plans"."execution_amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_frequency_ck" CHECK ("investment_plans"."frequency" in ('day', 'week', 'month', 'quarter'));--> statement-breakpoint
-- PERS-681 §3.5: the plans of R5d become baskets of one instrument at 100 %, with the amount to type again (M4). Their R5d columns stay as they are, so the previous image still reads them.
INSERT INTO "investment_plan_instruments" ("user_id", "plan_id", "asset_id", "weight_bp") SELECT "user_id", "id", "asset_id", 10000 FROM "investment_plans" WHERE "model" = 'single' ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "investment_plan_runs" SET "state" = 'skipped', "reason" = 'amount_missing', "updated_at" = now() WHERE "state" IN ('pending', 'waiting_price', 'proposed') AND "plan_id" IN (SELECT "id" FROM "investment_plans" WHERE "model" = 'single');--> statement-breakpoint
UPDATE "investment_plans" SET "model" = 'basket', "execution_amount_cents" = NULL, "updated_at" = now() WHERE "model" = 'single';
