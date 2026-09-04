CREATE TABLE "interest_accruals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rule_id" uuid NOT NULL,
	"accrual_date" date NOT NULL,
	"balance_basis" numeric(16, 2) NOT NULL,
	"gross" numeric(16, 6) NOT NULL,
	"tax" numeric(16, 6) NOT NULL,
	"net" numeric(16, 2) NOT NULL,
	"carry_after" numeric(16, 6) NOT NULL,
	"source" text DEFAULT 'computed' NOT NULL,
	"posted_at" timestamp with time zone,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_accruals_source_ck" CHECK ("interest_accruals"."source" IN ('computed'))
);
--> statement-breakpoint
CREATE TABLE "interest_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"gross" numeric(16, 2) NOT NULL,
	"net" numeric(16, 2) NOT NULL,
	"kind" text NOT NULL,
	"transaction_id" uuid,
	"rule_id" uuid,
	"source" text DEFAULT 'computed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_entries_kind_ck" CHECK ("interest_entries"."kind" IN ('paid','projected','adjustment'))
);
--> statement-breakpoint
CREATE TABLE "interest_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"annual_rate" numeric(10, 6) NOT NULL,
	"tax_rate" numeric(10, 6) DEFAULT '0' NOT NULL,
	"day_count" text DEFAULT '365' NOT NULL,
	"compounding" text DEFAULT 'simple_daily' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"posting_mode" text DEFAULT 'analyze_only' NOT NULL,
	"provider_category_ref" text,
	"note_marker" text DEFAULT 'auto-interest' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_rules_day_count_ck" CHECK ("interest_rules"."day_count" IN ('365','360','actual')),
	CONSTRAINT "interest_rules_compounding_ck" CHECK ("interest_rules"."compounding" IN ('simple_daily','monthly','none')),
	CONSTRAINT "interest_rules_posting_mode_ck" CHECK ("interest_rules"."posting_mode" IN ('analyze_only','post_to_provider'))
);
--> statement-breakpoint
ALTER TABLE "interest_accruals" ADD CONSTRAINT "interest_accruals_rule_id_interest_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."interest_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_entries" ADD CONSTRAINT "interest_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_entries" ADD CONSTRAINT "interest_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interest_accruals_rule_date_uq" ON "interest_accruals" USING btree ("rule_id","accrual_date");--> statement-breakpoint
CREATE INDEX "interest_entries_user_occurred_idx" ON "interest_entries" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "interest_rules_user_idx" ON "interest_rules" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE interest_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interest_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY interest_rules_owner ON interest_rules
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE interest_accruals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interest_accruals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY interest_accruals_owner ON interest_accruals
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM interest_rules r WHERE r.id = rule_id AND r.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR EXISTS (
    SELECT 1 FROM interest_rules r WHERE r.id = rule_id AND r.user_id = app_current_user_id()
  ));
--> statement-breakpoint
ALTER TABLE interest_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interest_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY interest_entries_owner ON interest_entries
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
