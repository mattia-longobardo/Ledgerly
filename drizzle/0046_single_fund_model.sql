CREATE TABLE "fund_contribution_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"components" text[],
	"accrual_period" text,
	"employer" text,
	"due_day" smallint,
	"due_offset_months" smallint,
	"due_entries" jsonb,
	"tolerance_days" smallint,
	"account_id" uuid,
	"payee_match" text,
	"amount_cents" bigint,
	"debit_day" smallint,
	"interval_count" smallint,
	"interval_unit" text,
	"valid_from" date,
	"valid_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_contribution_sources_kind_ck" CHECK ("fund_contribution_sources"."kind" in ('payroll', 'bank_debit', 'manual')),
	CONSTRAINT "fund_contribution_sources_state_ck" CHECK ("fund_contribution_sources"."state" in ('active', 'paused')),
	CONSTRAINT "fund_contribution_sources_components_ck" CHECK (("fund_contribution_sources"."kind" = 'payroll') = ("fund_contribution_sources"."components" is not null) and ("fund_contribution_sources"."components" is null or (cardinality("fund_contribution_sources"."components") between 1 and 3 and "fund_contribution_sources"."components" <@ array['worker', 'employer', 'tfr']::text[]))),
	CONSTRAINT "fund_contribution_sources_period_ck" CHECK (("fund_contribution_sources"."kind" = 'payroll') = ("fund_contribution_sources"."accrual_period" is not null) and ("fund_contribution_sources"."accrual_period" is null or "fund_contribution_sources"."accrual_period" in ('month', 'quarter'))),
	CONSTRAINT "fund_contribution_sources_due_ck" CHECK (("fund_contribution_sources"."due_day" is null) = ("fund_contribution_sources"."due_offset_months" is null) and ("fund_contribution_sources"."due_day" is null or ("fund_contribution_sources"."due_day" between 1 and 31 and "fund_contribution_sources"."due_offset_months" between 0 and 3)) and ("fund_contribution_sources"."tolerance_days" is null or "fund_contribution_sources"."tolerance_days" between 0 and 120)),
	CONSTRAINT "fund_contribution_sources_interval_ck" CHECK (("fund_contribution_sources"."kind" = 'bank_debit') = ("fund_contribution_sources"."interval_count" is not null) and ("fund_contribution_sources"."interval_count" is null) = ("fund_contribution_sources"."interval_unit" is null) and ("fund_contribution_sources"."interval_count" is null or ("fund_contribution_sources"."interval_count" between 1 and 120 and "fund_contribution_sources"."interval_unit" in ('week', 'month', 'year')))),
	CONSTRAINT "fund_contribution_sources_debit_ck" CHECK (("fund_contribution_sources"."amount_cents" is null or "fund_contribution_sources"."amount_cents" > 0) and ("fund_contribution_sources"."debit_day" is null or "fund_contribution_sources"."debit_day" between 1 and 31) and ("fund_contribution_sources"."payee_match" is null or length(btrim("fund_contribution_sources"."payee_match")) between 1 and 80)),
	CONSTRAINT "fund_contribution_sources_validity_ck" CHECK ("fund_contribution_sources"."valid_to" is null or "fund_contribution_sources"."valid_from" is null or "fund_contribution_sources"."valid_to" >= "fund_contribution_sources"."valid_from"),
	CONSTRAINT "fund_contribution_sources_text_ck" CHECK (coalesce(length("fund_contribution_sources"."employer"), 0) <= 120 and coalesce(length("fund_contribution_sources"."note"), 0) <= 300)
);
--> statement-breakpoint
CREATE TABLE "fund_fees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"label" text NOT NULL,
	"basis" text NOT NULL,
	"amount_cents" bigint,
	"rate" numeric(8, 6),
	"period" text,
	"source_id" uuid,
	"component" text,
	"valid_from" date,
	"valid_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_fees_label_ck" CHECK (length(btrim("fund_fees"."label")) between 1 and 80),
	CONSTRAINT "fund_fees_basis_ck" CHECK ("fund_fees"."basis" in ('one_off', 'per_contribution', 'periodic', 'on_assets', 'per_request')),
	CONSTRAINT "fund_fees_value_ck" CHECK (("fund_fees"."amount_cents" is null) <> ("fund_fees"."rate" is null) and ("fund_fees"."amount_cents" is null or "fund_fees"."amount_cents" > 0) and ("fund_fees"."rate" is null or ("fund_fees"."rate" > 0 and "fund_fees"."rate" <= 1))),
	CONSTRAINT "fund_fees_period_ck" CHECK (("fund_fees"."basis" in ('periodic', 'on_assets')) = ("fund_fees"."period" is not null) and ("fund_fees"."period" is null or "fund_fees"."period" in ('month', 'quarter', 'year'))),
	CONSTRAINT "fund_fees_component_ck" CHECK ("fund_fees"."component" is null or "fund_fees"."component" in ('worker', 'employer', 'tfr')),
	CONSTRAINT "fund_fees_validity_ck" CHECK ("fund_fees"."valid_to" is null or "fund_fees"."valid_from" is null or "fund_fees"."valid_to" >= "fund_fees"."valid_from"),
	CONSTRAINT "fund_fees_note_ck" CHECK ("fund_fees"."note" is null or length("fund_fees"."note") <= 300)
);
--> statement-breakpoint
ALTER TABLE "fund_operations" DROP CONSTRAINT "fund_operations_source_ck";--> statement-breakpoint
ALTER TABLE "fund_operations" DROP CONSTRAINT "fund_operations_quarter_ck";--> statement-breakpoint
ALTER TABLE "reconciliation_links" DROP CONSTRAINT "reconciliation_links_quarter_ck";--> statement-breakpoint
ALTER TABLE "funds" ALTER COLUMN "type" SET DEFAULT 'pension';--> statement-breakpoint
ALTER TABLE "fund_operations" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "fund_operations" ADD COLUMN "fees_unknown" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "funds" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "fund_contribution_sources" ADD CONSTRAINT "fund_contribution_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_contribution_sources" ADD CONSTRAINT "fund_contribution_sources_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_contribution_sources" ADD CONSTRAINT "fund_contribution_sources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_fees" ADD CONSTRAINT "fund_fees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_fees" ADD CONSTRAINT "fund_fees_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_fees" ADD CONSTRAINT "fund_fees_source_id_fund_contribution_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."fund_contribution_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fund_contribution_sources_fund_idx" ON "fund_contribution_sources" USING btree ("fund_id","kind");--> statement-breakpoint
CREATE INDEX "fund_contribution_sources_account_idx" ON "fund_contribution_sources" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_contribution_sources_manual_uq" ON "fund_contribution_sources" USING btree ("fund_id") WHERE "fund_contribution_sources"."kind" = 'manual';--> statement-breakpoint
CREATE INDEX "fund_fees_fund_idx" ON "fund_fees" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "fund_fees_source_idx" ON "fund_fees" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_source_id_fund_contribution_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."fund_contribution_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fund_operations_source_idx" ON "fund_operations" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_source_ck" CHECK ("fund_operations"."source" in ('import', 'manual', 'rule'));--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_quarter_ck" CHECK (("fund_operations"."competence_year" is null) = ("fund_operations"."competence_quarter" is null) and ("fund_operations"."competence_quarter" is null or "fund_operations"."competence_quarter" between 1 and 12));--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_code_ck" CHECK ("funds"."code" is null or length("funds"."code") <= 40);--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_quarter_ck" CHECK ("reconciliation_links"."quarter" between 1 and 12);