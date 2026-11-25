-- Release R5f.2 (rewrite plan 03-releases.md "R5f", 06-data.md §6.1, decisions of Mattia 2 = A, 3 = A,
-- 4 = A, 5 = A): the clean-up of the schema. It removes what N6, R5a, R5b, R5c and R5g made useless and
-- R5f.1 stopped reading. The one release that is not compatible with the image before it: the way back
-- is the dump `r5f`, docs/design/rewrite-plan/r5f-rollback.md. One transaction, as every migration.
--
-- First the counts this migration was written against (read in production on 25/11/2026). More rows
-- than these stop it before anything changes, and the release with it: what it removes is no more than
-- what was read. Fewer is a database with less in it (the tests, a new instance). The deploy checks the
-- exact counts first (r5f-rollback.md, step 1).
DO $$
DECLARE
  found bigint;
  expected record;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('job_runs of the tier quarter', 'SELECT count(*) FROM job_runs WHERE tier = ''quarter''', 44),
      ('fund_fee_tariffs', 'SELECT count(*) FROM fund_fee_tariffs', 13),
      ('fund_deposits', 'SELECT count(*) FROM fund_deposits', 0),
      ('fund_deposit_rules', 'SELECT count(*) FROM fund_deposit_rules', 0),
      ('pension_rules', 'SELECT count(*) FROM pension_rules', 0),
      ('timeoff_allowances', 'SELECT count(*) FROM timeoff_allowances', 0),
      ('funds', 'SELECT count(*) FROM funds', 0),
      ('payslips', 'SELECT count(*) FROM payslips', 0),
      ('pension_competences', 'SELECT count(*) FROM pension_competences', 0),
      ('leave_days', 'SELECT count(*) FROM leave_days', 0),
      ('leave_types', 'SELECT count(*) FROM leave_types', 0),
      ('interest_rules', 'SELECT count(*) FROM interest_rules', 0),
      ('documents of a fund', 'SELECT count(*) FROM documents WHERE kind <> ''payslip''', 0),
      ('pocket_movements withdrawn or adjusted', 'SELECT count(*) FROM pocket_movements WHERE kind IN (''withdrawal'', ''adjustment'')', 0),
      ('user_preferences with a patron saint', 'SELECT count(*) FROM user_preferences WHERE patron_month IS NOT NULL', 0),
      ('user_preferences with the module funds', 'SELECT count(*) FROM user_preferences WHERE ''funds'' = ANY(modules)', 0)
    ) AS counts(what, query, rows)
  LOOP
    EXECUTE expected.query INTO found;
    IF found > expected.rows THEN
      RAISE EXCEPTION 'r5f: % is %, expected at most %', expected.what, found, expected.rows;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
-- The data first: the history of a tier that no longer runs (4 = A), the module R5b folded into
-- Investments, and the kind of a competence written by the image before R5f.1 (none expected).
DELETE FROM "job_runs" WHERE "tier" = 'quarter';--> statement-breakpoint
UPDATE "user_preferences" SET "modules" = array_remove("modules", 'funds') WHERE 'funds' = ANY("modules");--> statement-breakpoint
UPDATE "pension_competences" SET "kind" = CASE "payslip_type" WHEN 'thirteenth' THEN 'extra' WHEN 'fourteenth' THEN 'extra' WHEN 'fifteenth' THEN 'extra' ELSE "payslip_type" END, "extra_number" = CASE "payslip_type" WHEN 'thirteenth' THEN 1 WHEN 'fourteenth' THEN 2 WHEN 'fifteenth' THEN 3 END WHERE "kind" IS NULL;--> statement-breakpoint
DROP TABLE "fund_deposit_rules" CASCADE;--> statement-breakpoint
DROP TABLE "fund_deposits" CASCADE;--> statement-breakpoint
DROP TABLE "fund_fee_tariffs" CASCADE;--> statement-breakpoint
DROP TABLE "pension_rules" CASCADE;--> statement-breakpoint
DROP TABLE "timeoff_allowances" CASCADE;--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_user_on_kind_uq";--> statement-breakpoint
ALTER TABLE "job_runs" DROP CONSTRAINT "job_runs_tier_ck";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_kind_ck";--> statement-breakpoint
ALTER TABLE "interest_rules" DROP CONSTRAINT "interest_rules_basis_ck";--> statement-breakpoint
ALTER TABLE "pocket_movements" DROP CONSTRAINT "pocket_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_patron_ck";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_patron_month_ck";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_patron_day_ck";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_modules_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_type_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_isin_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_debit_day_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_ter_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_monthly_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_fee_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_receives_payroll_ck";--> statement-breakpoint
ALTER TABLE "payroll_employers" DROP CONSTRAINT "payroll_employers_extra_months_ck";--> statement-breakpoint
ALTER TABLE "payslips" DROP CONSTRAINT "payslips_type_ck";--> statement-breakpoint
ALTER TABLE "payslips" DROP CONSTRAINT "payslips_tfr_source_ck";--> statement-breakpoint
ALTER TABLE "payslips" DROP CONSTRAINT "payslips_period_type_ck";--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_kind_ck";--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_trek_kind_ck";--> statement-breakpoint
ALTER TABLE "leave_days" DROP CONSTRAINT "leave_days_origin_ck";--> statement-breakpoint
ALTER TABLE "leave_types" DROP CONSTRAINT "leave_types_words_ck";--> statement-breakpoint
ALTER TABLE "funds" DROP CONSTRAINT "funds_debit_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "fund_operations" DROP CONSTRAINT "fund_operations_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "position_snapshots" DROP CONSTRAINT "position_snapshots_document_id_documents_id_fk";
--> statement-breakpoint
DROP INDEX "funds_debit_account_idx";--> statement-breakpoint
DROP INDEX "funds_receives_payroll_uq";--> statement-breakpoint
DROP INDEX "fund_operations_document_idx";--> statement-breakpoint
DROP INDEX "payslips_active_key_uq";--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "modules" SET DEFAULT '{investments,payroll,timeoff,budgets,subscriptions,pockets,interests}'::text[];--> statement-breakpoint
ALTER TABLE "pension_competences" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_days" ALTER COLUMN "type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "interest_rules" DROP COLUMN "day_basis";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "patron_month";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "patron_day";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "isin";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "debit_account_id";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "debit_day";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "ter";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "monthly_cents";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "deposit_fee_cents";--> statement-breakpoint
ALTER TABLE "funds" DROP COLUMN "receives_payroll";--> statement-breakpoint
ALTER TABLE "fund_operations" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "pension_competences" DROP COLUMN "payslip_type";--> statement-breakpoint
ALTER TABLE "position_snapshots" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "contractual_gross";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "ordinary_earnings";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "total_gross_printed";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "welfare_cash";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "welfare_in_kind";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "irpef_taxable";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "irpef_gross";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "tax_deductions";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "irpef_withheld";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "year_end_adjustment";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "regional_installment";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "municipal_withheld";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "substitute_tax";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "refund_730";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "compensated_credit";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "taxes_net_of_refunds";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employee_fund_regular";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employee_fund_adjustments";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employee_fund_enrollment";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employee_fund_effective";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employer_fund_printed";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employer_fund_adjustments";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employer_fund_enrollment";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employer_fund_effective";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "employer_social_total";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "tfr_month_field";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "tfr_contribution_line";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "tfr_selected";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "tfr_source";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "body_earnings";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "body_deductions";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "body_deductions_printed";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "total_deductions_printed";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "rounding_previous";--> statement-breakpoint
ALTER TABLE "payslips" DROP COLUMN "rounding_current";--> statement-breakpoint
ALTER TABLE "leave_days" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "leave_days" DROP COLUMN "trek_fraction";--> statement-breakpoint
ALTER TABLE "leave_days" DROP COLUMN "trek_kind";--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "legacy_kind";--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tier_ck" CHECK ("job_runs"."tier" in ('minute', 'hourly', 'daily', 'monthly', 'manual'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind_ck" CHECK ("documents"."kind" in ('payslip'));--> statement-breakpoint
ALTER TABLE "pocket_movements" ADD CONSTRAINT "pocket_movements_kind_ck" CHECK ("pocket_movements"."kind" in ('accrual', 'deposit'));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_modules_ck" CHECK ("user_preferences"."modules" <@ '{investments,payroll,timeoff,budgets,subscriptions,pockets,interests}'::text[]);--> statement-breakpoint
ALTER TABLE "payroll_employers" ADD CONSTRAINT "payroll_employers_extra_months_ck" CHECK (cardinality("payroll_employers"."extra_months") <= 12 and "payroll_employers"."extra_months" <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]);--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_origin_ck" CHECK ("leave_days"."origin" in ('manual', 'external'));--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_words_ck" CHECK (coalesce("leave_types"."balance_key" ~ '^[a-z][a-z0-9_-]{0,39}$', true)
        and coalesce("leave_types"."calendar_kind" ~ '^[a-z][a-z0-9_-]{0,39}$', true));