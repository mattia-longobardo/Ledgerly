-- Release R5g, pull request 2 "Payroll" and the interest rules (rewrite plan 03-releases.md "R5g",
-- decisions ST-21, E1, E4, E6): payslip kinds and extra payments, the employer's configuration, the
-- fields of the country as pairs, the manual payslip, the conventions of an interest rule. Additive
-- only: the old columns (`payslips.type`, the fiscal columns, `interest_rules.day_basis`) stay and stay
-- written until R5f. Way back: docs/design/rewrite-plan/r5g-payroll-rollback.sql.
CREATE TABLE "payroll_employers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"pay_frequency" text DEFAULT 'monthly' NOT NULL,
	"extra_months" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_employers_user_uq" UNIQUE("user_id"),
	CONSTRAINT "payroll_employers_frequency_ck" CHECK ("payroll_employers"."pay_frequency" in ('monthly', 'semimonthly', 'biweekly', 'weekly')),
	CONSTRAINT "payroll_employers_extra_months_ck" CHECK (cardinality("payroll_employers"."extra_months") <= 3 and "payroll_employers"."extra_months" <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[])
);
--> statement-breakpoint
CREATE TABLE "payslip_fields" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslip_fields_key_uq" UNIQUE("payslip_id","key"),
	CONSTRAINT "payslip_fields_key_ck" CHECK ("payslip_fields"."key" ~ '^[a-z][A-Za-z0-9_]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD COLUMN "day_count" text DEFAULT '365' NOT NULL;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD COLUMN "period_anchor" text DEFAULT 'calendar' NOT NULL;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD COLUMN "payment_window_days" smallint;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "extra_number" smallint;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "source" text DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_employers" ADD CONSTRAINT "payroll_employers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_fields" ADD CONSTRAINT "payslip_fields_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_fields" ADD CONSTRAINT "payslip_fields_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payslip_fields_user_idx" ON "payslip_fields" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_day_count_ck" CHECK ("interest_rules"."day_count" in ('365', '360', 'act_act'));--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_anchor_ck" CHECK ("interest_rules"."period_anchor" in ('calendar'));--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_window_ck" CHECK ("interest_rules"."payment_window_days" is null or "interest_rules"."payment_window_days" between 0 and 90);--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_kind_ck" CHECK ("payslips"."kind" is null or "payslips"."kind" in ('ordinary', 'extra', 'bonus', 'settlement'));--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_source_ck" CHECK ("payslips"."source" in ('read', 'manual'));--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_document_ck" CHECK ("payslips"."source" = 'manual' or "payslips"."document_id" is not null);--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_extra_number_ck" CHECK (("payslips"."kind" = 'extra') = ("payslips"."extra_number" is not null) or "payslips"."kind" is null);--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_extra_number_range_ck" CHECK ("payslips"."extra_number" is null or "payslips"."extra_number" >= 1);--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_period_kind_ck" CHECK (("payslips"."kind" is distinct from 'ordinary' or "payslips"."period" is not null) and ("payslips"."kind" is distinct from 'extra' or "payslips"."period" is null));--> statement-breakpoint
-- R5g · Interests: the day-count convention of the rules of before is their day basis ("365" or "360").
UPDATE "interest_rules" SET "day_count" = "day_basis" WHERE "day_count" IS DISTINCT FROM "day_basis";--> statement-breakpoint
-- R5g · Payroll: the kind of every payslip from its old type (a 13th, 14th, 15th is the extra payment 1, 2, 3).
UPDATE "payslips" SET
  "kind" = CASE WHEN "type" IN ('thirteenth', 'fourteenth', 'fifteenth') THEN 'extra' ELSE "type" END,
  "extra_number" = CASE "type" WHEN 'thirteenth' THEN 1 WHEN 'fourteenth' THEN 2 WHEN 'fifteenth' THEN 3 END
WHERE "kind" IS NULL;--> statement-breakpoint
-- The employer of every person with a payslip, from their data: monthly, and as many extra payments as the
-- highest they had — at least the 13th, which the register always expected — in December, the 14th in June.
INSERT INTO "payroll_employers" ("user_id", "pay_frequency", "extra_months")
SELECT "user_id", 'monthly',
  (ARRAY[12, 6, 12]::smallint[])[1:greatest(1, coalesce(max("extra_number"), 1))]
FROM "payslips"
GROUP BY "user_id"
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
-- The fields of the Italian pack of every payslip, copied into its pairs; the columns stay written until R5f.
INSERT INTO "payslip_fields" ("user_id", "payslip_id", "key", "value_cents")
SELECT p."user_id", p."id", f."key", f."value"
FROM "payslips" p
CROSS JOIN LATERAL (VALUES
  ('contractualGross', p."contractual_gross"),
  ('ordinaryEarnings', p."ordinary_earnings"),
  ('totalGrossPrinted', p."total_gross_printed"),
  ('welfareCash', p."welfare_cash"),
  ('welfareInKind', p."welfare_in_kind"),
  ('irpefTaxable', p."irpef_taxable"),
  ('irpefGross', p."irpef_gross"),
  ('taxDeductions', p."tax_deductions"),
  ('irpefWithheld', p."irpef_withheld"),
  ('yearEndAdjustment', p."year_end_adjustment"),
  ('regionalInstallment', p."regional_installment"),
  ('municipalWithheld', p."municipal_withheld"),
  ('substituteTax', p."substitute_tax"),
  ('refund730', p."refund_730"),
  ('compensatedCredit', p."compensated_credit"),
  ('taxesNetOfRefunds', p."taxes_net_of_refunds"),
  ('employeeFundRegular', p."employee_fund_regular"),
  ('employeeFundAdjustments', p."employee_fund_adjustments"),
  ('employeeFundEnrollment', p."employee_fund_enrollment"),
  ('employeeFundEffective', p."employee_fund_effective"),
  ('employerFundPrinted', p."employer_fund_printed"),
  ('employerFundAdjustments', p."employer_fund_adjustments"),
  ('employerFundEnrollment', p."employer_fund_enrollment"),
  ('employerFundEffective', p."employer_fund_effective"),
  ('employerSocialTotal', p."employer_social_total"),
  ('tfrMonthField', p."tfr_month_field"),
  ('tfrContributionLine', p."tfr_contribution_line"),
  ('tfrSelected', p."tfr_selected"),
  ('bodyEarnings', p."body_earnings"),
  ('bodyDeductions', p."body_deductions"),
  ('bodyDeductionsPrinted', p."body_deductions_printed"),
  ('totalDeductionsPrinted', p."total_deductions_printed"),
  ('roundingPrevious', p."rounding_previous"),
  ('roundingCurrent', p."rounding_current")
) AS f("key", "value")
WHERE f."value" IS NOT NULL
ON CONFLICT ("payslip_id", "key") DO NOTHING;
