-- Preserve the legacy registry and every referencing row (R5-1).
ALTER TABLE "funds" RENAME TO "legacy_funds";
--> statement-breakpoint
ALTER TABLE "legacy_funds" RENAME CONSTRAINT "funds_pkey" TO "legacy_funds_pkey";
--> statement-breakpoint
ALTER TABLE "legacy_funds" RENAME CONSTRAINT "funds_slug_unique" TO "legacy_funds_slug_unique";
--> statement-breakpoint
ALTER TABLE "fund_deposits" RENAME CONSTRAINT "fund_deposits_fund_id_funds_id_fk" TO "fund_deposits_fund_id_legacy_funds_id_fk";
--> statement-breakpoint
ALTER TABLE "fund_settings" RENAME CONSTRAINT "fund_settings_fund_id_funds_id_fk" TO "fund_settings_fund_id_legacy_funds_id_fk";
--> statement-breakpoint
CREATE TABLE "funds" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" uuid NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "currency" text DEFAULT 'EUR' NOT NULL,
  "account_id" uuid,
  "status" text DEFAULT 'active' NOT NULL,
  "archived_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_contribution_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"fund_id" uuid NOT NULL,
	"frequency" text NOT NULL,
	"period_anchor_month" smallint DEFAULT 1 NOT NULL,
	"posting_lag_months" smallint DEFAULT 1 NOT NULL,
	"fee_per_posting" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_schedules_frequency_ck" CHECK ("fund_contribution_schedules"."frequency" IN ('monthly','quarterly','annual')),
	CONSTRAINT "fund_schedules_anchor_ck" CHECK ("fund_contribution_schedules"."period_anchor_month" BETWEEN 1 AND 12),
	CONSTRAINT "fund_schedules_lag_ck" CHECK ("fund_contribution_schedules"."posting_lag_months" BETWEEN 0 AND 12)
);
--> statement-breakpoint
CREATE TABLE "fund_contribution_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sign" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_contributions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"fund_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"accrual_period_start" date NOT NULL,
	"accrual_period_end" date NOT NULL,
	"posted_month" date NOT NULL,
	"value_date" date,
	"amount" numeric(16, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"source" text NOT NULL,
	"payroll_record_id" uuid,
	"note" text,
	"reverses_id" uuid,
	"reconciliation_status" text DEFAULT 'received' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_contributions_source_ck" CHECK ("fund_contributions"."source" IN ('manual','payroll','system','migration')),
	CONSTRAINT "fund_contributions_recon_ck" CHECK ("fund_contributions"."reconciliation_status" IN ('expected','received','matched','missing','delayed','duplicate','anomalous')),
	CONSTRAINT "fund_contributions_period_ck" CHECK ("fund_contributions"."accrual_period_start" <= "fund_contributions"."accrual_period_end")
);
--> statement-breakpoint
CREATE TABLE "fund_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"fund_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"initial_capital" numeric(16, 2) DEFAULT '0.00' NOT NULL,
	"fixed_monthly_amount" numeric(16, 2),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_issues" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_issues_severity_ck" CHECK ("reconciliation_issues"."severity" IN ('info','warning','error')),
	CONSTRAINT "reconciliation_issues_status_ck" CHECK ("reconciliation_issues"."status" IN ('open','acknowledged','resolved'))
);
--> statement-breakpoint
ALTER TABLE "fund_contribution_schedules" ADD CONSTRAINT "fund_contribution_schedules_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fund_contributions" ADD CONSTRAINT "fund_contributions_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fund_contributions" ADD CONSTRAINT "fund_contributions_type_code_fund_contribution_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."fund_contribution_types"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fund_contributions" ADD CONSTRAINT "fund_contributions_payroll_record_id_payroll_records_id_fk" FOREIGN KEY ("payroll_record_id") REFERENCES "public"."payroll_records"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fund_contributions" ADD CONSTRAINT "fund_contributions_reverses_id_fund_contributions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."fund_contributions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fund_plans" ADD CONSTRAINT "fund_plans_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_schedules_fund_effective_uq" ON "fund_contribution_schedules" USING btree ("fund_id","effective_from");
--> statement-breakpoint
CREATE INDEX "fund_contributions_fund_posted_idx" ON "fund_contributions" USING btree ("fund_id","posted_month");
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_contributions_payroll_uq" ON "fund_contributions" USING btree ("fund_id","type_code","payroll_record_id") WHERE payroll_record_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_contributions_system_fee_uq" ON "fund_contributions" USING btree ("fund_id","posted_month") WHERE type_code = 'fee' AND source = 'system';
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_plans_fund_effective_uq" ON "fund_plans" USING btree ("fund_id","effective_from");
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_issues_live_uq" ON "reconciliation_issues" USING btree ("user_id","domain","entity_type","entity_id","kind") WHERE status <> 'resolved';
--> statement-breakpoint
CREATE INDEX "reconciliation_issues_user_status_idx" ON "reconciliation_issues" USING btree ("user_id","status");
--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "funds_user_slug_uq" ON "funds" USING btree ("user_id","slug");
--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_kind_ck" CHECK ("funds"."kind" IN ('pension','investment','savings','other'));
--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_status_ck" CHECK ("funds"."status" IN ('active','archived'));
--> statement-breakpoint
INSERT INTO fund_contribution_types (code, label, sign) VALUES
  ('employee','Employee contribution',1), ('employer','Employer contribution',1), ('voluntary','Voluntary contribution',1),
  ('adjustment','Adjustment',0), ('reversal','Reversal',-1), ('fee','Fee',-1)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE funds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE funds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY funds_owner ON funds
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE reconciliation_issues ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reconciliation_issues FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reconciliation_issues_owner ON reconciliation_issues
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE fund_contribution_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fund_contribution_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fund_contribution_schedules_owner ON fund_contribution_schedules
  USING (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = fund_contribution_schedules.fund_id AND f.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = fund_contribution_schedules.fund_id AND f.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE fund_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fund_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fund_plans_owner ON fund_plans
  USING (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = fund_plans.fund_id AND f.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = fund_plans.fund_id AND f.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE fund_contributions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fund_contributions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fund_contributions_owner ON fund_contributions
  USING (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = fund_contributions.fund_id AND f.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM funds f WHERE f.id = fund_contributions.fund_id AND f.user_id = app_current_user_id()));
