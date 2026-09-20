CREATE TABLE "budget_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"from_month" date NOT NULL,
	"amount_cents" bigint,
	"stopped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_limits_category_month_uq" UNIQUE("user_id","category_id","from_month"),
	CONSTRAINT "budget_limits_month_ck" CHECK (extract(day from "budget_limits"."from_month") = 1),
	CONSTRAINT "budget_limits_amount_ck" CHECK (("budget_limits"."stopped" and "budget_limits"."amount_cents" is null) or (not "budget_limits"."stopped" and "budget_limits"."amount_cents" > 0))
);
--> statement-breakpoint
CREATE TABLE "pocket_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"pocket_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pocket_movements_kind_ck" CHECK ("pocket_movements"."kind" in ('accrual', 'deposit', 'withdrawal', 'adjustment')),
	CONSTRAINT "pocket_movements_sign_ck" CHECK (case "pocket_movements"."kind" when 'accrual' then "pocket_movements"."amount_cents" > 0 when 'deposit' then "pocket_movements"."amount_cents" > 0 when 'withdrawal' then "pocket_movements"."amount_cents" < 0 else "pocket_movements"."amount_cents" <> 0 end),
	CONSTRAINT "pocket_movements_accrual_day_ck" CHECK ("pocket_movements"."kind" <> 'accrual' or extract(day from "pocket_movements"."on") = 1),
	CONSTRAINT "pocket_movements_reason_ck" CHECK ("pocket_movements"."kind" not in ('withdrawal', 'adjustment') or length(btrim(coalesce("pocket_movements"."reason", ''))) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "pockets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"backing_account_id" uuid,
	"target_cents" bigint,
	"monthly_cents" bigint,
	"start_month" date NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pockets_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "pockets_state_ck" CHECK ("pockets"."state" in ('active', 'paused', 'archived')),
	CONSTRAINT "pockets_name_ck" CHECK (length(btrim("pockets"."name")) between 1 and 60),
	CONSTRAINT "pockets_target_ck" CHECK ("pockets"."target_cents" is null or "pockets"."target_cents" > 0),
	CONSTRAINT "pockets_monthly_ck" CHECK ("pockets"."monthly_cents" is null or "pockets"."monthly_cents" > 0),
	CONSTRAINT "pockets_start_ck" CHECK (extract(day from "pockets"."start_month") = 1),
	CONSTRAINT "pockets_archived_ck" CHECK (("pockets"."state" = 'archived') = ("pockets"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "subscription_charges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"transaction_id" uuid,
	"expected_cents" bigint NOT NULL,
	"actual_cents" bigint,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_charges_due_uq" UNIQUE("subscription_id","due_on"),
	CONSTRAINT "subscription_charges_transaction_uq" UNIQUE("transaction_id"),
	CONSTRAINT "subscription_charges_state_ck" CHECK ("subscription_charges"."state" in ('paid', 'amount_differs', 'due', 'not_found')),
	CONSTRAINT "subscription_charges_period_ck" CHECK ("subscription_charges"."period_from" <= "subscription_charges"."due_on" and "subscription_charges"."due_on" <= "subscription_charges"."period_to"),
	CONSTRAINT "subscription_charges_expected_ck" CHECK ("subscription_charges"."expected_cents" > 0),
	CONSTRAINT "subscription_charges_actual_ck" CHECK (("subscription_charges"."state" in ('paid', 'amount_differs')) = ("subscription_charges"."actual_cents" is not null))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"utility" smallint DEFAULT 5 NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"cycle" text NOT NULL,
	"next_charge_on" date NOT NULL,
	"payment_account_id" uuid,
	"payee_match" text,
	"tolerance" numeric(10, 6) DEFAULT '0.05' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_cycle_ck" CHECK ("subscriptions"."cycle" in ('weekly', 'monthly', 'quarterly', 'yearly')),
	CONSTRAINT "subscriptions_state_ck" CHECK ("subscriptions"."state" in ('active', 'paused', 'cancelled')),
	CONSTRAINT "subscriptions_name_ck" CHECK (length(btrim("subscriptions"."name")) between 1 and 80),
	CONSTRAINT "subscriptions_utility_ck" CHECK ("subscriptions"."utility" between 1 and 10),
	CONSTRAINT "subscriptions_price_ck" CHECK ("subscriptions"."price_cents" > 0),
	CONSTRAINT "subscriptions_currency_ck" CHECK ("subscriptions"."currency" = 'EUR'),
	CONSTRAINT "subscriptions_tolerance_ck" CHECK ("subscriptions"."tolerance" between 0 and 1),
	CONSTRAINT "subscriptions_match_ck" CHECK ("subscriptions"."payee_match" is null or length(btrim("subscriptions"."payee_match")) between 1 and 80),
	CONSTRAINT "subscriptions_cancelled_ck" CHECK (("subscriptions"."state" = 'cancelled') = ("subscriptions"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocket_movements" ADD CONSTRAINT "pocket_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocket_movements" ADD CONSTRAINT "pocket_movements_pocket_id_pockets_id_fk" FOREIGN KEY ("pocket_id") REFERENCES "public"."pockets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pockets" ADD CONSTRAINT "pockets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pockets" ADD CONSTRAINT "pockets_backing_account_id_accounts_id_fk" FOREIGN KEY ("backing_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_limits_user_month_idx" ON "budget_limits" USING btree ("user_id","from_month");--> statement-breakpoint
CREATE INDEX "pocket_movements_pocket_on_idx" ON "pocket_movements" USING btree ("pocket_id","on");--> statement-breakpoint
CREATE INDEX "pocket_movements_user_idx" ON "pocket_movements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pocket_movements_accrual_uq" ON "pocket_movements" USING btree ("pocket_id","on") WHERE "pocket_movements"."kind" = 'accrual';--> statement-breakpoint
CREATE INDEX "pockets_backing_idx" ON "pockets" USING btree ("backing_account_id");--> statement-breakpoint
CREATE INDEX "subscription_charges_sub_due_idx" ON "subscription_charges" USING btree ("subscription_id","due_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "subscription_charges_user_idx" ON "subscription_charges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id","name","id");--> statement-breakpoint
CREATE INDEX "subscriptions_account_idx" ON "subscriptions" USING btree ("payment_account_id");