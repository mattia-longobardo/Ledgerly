CREATE TABLE "fund_fee_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"item" text NOT NULL,
	"amount_cents" bigint,
	"rate" numeric(8, 6),
	"unit" text NOT NULL,
	"note" text,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_fee_tariffs_item_uq" UNIQUE("provider","item","valid_from"),
	CONSTRAINT "fund_fee_tariffs_value_ck" CHECK (("fund_fee_tariffs"."amount_cents" is null) <> ("fund_fee_tariffs"."rate" is null))
);
--> statement-breakpoint
CREATE TABLE "fund_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"document_id" uuid,
	"origin_key" text NOT NULL,
	"original_type" text NOT NULL,
	"classification" text NOT NULL,
	"original_state" text,
	"competence_year" smallint,
	"competence_quarter" smallint,
	"operation_date" date NOT NULL,
	"worker_cents" bigint DEFAULT 0 NOT NULL,
	"employer_cents" bigint DEFAULT 0 NOT NULL,
	"tfr_cents" bigint DEFAULT 0 NOT NULL,
	"other_cents" bigint DEFAULT 0 NOT NULL,
	"fees_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint NOT NULL,
	"employer_tax_code" text,
	"employer_name" text,
	"transaction_id" uuid,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_operations_origin_uq" UNIQUE("fund_id","origin_key"),
	CONSTRAINT "fund_operations_transaction_uq" UNIQUE("transaction_id"),
	CONSTRAINT "fund_operations_class_ck" CHECK ("fund_operations"."classification" in ('contribution', 'enrollment', 'voluntary', 'transfer_in', 'switch', 'withdrawal', 'other')),
	CONSTRAINT "fund_operations_source_ck" CHECK ("fund_operations"."source" in ('import', 'manual')),
	CONSTRAINT "fund_operations_quarter_ck" CHECK (("fund_operations"."competence_year" is null) = ("fund_operations"."competence_quarter" is null) and ("fund_operations"."competence_quarter" is null or "fund_operations"."competence_quarter" between 1 and 4)),
	CONSTRAINT "fund_operations_fees_ck" CHECK ("fund_operations"."fees_cents" >= 0),
	CONSTRAINT "fund_operations_note_ck" CHECK ("fund_operations"."note" is null or length("fund_operations"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "pension_competences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"payroll_period" date,
	"payslip_type" text NOT NULL,
	"year" smallint NOT NULL,
	"quarter" smallint NOT NULL,
	"worker_cents" bigint,
	"employer_cents" bigint,
	"tfr_cents" bigint,
	"worker_enrollment_cents" bigint,
	"employer_enrollment_cents" bigint,
	"worker_adjustment_cents" bigint,
	"employer_adjustment_cents" bigint,
	"source_line_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pension_competences_payslip_uq" UNIQUE("payslip_id"),
	CONSTRAINT "pension_competences_quarter_ck" CHECK ("pension_competences"."quarter" between 1 and 4),
	CONSTRAINT "pension_competences_year_ck" CHECK ("pension_competences"."year" between 1990 and 2200),
	CONSTRAINT "pension_competences_period_ck" CHECK ("pension_competences"."payroll_period" is null or extract(day from "pension_competences"."payroll_period") = 1)
);
--> statement-breakpoint
CREATE TABLE "pension_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"ccnl" text,
	"base" text,
	"worker_pct" numeric(7, 4),
	"employer_pct" numeric(7, 4),
	"tfr_pct" numeric(7, 4),
	"schedule" jsonb,
	"tolerance_days" smallint DEFAULT 15 NOT NULL,
	"source" text,
	"verified_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pension_rules_kind_ck" CHECK ("pension_rules"."kind" in ('contribution', 'payment_schedule')),
	CONSTRAINT "pension_rules_validity_ck" CHECK ("pension_rules"."valid_to" is null or "pension_rules"."valid_to" >= "pension_rules"."valid_from"),
	CONSTRAINT "pension_rules_tolerance_ck" CHECK ("pension_rules"."tolerance_days" between 0 and 120),
	CONSTRAINT "pension_rules_pct_ck" CHECK (coalesce("pension_rules"."worker_pct", 0) between 0 and 100 and coalesce("pension_rules"."employer_pct", 0) between 0 and 100 and coalesce("pension_rules"."tfr_pct", 0) between 0 and 100),
	CONSTRAINT "pension_rules_schedule_ck" CHECK (("pension_rules"."kind" = 'payment_schedule') = ("pension_rules"."schedule" is not null)),
	CONSTRAINT "pension_rules_text_ck" CHECK (coalesce(length("pension_rules"."ccnl"), 0) <= 120 and coalesce(length("pension_rules"."base"), 0) <= 200 and coalesce(length("pension_rules"."source"), 0) <= 300)
);
--> statement-breakpoint
CREATE TABLE "position_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"document_id" uuid,
	"balance_entry_id" uuid NOT NULL,
	"valuation_date" date NOT NULL,
	"value_cents" bigint NOT NULL,
	"tfr_cents" bigint,
	"worker_cents" bigint,
	"employer_cents" bigint,
	"transfers_in_cents" bigint,
	"inflows_cents" bigint,
	"advances_cents" bigint,
	"redemptions_cents" bigint,
	"rita_cents" bigint,
	"outflows_cents" bigint,
	"reported_gain_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_snapshots_date_uq" UNIQUE("fund_id","valuation_date"),
	CONSTRAINT "position_snapshots_entry_uq" UNIQUE("balance_entry_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"quarter" smallint NOT NULL,
	"component" text NOT NULL,
	"competence_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"operation_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"accrued_cents" bigint,
	"credited_cents" bigint,
	"difference_cents" bigint NOT NULL,
	"decision" text NOT NULL,
	"note" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_links_key_uq" UNIQUE("fund_id","year","quarter","component"),
	CONSTRAINT "reconciliation_links_quarter_ck" CHECK ("reconciliation_links"."quarter" between 1 and 4),
	CONSTRAINT "reconciliation_links_component_ck" CHECK ("reconciliation_links"."component" in ('worker', 'employer', 'tfr', 'enrollment')),
	CONSTRAINT "reconciliation_links_decision_ck" CHECK ("reconciliation_links"."decision" in ('accepted_difference', 'pending')),
	CONSTRAINT "reconciliation_links_note_ck" CHECK (length(btrim("reconciliation_links"."note")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "unit_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"compartment" text NOT NULL,
	"units" numeric(18, 6) NOT NULL,
	"unit_price" numeric(14, 6),
	"unit_price_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_movements_position_uq" UNIQUE("operation_id","position"),
	CONSTRAINT "unit_movements_price_ck" CHECK ("unit_movements"."unit_price" is null or "unit_movements"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "funds" ADD COLUMN "receives_payroll" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_competences" ADD CONSTRAINT "pension_competences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_competences" ADD CONSTRAINT "pension_competences_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_rules" ADD CONSTRAINT "pension_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_rules" ADD CONSTRAINT "pension_rules_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_balance_entry_id_balance_entries_id_fk" FOREIGN KEY ("balance_entry_id") REFERENCES "public"."balance_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_movements" ADD CONSTRAINT "unit_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_movements" ADD CONSTRAINT "unit_movements_operation_id_fund_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."fund_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fund_operations_fund_idx" ON "fund_operations" USING btree ("fund_id","operation_date");--> statement-breakpoint
CREATE INDEX "fund_operations_document_idx" ON "fund_operations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "pension_competences_fund_idx" ON "pension_competences" USING btree ("fund_id","year","quarter");--> statement-breakpoint
CREATE INDEX "pension_rules_fund_idx" ON "pension_rules" USING btree ("fund_id","kind","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "funds_receives_payroll_uq" ON "funds" USING btree ("user_id") WHERE "funds"."receives_payroll";--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_receives_payroll_ck" CHECK (not "funds"."receives_payroll" or "funds"."type" = 'pension');