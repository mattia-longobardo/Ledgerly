CREATE TABLE "payroll_components" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label_raw" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(16, 2),
	"quantity" numeric(16, 6),
	"unit" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"confidence" text,
	"source" text DEFAULT 'rules' NOT NULL,
	"mapped_to" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_components_kind_ck" CHECK ("payroll_components"."kind" IN ('earning','deduction','tax','employer_contribution','employee_contribution','reimbursement','allowance','bonus','leave_balance','leave_used','leave_accrued','info')),
	CONSTRAINT "payroll_components_confidence_ck" CHECK ("payroll_components"."confidence" IN ('high','medium','low')),
	CONSTRAINT "payroll_components_source_ck" CHECK ("payroll_components"."source" IN ('rules','llm','manual')),
	CONSTRAINT "payroll_components_unit_ck" CHECK ("payroll_components"."unit" IN ('hours','days','eur'))
);
--> statement-breakpoint
CREATE TABLE "payroll_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"file_name" text NOT NULL,
	"mime" text DEFAULT 'application/pdf' NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_provider" text DEFAULT 'silo' NOT NULL,
	"storage_key" text,
	"pages" integer,
	"text_source" text,
	"parser_version" text,
	"extraction" jsonb,
	"confidence" jsonb,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"scanner" text,
	"scan_signature" text,
	"scanned_at" timestamp with time zone,
	"error" text,
	"idempotency_key" text,
	"replaces_import_id" uuid,
	"retention_until" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	"uploaded_via" text DEFAULT 'ui' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_imports_status_ck" CHECK ("payroll_imports"."status" IN ('received','scanning','needs_ocr','extracting','parsed','needs_review','verified','applied','rejected','superseded','failed')),
	CONSTRAINT "payroll_imports_storage_ck" CHECK ("payroll_imports"."storage_provider" IN ('silo','local')),
	CONSTRAINT "payroll_imports_scan_ck" CHECK ("payroll_imports"."scan_status" IN ('pending','clean','infected','unavailable')),
	CONSTRAINT "payroll_imports_text_source_ck" CHECK ("payroll_imports"."text_source" IN ('pdf_text','ocr','none')),
	CONSTRAINT "payroll_imports_uploaded_via_ck" CHECK ("payroll_imports"."uploaded_via" IN ('ui','api','migration')),
	CONSTRAINT "payroll_imports_size_ck" CHECK ("payroll_imports"."size_bytes" > 0 AND "payroll_imports"."size_bytes" <= 10485760),
	CONSTRAINT "payroll_imports_sha_ck" CHECK ("payroll_imports"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payroll_mapping_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"match_code" text,
	"match_label" text,
	"component_kind" text NOT NULL,
	"target" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_mapping_rules_kind_ck" CHECK ("payroll_mapping_rules"."component_kind" IN ('earning','deduction','tax','employer_contribution','employee_contribution','reimbursement','allowance','bonus','leave_balance','leave_used','leave_accrued','info')),
	CONSTRAINT "payroll_mapping_rules_match_ck" CHECK ("payroll_mapping_rules"."match_code" IS NOT NULL OR "payroll_mapping_rules"."match_label" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payroll_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date,
	"kind" text DEFAULT 'ordinary' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"gross" numeric(16, 2),
	"net" numeric(16, 2),
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"corrections" jsonb,
	"superseded_at" timestamp with time zone,
	"superseded_by_record_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_records_kind_ck" CHECK ("payroll_records"."kind" IN ('ordinary','thirteenth','fourteenth','bonus','settlement')),
	CONSTRAINT "payroll_records_currency_ck" CHECK (char_length("payroll_records"."currency") = 3),
	CONSTRAINT "payroll_records_period_ck" CHECK ("payroll_records"."period_end" >= "payroll_records"."period_start")
);
--> statement-breakpoint
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_record_id_payroll_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."payroll_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_imports" ADD CONSTRAINT "payroll_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_imports" ADD CONSTRAINT "payroll_imports_replaces_import_id_payroll_imports_id_fk" FOREIGN KEY ("replaces_import_id") REFERENCES "public"."payroll_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_import_id_payroll_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."payroll_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_superseded_by_record_id_payroll_records_id_fk" FOREIGN KEY ("superseded_by_record_id") REFERENCES "public"."payroll_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_components_record_idx" ON "payroll_components" USING btree ("record_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_imports_user_sha_uq" ON "payroll_imports" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_imports_user_idem_uq" ON "payroll_imports" USING btree ("user_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payroll_imports_user_created_idx" ON "payroll_imports" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payroll_imports_open_idx" ON "payroll_imports" USING btree ("status") WHERE status IN ('received','scanning','needs_ocr','extracting','needs_review');--> statement-breakpoint
CREATE INDEX "payroll_mapping_rules_lookup_idx" ON "payroll_mapping_rules" USING btree ("user_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_records_import_uq" ON "payroll_records" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_records_period_uq" ON "payroll_records" USING btree ("user_id","period_start","kind") WHERE superseded_at IS NULL;--> statement-breakpoint
CREATE INDEX "payroll_records_user_period_idx" ON "payroll_records" USING btree ("user_id","period_start" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE payroll_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_imports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_imports_owner ON payroll_imports
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_records_owner ON payroll_records
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE payroll_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_components_owner ON payroll_components
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM payroll_records r WHERE r.id = record_id AND r.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR EXISTS (
    SELECT 1 FROM payroll_records r WHERE r.id = record_id AND r.user_id = app_current_user_id()
  ));
--> statement-breakpoint
ALTER TABLE payroll_mapping_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_mapping_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Four per-command policies, not one USING/WITH CHECK pair: WITH CHECK is
-- never evaluated for DELETE, so a single pair whose USING admits
-- user_id IS NULL rows would let any user delete a global mapping rule, and
-- would let a user hijack one via UPDATE ... SET user_id = <self> (USING
-- admits the NULL-owned target, WITH CHECK passes because the new row now
-- names the actor). SELECT alone stays permissive of NULL-owned rows.
CREATE POLICY payroll_mapping_rules_select ON payroll_mapping_rules
  FOR SELECT
  USING (app_is_system() OR user_id IS NULL OR user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY payroll_mapping_rules_insert ON payroll_mapping_rules
  FOR INSERT
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY payroll_mapping_rules_update ON payroll_mapping_rules
  FOR UPDATE
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY payroll_mapping_rules_delete ON payroll_mapping_rules
  FOR DELETE
  USING (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
INSERT INTO integration_providers (code, label, capabilities) VALUES
  ('payroll_silo', 'Payroll document store', '["documents"]'::jsonb)
ON CONFLICT (code) DO NOTHING;