CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"sealed" "bytea",
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_ck" CHECK ("app_settings"."key" ~ '^[a-z][a-z0-9_.]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "document_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"unit" text NOT NULL,
	"source_label" text,
	"page" smallint,
	"bbox" double precision[],
	"origin" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"raw_text" text,
	"derived_from" text[],
	"verification" text DEFAULT 'unverified' NOT NULL,
	"corrected_value" text,
	"corrected_by" uuid,
	"corrected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_evidence_field_uq" UNIQUE("document_id","field"),
	CONSTRAINT "document_evidence_unit_ck" CHECK ("document_evidence"."unit" in ('eur', 'hours', 'text', 'date')),
	CONSTRAINT "document_evidence_origin_ck" CHECK ("document_evidence"."origin" in ('printed', 'derived', 'inferred')),
	CONSTRAINT "document_evidence_verification_ck" CHECK ("document_evidence"."verification" in ('unverified', 'confirmed', 'corrected')),
	CONSTRAINT "document_evidence_confidence_ck" CHECK ("document_evidence"."confidence" between 0 and 1),
	CONSTRAINT "document_evidence_bbox_ck" CHECK ("document_evidence"."bbox" is null or (cardinality("document_evidence"."bbox") = 4 and "document_evidence"."page" is not null)),
	CONSTRAINT "document_evidence_corrected_ck" CHECK (("document_evidence"."verification" = 'corrected') = ("document_evidence"."corrected_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text,
	"state" text DEFAULT 'received' NOT NULL,
	"parser_version" text,
	"error" text,
	"retain_until" date NOT NULL,
	"original_deleted_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"extracted_at" timestamp with time zone,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_user_sha_uq" UNIQUE("user_id","sha256"),
	CONSTRAINT "documents_kind_ck" CHECK ("documents"."kind" in ('payslip', 'cometa_operations', 'cometa_position')),
	CONSTRAINT "documents_state_ck" CHECK ("documents"."state" in ('received', 'scanning', 'extracting', 'needs_review', 'needs_ocr', 'verified', 'applied', 'superseded', 'rejected', 'failed')),
	CONSTRAINT "documents_sha_ck" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_size_ck" CHECK ("documents"."size_bytes" between 1 and 10485760),
	CONSTRAINT "documents_name_ck" CHECK (length("documents"."file_name") between 1 and 200),
	CONSTRAINT "documents_original_ck" CHECK (("documents"."storage_key" is null) = ("documents"."original_deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "leave_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" date NOT NULL,
	"previous_year" numeric(8, 2),
	"accrued" numeric(8, 2),
	"used" numeric(8, 2),
	"remaining" numeric(8, 2),
	"unit" text DEFAULT 'hours' NOT NULL,
	"unit_evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_balance_snapshots_kind_uq" UNIQUE("payslip_id","kind"),
	CONSTRAINT "leave_balance_snapshots_kind_ck" CHECK ("leave_balance_snapshots"."kind" in ('vacation', 'rol', 'permit')),
	CONSTRAINT "leave_balance_snapshots_unit_ck" CHECK ("leave_balance_snapshots"."unit" = 'hours')
);
--> statement-breakpoint
CREATE TABLE "payroll_code_map" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"code" text NOT NULL,
	"role" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_code_map_code_uq" UNIQUE("user_id","profile","code"),
	CONSTRAINT "payroll_code_map_role_ck" CHECK ("payroll_code_map"."role" in ('ordinary_earnings', 'thirteenth_earnings', 'holiday_pay', 'absence', 'paid_leave', 'vacation_offset', 'vacation_event', 'permit_offset', 'permit_event', 'separate_payment', 'refund_730', 'regional_installment', 'municipal_installment', 'substitute_tax', 'substitute_tax_base', 'employee_fund', 'employee_fund_adjustment', 'employee_fund_enrollment', 'employer_fund', 'employer_fund_adjustment', 'employer_fund_enrollment', 'tfr_contribution', 'tfr_exemption', 'welfare_cash', 'welfare_in_kind', 'compensated_credit', 'statistical', 'other')),
	CONSTRAINT "payroll_code_map_code_ck" CHECK ("payroll_code_map"."code" ~ '^[0-9]{1,6}$'),
	CONSTRAINT "payroll_code_map_note_ck" CHECK ("payroll_code_map"."note" is null or length("payroll_code_map"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "payroll_leave_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"payroll_period" date NOT NULL,
	"usage_period" date NOT NULL,
	"source_line_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_leave_events_kind_ck" CHECK ("payroll_leave_events"."kind" in ('vacation', 'rol', 'permit')),
	CONSTRAINT "payroll_leave_events_hours_ck" CHECK ("payroll_leave_events"."hours" > 0),
	CONSTRAINT "payroll_leave_events_usage_ck" CHECK ("payroll_leave_events"."usage_period" = ("payroll_leave_events"."payroll_period" - interval '1 month')::date)
);
--> statement-breakpoint
CREATE TABLE "payroll_raw_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 5),
	"quantity_unit" text,
	"rate" numeric(14, 5),
	"earnings_cents" bigint,
	"deductions_cents" bigint,
	"statistical_cents" bigint,
	"page" smallint NOT NULL,
	"bbox" double precision[] NOT NULL,
	"raw_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_raw_lines_position_uq" UNIQUE("document_id","position"),
	CONSTRAINT "payroll_raw_lines_unit_ck" CHECK ("payroll_raw_lines"."quantity_unit" is null or "payroll_raw_lines"."quantity_unit" in ('hours', 'days', 'months')),
	CONSTRAINT "payroll_raw_lines_bbox_ck" CHECK (cardinality("payroll_raw_lines"."bbox") = 4)
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"employer_key" text NOT NULL,
	"employee_key" text NOT NULL,
	"year" smallint NOT NULL,
	"period" date,
	"type" text NOT NULL,
	"printed_on" date,
	"paid_on" date,
	"active" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"superseded_by" uuid,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contractual_gross" bigint,
	"ordinary_earnings" bigint,
	"total_gross_printed" bigint,
	"welfare_cash" bigint,
	"welfare_in_kind" bigint,
	"gross" bigint,
	"irpef_taxable" bigint,
	"irpef_gross" bigint,
	"tax_deductions" bigint,
	"irpef_withheld" bigint,
	"year_end_adjustment" bigint,
	"regional_installment" bigint,
	"municipal_withheld" bigint,
	"substitute_tax" bigint,
	"refund_730" bigint,
	"compensated_credit" bigint,
	"taxes_total" bigint,
	"taxes_net_of_refunds" bigint,
	"employee_social" bigint,
	"employee_fund_regular" bigint,
	"employee_fund_adjustments" bigint,
	"employee_fund_enrollment" bigint,
	"employee_fund_effective" bigint,
	"employer_fund_printed" bigint,
	"employer_fund_adjustments" bigint,
	"employer_fund_enrollment" bigint,
	"employer_fund_effective" bigint,
	"employer_social_total" bigint,
	"tfr_month_field" bigint,
	"tfr_contribution_line" bigint,
	"tfr_selected" bigint,
	"tfr_source" text,
	"body_earnings" bigint,
	"body_deductions" bigint,
	"body_deductions_printed" bigint,
	"total_deductions_printed" bigint,
	"rounding_previous" bigint,
	"rounding_current" bigint,
	"net_pay" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_document_uq" UNIQUE("document_id"),
	CONSTRAINT "payslips_type_ck" CHECK ("payslips"."type" in ('ordinary', 'thirteenth', 'fourteenth', 'bonus', 'settlement')),
	CONSTRAINT "payslips_tfr_source_ck" CHECK ("payslips"."tfr_source" is null or "payslips"."tfr_source" in ('month_field', 'contribution_line', 'both')),
	CONSTRAINT "payslips_year_ck" CHECK ("payslips"."year" between 1990 and 2200),
	CONSTRAINT "payslips_period_ck" CHECK ("payslips"."period" is null or (extract(day from "payslips"."period") = 1 and extract(year from "payslips"."period") = "payslips"."year")),
	CONSTRAINT "payslips_period_type_ck" CHECK (("payslips"."type" <> 'ordinary' or "payslips"."period" is not null) and ("payslips"."type" not in ('thirteenth', 'fourteenth') or "payslips"."period" is null)),
	CONSTRAINT "payslips_active_ck" CHECK (not "payslips"."active" or "payslips"."applied_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_evidence" ADD CONSTRAINT "document_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_evidence" ADD CONSTRAINT "document_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_evidence" ADD CONSTRAINT "document_evidence_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_snapshots" ADD CONSTRAINT "leave_balance_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_snapshots" ADD CONSTRAINT "leave_balance_snapshots_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_code_map" ADD CONSTRAINT "payroll_code_map_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_leave_events" ADD CONSTRAINT "payroll_leave_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_leave_events" ADD CONSTRAINT "payroll_leave_events_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_raw_lines" ADD CONSTRAINT "payroll_raw_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_raw_lines" ADD CONSTRAINT "payroll_raw_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_superseded_by_payslips_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."payslips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_user_state_idx" ON "documents" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "leave_balance_snapshots_user_period_idx" ON "leave_balance_snapshots" USING btree ("user_id","period");--> statement-breakpoint
CREATE INDEX "payroll_leave_events_user_usage_idx" ON "payroll_leave_events" USING btree ("user_id","usage_period");--> statement-breakpoint
CREATE INDEX "payroll_leave_events_payslip_idx" ON "payroll_leave_events" USING btree ("payslip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_active_key_uq" ON "payslips" USING btree ("user_id","employer_key","employee_key","year","type",coalesce("period", '0001-01-01'::date)) WHERE "payslips"."active";--> statement-breakpoint
CREATE INDEX "payslips_user_year_idx" ON "payslips" USING btree ("user_id","year");