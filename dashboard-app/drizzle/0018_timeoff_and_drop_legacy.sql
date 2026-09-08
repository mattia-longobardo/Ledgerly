CREATE TABLE "timeoff_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"accrued" numeric(8, 2),
	"used" numeric(8, 2),
	"remaining" numeric(8, 2),
	"pending" numeric(8, 2),
	"unit" text DEFAULT 'hours' NOT NULL,
	"source" text DEFAULT 'payroll' NOT NULL,
	"payroll_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_balances_source_ck" CHECK ("timeoff_balances"."source" IN ('payroll','manual')),
	CONSTRAINT "timeoff_balances_unit_ck" CHECK ("timeoff_balances"."unit" IN ('hours','days'))
);
--> statement-breakpoint
CREATE TABLE "timeoff_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"date" date NOT NULL,
	"fraction" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"pending_op" text DEFAULT 'none' NOT NULL,
	"synced_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_events_fraction_ck" CHECK ("timeoff_events"."fraction" IN (0.5, 1)),
	CONSTRAINT "timeoff_events_status_ck" CHECK ("timeoff_events"."status" IN ('planned','approved','taken','cancelled')),
	CONSTRAINT "timeoff_events_origin_ck" CHECK ("timeoff_events"."origin" IN ('manual','trek','payroll')),
	CONSTRAINT "timeoff_events_pending_ck" CHECK ("timeoff_events"."pending_op" IN ('none','upsert','delete'))
);
--> statement-breakpoint
CREATE TABLE "timeoff_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"unit" text DEFAULT 'hours' NOT NULL,
	"hours_per_day" numeric(4, 2) DEFAULT '8.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeoff_types_code_ck" CHECK ("timeoff_types"."code" IN ('vacation','comp','permits','sick','other')),
	CONSTRAINT "timeoff_types_unit_ck" CHECK ("timeoff_types"."unit" IN ('hours','days'))
);
--> statement-breakpoint
ALTER TABLE "timeoff_balances" ADD CONSTRAINT "timeoff_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_balances" ADD CONSTRAINT "timeoff_balances_type_id_timeoff_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."timeoff_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_balances" ADD CONSTRAINT "timeoff_balances_payroll_record_id_payroll_records_id_fk" FOREIGN KEY ("payroll_record_id") REFERENCES "public"."payroll_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_events" ADD CONSTRAINT "timeoff_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_events" ADD CONSTRAINT "timeoff_events_type_id_timeoff_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."timeoff_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeoff_types" ADD CONSTRAINT "timeoff_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_balances_type_record_uq" ON "timeoff_balances" USING btree ("type_id","payroll_record_id") WHERE payroll_record_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "timeoff_balances_user_asof_idx" ON "timeoff_balances" USING btree ("user_id","as_of" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_events_user_date_uq" ON "timeoff_events" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "timeoff_events_pending_idx" ON "timeoff_events" USING btree ("user_id","pending_op") WHERE pending_op <> 'none';--> statement-breakpoint
CREATE UNIQUE INDEX "timeoff_types_user_code_uq" ON "timeoff_types" USING btree ("user_id","code");
--> statement-breakpoint
DROP TABLE "fund_deposits" CASCADE;--> statement-breakpoint
DROP TABLE "fund_settings" CASCADE;--> statement-breakpoint
DROP TABLE "legacy_funds" CASCADE;--> statement-breakpoint
DROP TABLE "payslips" CASCADE;--> statement-breakpoint
DROP TABLE "vacation_ledger" CASCADE;--> statement-breakpoint
DROP TABLE "vacation_accrual_rate" CASCADE;--> statement-breakpoint
DROP TABLE "leave_days" CASCADE;--> statement-breakpoint
DROP TABLE "balance_snapshots" CASCADE;
--> statement-breakpoint
ALTER TABLE timeoff_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE timeoff_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY timeoff_types_owner ON timeoff_types
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE timeoff_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE timeoff_balances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY timeoff_balances_owner ON timeoff_balances
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE timeoff_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE timeoff_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY timeoff_events_owner ON timeoff_events
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
