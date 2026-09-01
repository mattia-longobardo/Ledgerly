CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "balance_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"account_key" text NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "balance_snapshots_source_ck" CHECK ("balance_snapshots"."source" IN ('wallet','teable'))
);
--> statement-breakpoint
CREATE TABLE "fund_deposits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fund_deposits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fund_id" smallint NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"employee_part" numeric(14, 2),
	"employer_part" numeric(14, 2),
	"source" text NOT NULL,
	"payslip_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_deposits_source_ck" CHECK ("fund_deposits"."source" IN ('fixed','payroll','manual'))
);
--> statement-breakpoint
CREATE TABLE "fund_settings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fund_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fund_id" smallint NOT NULL,
	"effective_from" date NOT NULL,
	"initial_capital" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deposit_mode" text NOT NULL,
	"fixed_monthly_amount" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_settings_mode_ck" CHECK ("fund_settings"."deposit_mode" IN ('fixed','payroll')),
	CONSTRAINT "fund_settings_fixed_amount_ck" CHECK ("fund_settings"."deposit_mode" <> 'fixed' OR "fund_settings"."fixed_monthly_amount" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" smallint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"teable_column" text NOT NULL,
	CONSTRAINT "funds_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_name" text NOT NULL,
	"dedupe_key" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"detail" jsonb,
	CONSTRAINT "job_runs_trigger_ck" CHECK ("job_runs"."trigger" IN ('cron','sweep','manual','webhook')),
	CONSTRAINT "job_runs_status_ck" CHECK ("job_runs"."status" IN ('running','success','success_after_retry','already_done','failed','poisoned','missed'))
);
--> statement-breakpoint
CREATE TABLE "monthly_snapshots" (
	"month_key" date PRIMARY KEY NOT NULL,
	"ing" numeric(14, 2) NOT NULL,
	"revolut" numeric(14, 2) NOT NULL,
	"status" text NOT NULL,
	"teable_record_id" text,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "monthly_snapshots_status_ck" CHECK ("monthly_snapshots"."status" IN ('pending_teable','done','poisoned','missed'))
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payslips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"month" date NOT NULL,
	"is_thirteenth" boolean DEFAULT false NOT NULL,
	"paperless_doc_id" integer NOT NULL,
	"status" text DEFAULT 'discovered' NOT NULL,
	"raw_extraction" jsonb,
	"corrections" jsonb,
	"gross" numeric(14, 2),
	"net" numeric(14, 2),
	"taxes" numeric(14, 2),
	"fund_contrib_employee" numeric(14, 2),
	"fund_contrib_employer" numeric(14, 2),
	"ferie_balance" numeric(7, 2),
	"ferie_unit" text,
	"rol_balance" numeric(7, 2),
	"rol_unit" text,
	"superseded_by" bigint,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_status_ck" CHECK ("payslips"."status" IN ('discovered','parsed','verified','rejected','superseded')),
	CONSTRAINT "payslips_ferie_unit_ck" CHECK ("payslips"."ferie_unit" IN ('days','hours')),
	CONSTRAINT "payslips_rol_unit_ck" CHECK ("payslips"."rol_unit" IN ('days','hours'))
);
--> statement-breakpoint
CREATE TABLE "vacation_accrual_rate" (
	"effective_from" date PRIMARY KEY NOT NULL,
	"monthly_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacation_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vacation_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entry_type" text NOT NULL,
	"month" date,
	"amount" numeric(14, 2) NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacation_ledger_type_ck" CHECK ("vacation_ledger"."entry_type" IN ('initial','accrual','withdrawal','adjustment'))
);
--> statement-breakpoint
ALTER TABLE "fund_deposits" ADD CONSTRAINT "fund_deposits_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_deposits" ADD CONSTRAINT "fund_deposits_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_settings" ADD CONSTRAINT "fund_settings_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_superseded_by_payslips_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshots_account_captured_idx" ON "balance_snapshots" USING btree ("account_key","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "fund_deposits_fund_month_uq" ON "fund_deposits" USING btree ("fund_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_settings_fund_effective_uq" ON "fund_settings" USING btree ("fund_id","effective_from");--> statement-breakpoint
CREATE INDEX "job_runs_name_started_idx" ON "job_runs" USING btree ("job_name","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_month_thirteenth_uq" ON "payslips" USING btree ("month","is_thirteenth");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_doc_thirteenth_uq" ON "payslips" USING btree ("paperless_doc_id","is_thirteenth");--> statement-breakpoint
CREATE INDEX "payslips_status_idx" ON "payslips" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_ledger_month_uq" ON "vacation_ledger" USING btree ("month") WHERE entry_type IN ('initial','accrual');