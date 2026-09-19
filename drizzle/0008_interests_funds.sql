CREATE TABLE "fund_deposit_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"payee_match" text NOT NULL,
	"account_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_deposit_rules_fund_uq" UNIQUE("fund_id"),
	CONSTRAINT "fund_deposit_rules_match_ck" CHECK (length(btrim("fund_deposit_rules"."payee_match")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "fund_deposits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"on" date NOT NULL,
	"charged_cents" bigint NOT NULL,
	"fee_cents" bigint,
	"invested_cents" bigint GENERATED ALWAYS AS (charged_cents - fee_cents) STORED,
	"transaction_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_deposits_transaction_uq" UNIQUE("transaction_id"),
	CONSTRAINT "fund_deposits_source_ck" CHECK ("fund_deposits"."source" in ('manual', 'rule')),
	CONSTRAINT "fund_deposits_charged_ck" CHECK ("fund_deposits"."charged_cents" > 0),
	CONSTRAINT "fund_deposits_fee_ck" CHECK ("fund_deposits"."fee_cents" is null or ("fund_deposits"."fee_cents" >= 0 and "fund_deposits"."fee_cents" <= "fund_deposits"."charged_cents"))
);
--> statement-breakpoint
CREATE TABLE "fund_valuations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"balance_entry_id" uuid NOT NULL,
	"units" numeric(18, 6),
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_valuations_entry_uq" UNIQUE("balance_entry_id"),
	CONSTRAINT "fund_valuations_source_ck" CHECK ("fund_valuations"."source" in ('manual', 'import')),
	CONSTRAINT "fund_valuations_units_ck" CHECK ("fund_valuations"."units" is null or "fund_valuations"."units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"provider" text,
	"isin" text,
	"compartment" text,
	"valuation_account_id" uuid NOT NULL,
	"debit_account_id" uuid,
	"debit_day" smallint,
	"ter" numeric(10, 6),
	"start_on" date NOT NULL,
	"monthly_cents" bigint,
	"deposit_fee_cents" bigint,
	"state" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funds_valuation_account_uq" UNIQUE("valuation_account_id"),
	CONSTRAINT "funds_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "funds_type_ck" CHECK ("funds"."type" in ('pac', 'pension')),
	CONSTRAINT "funds_state_ck" CHECK ("funds"."state" in ('active', 'archived')),
	CONSTRAINT "funds_name_ck" CHECK (length(btrim("funds"."name")) between 1 and 80),
	CONSTRAINT "funds_isin_ck" CHECK ("funds"."isin" is null or "funds"."isin" ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
	CONSTRAINT "funds_debit_day_ck" CHECK ("funds"."debit_day" is null or "funds"."debit_day" between 1 and 31),
	CONSTRAINT "funds_ter_ck" CHECK ("funds"."ter" is null or "funds"."ter" between 0 and 1),
	CONSTRAINT "funds_monthly_ck" CHECK ("funds"."monthly_cents" is null or "funds"."monthly_cents" > 0),
	CONSTRAINT "funds_fee_ck" CHECK ("funds"."deposit_fee_cents" is null or "funds"."deposit_fee_cents" >= 0),
	CONSTRAINT "funds_archived_ck" CHECK (("funds"."state" = 'archived') = ("funds"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "interest_accruals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"on" date NOT NULL,
	"balance_cents" bigint,
	"gross" numeric(24, 12) NOT NULL,
	"net_cents" bigint NOT NULL,
	"carry" numeric(24, 12) NOT NULL,
	"status" text NOT NULL,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_accruals_day_uq" UNIQUE("rule_id","on"),
	CONSTRAINT "interest_accruals_status_ck" CHECK ("interest_accruals"."status" in ('accrued', 'negative_balance', 'no_balance')),
	CONSTRAINT "interest_accruals_net_ck" CHECK ("interest_accruals"."net_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "interest_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"settle_on" date NOT NULL,
	"gross_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"posting" text DEFAULT 'none' NOT NULL,
	"posted_at" timestamp with time zone,
	"posting_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_entries_period_uq" UNIQUE("rule_id","period_from"),
	CONSTRAINT "interest_entries_posting_ck" CHECK ("interest_entries"."posting" in ('none', 'claimed', 'posted', 'indeterminate')),
	CONSTRAINT "interest_entries_period_ck" CHECK ("interest_entries"."period_from" <= "interest_entries"."period_to" and "interest_entries"."period_to" < "interest_entries"."settle_on"),
	CONSTRAINT "interest_entries_net_ck" CHECK ("interest_entries"."net_cents" >= 0 and "interest_entries"."gross_cents" >= 0 and "interest_entries"."tax_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "interest_rule_tiers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"up_to_cents" bigint,
	"annual_rate" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_rule_tiers_position_uq" UNIQUE("rule_id","position"),
	CONSTRAINT "interest_rule_tiers_position_ck" CHECK ("interest_rule_tiers"."position" between 0 and 9),
	CONSTRAINT "interest_rule_tiers_threshold_ck" CHECK ("interest_rule_tiers"."up_to_cents" is null or "interest_rule_tiers"."up_to_cents" > 0),
	CONSTRAINT "interest_rule_tiers_rate_ck" CHECK ("interest_rule_tiers"."annual_rate" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "interest_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"tax_rate" numeric(10, 6) DEFAULT '0.26' NOT NULL,
	"day_basis" text DEFAULT '365' NOT NULL,
	"settlement" text DEFAULT 'monthly' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"mode" text DEFAULT 'analyze_only' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"payee_match" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_rules_tax_ck" CHECK ("interest_rules"."tax_rate" between 0 and 1),
	CONSTRAINT "interest_rules_basis_ck" CHECK ("interest_rules"."day_basis" in ('365', '360')),
	CONSTRAINT "interest_rules_settlement_ck" CHECK ("interest_rules"."settlement" in ('monthly', 'quarterly', 'annual')),
	CONSTRAINT "interest_rules_mode_ck" CHECK ("interest_rules"."mode" in ('analyze_only', 'post_to_provider')),
	CONSTRAINT "interest_rules_state_ck" CHECK ("interest_rules"."state" in ('active', 'paused')),
	CONSTRAINT "interest_rules_validity_ck" CHECK ("interest_rules"."valid_to" is null or "interest_rules"."valid_to" >= "interest_rules"."valid_from"),
	CONSTRAINT "interest_rules_match_ck" CHECK ("interest_rules"."payee_match" is null or length(btrim("interest_rules"."payee_match")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "fund_deposit_rules" ADD CONSTRAINT "fund_deposit_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_deposit_rules" ADD CONSTRAINT "fund_deposit_rules_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_deposit_rules" ADD CONSTRAINT "fund_deposit_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_deposits" ADD CONSTRAINT "fund_deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_deposits" ADD CONSTRAINT "fund_deposits_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_deposits" ADD CONSTRAINT "fund_deposits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_valuations" ADD CONSTRAINT "fund_valuations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_valuations" ADD CONSTRAINT "fund_valuations_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_valuations" ADD CONSTRAINT "fund_valuations_balance_entry_id_balance_entries_id_fk" FOREIGN KEY ("balance_entry_id") REFERENCES "public"."balance_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_valuation_account_id_accounts_id_fk" FOREIGN KEY ("valuation_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_debit_account_id_accounts_id_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_accruals" ADD CONSTRAINT "interest_accruals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_accruals" ADD CONSTRAINT "interest_accruals_rule_id_interest_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."interest_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_accruals" ADD CONSTRAINT "interest_accruals_entry_id_interest_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."interest_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_entries" ADD CONSTRAINT "interest_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_entries" ADD CONSTRAINT "interest_entries_rule_id_interest_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."interest_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_rule_tiers" ADD CONSTRAINT "interest_rule_tiers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_rule_tiers" ADD CONSTRAINT "interest_rule_tiers_rule_id_interest_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."interest_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fund_deposit_rules_account_idx" ON "fund_deposit_rules" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "fund_deposits_fund_on_idx" ON "fund_deposits" USING btree ("fund_id","on");--> statement-breakpoint
CREATE INDEX "fund_valuations_fund_idx" ON "fund_valuations" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "funds_debit_account_idx" ON "funds" USING btree ("debit_account_id");--> statement-breakpoint
CREATE INDEX "interest_accruals_entry_idx" ON "interest_accruals" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "interest_entries_user_idx" ON "interest_entries" USING btree ("user_id","settle_on");--> statement-breakpoint
CREATE UNIQUE INDEX "interest_rule_tiers_open_uq" ON "interest_rule_tiers" USING btree ("rule_id") WHERE "interest_rule_tiers"."up_to_cents" is null;--> statement-breakpoint
CREATE INDEX "interest_rules_account_idx" ON "interest_rules" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "interest_rules_user_idx" ON "interest_rules" USING btree ("user_id","valid_from","id");