-- Release R5g, pull request 2 "Payroll" and the interest rules (migration 0075): the way back for the
-- database, with the image `pre-r5g-payroll`. Run it alone, after the image before is running again.
--
-- The release only adds: the old columns stayed written, so the image before reads every payslip and
-- every rule as they are. What does not come back: the payslips typed by hand (their documents stay
-- in the imports, read again by the image before), the employer's configuration, the pairs of fields
-- (the fiscal columns hold the same values), a day count `act_act` or a payment window stated on a rule
-- (the rule keeps its day basis and the window of before).
BEGIN;
DELETE FROM payslips WHERE source = 'manual';
ALTER TABLE payslips DROP CONSTRAINT payslips_kind_ck;
ALTER TABLE payslips DROP CONSTRAINT payslips_source_ck;
ALTER TABLE payslips DROP CONSTRAINT payslips_document_ck;
ALTER TABLE payslips DROP CONSTRAINT payslips_extra_number_ck;
ALTER TABLE payslips DROP CONSTRAINT payslips_extra_number_range_ck;
ALTER TABLE payslips DROP CONSTRAINT payslips_period_kind_ck;
ALTER TABLE payslips DROP COLUMN kind;
ALTER TABLE payslips DROP COLUMN extra_number;
ALTER TABLE payslips DROP COLUMN source;
ALTER TABLE payslips ALTER COLUMN document_id SET NOT NULL;
DROP TABLE payslip_fields;
DROP TABLE payroll_employers;
ALTER TABLE interest_rules DROP CONSTRAINT interest_rules_day_count_ck;
ALTER TABLE interest_rules DROP CONSTRAINT interest_rules_anchor_ck;
ALTER TABLE interest_rules DROP CONSTRAINT interest_rules_window_ck;
ALTER TABLE interest_rules DROP COLUMN day_count;
ALTER TABLE interest_rules DROP COLUMN period_anchor;
ALTER TABLE interest_rules DROP COLUMN payment_window_days;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795630000000;
COMMIT;
