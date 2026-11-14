-- Release N6 "standard pension fund": the way back for the database
-- (docs/design/rewrite-plan/03-releases.md "N6", 11-standardization.md §11.2.4).
--
-- The image before the release (`ledgerly:pre-n6`) works on the schema of N6 as it is: the release
-- only added, and the tables and columns that image reads were never touched. So the first step of
-- a rollback is the image alone:
--
--   docker tag ledgerly:pre-n6 ledgerly:latest && docker compose up -d --no-build ledgerly
--
-- Run this file only after that image is up, and only if the release is not coming back soon. It
-- puts the database back to what it was before N6 and removes the release's rows from the journal,
-- so that a new deploy applies the migrations again.
--
-- What it does with what was written after the release:
--   * a payment written by hand in a fund that had a debit plan goes back to `fund_deposits`, where
--     the image before reads it: nothing a person wrote is lost;
--   * a payment the job found among the movements is deleted: the job of the image before finds
--     the same movement again and writes the deposit itself;
--   * the sources and the fees edited or added after the release are dropped with their tables: the
--     plan, the rule, the schedule and the tariff of before are still where they were;
--   * a fund created after the release stays, as a fund fed by the payslip with nothing recorded;
--   * an operation that is not a payment (an exit, a transfer in), written by hand after the release in
--     a fund that had a debit plan, is dropped: the image before has no place for it in such a fund;
--   * an operation or a decision counted by month (a source that accrues by month did not exist
--     before) loses its period, which the old check refuses.
-- The dump `n6` in `Ledgerly-dumps/` is the copy of everything as it was before the release.
--
-- Step A4 (the documents of the fund deleted from the archive) is not undone here: its way back is
-- the copy of the files and the dump taken before that step.
BEGIN;

-- 1. The payments written by hand after the release, back where the image before reads them.
INSERT INTO fund_deposits (user_id, fund_id, "on", charged_cents, fee_cents, transaction_id, source, note, created_at, updated_at)
SELECT o.user_id, o.fund_id, o.operation_date, o.worker_cents,
       CASE WHEN o.fees_unknown THEN NULL ELSE o.fees_cents END, o.transaction_id, 'manual', o.note,
       o.created_at, o.updated_at
FROM fund_operations o
JOIN funds f ON f.id = o.fund_id
WHERE f.type = 'pac' AND o.classification = 'voluntary' AND o.source = 'manual'
  AND o.origin_key LIKE 'manual:%' AND o.worker_cents > 0;

-- 2. The operations of the funds that had a debit plan: the copy of the deposits (step A2), the
--    payments just moved back, and the ones the job wrote. The image before never read them.
DELETE FROM fund_operations o
USING funds f
WHERE f.id = o.fund_id AND f.type = 'pac';
-- A debit found by the job in any other fund: the old check has no such source.
DELETE FROM fund_operations WHERE source = 'rule';

-- 3. Periods counted by month: the old checks take quarters only.
UPDATE fund_operations SET competence_year = NULL, competence_quarter = NULL WHERE competence_quarter > 4;
DELETE FROM reconciliation_links WHERE quarter > 4;

-- 4. Exception X2: the account of a fund that had a debit plan goes back to its group.
UPDATE accounts SET type = 'investment'
WHERE type = 'pension' AND id IN (SELECT valuation_account_id FROM funds WHERE type = 'pac');

-- 5. The schema of step A1.
ALTER TABLE "fund_operations" DROP CONSTRAINT IF EXISTS "fund_operations_source_ck";
ALTER TABLE "fund_operations" DROP CONSTRAINT IF EXISTS "fund_operations_quarter_ck";
ALTER TABLE "reconciliation_links" DROP CONSTRAINT IF EXISTS "reconciliation_links_quarter_ck";
ALTER TABLE "fund_operations" DROP COLUMN IF EXISTS "source_id";
ALTER TABLE "fund_operations" DROP COLUMN IF EXISTS "fees_unknown";
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_source_ck" CHECK ("fund_operations"."source" in ('import', 'manual'));
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_quarter_ck" CHECK (("fund_operations"."competence_year" is null) = ("fund_operations"."competence_quarter" is null) and ("fund_operations"."competence_quarter" is null or "fund_operations"."competence_quarter" between 1 and 4));
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_quarter_ck" CHECK ("reconciliation_links"."quarter" between 1 and 4);
DROP TABLE IF EXISTS "fund_fees";
DROP TABLE IF EXISTS "fund_contribution_sources";
ALTER TABLE "funds" DROP CONSTRAINT IF EXISTS "funds_code_ck";
ALTER TABLE "funds" DROP COLUMN IF EXISTS "code";
ALTER TABLE "funds" ALTER COLUMN "type" DROP DEFAULT;

-- 6. The journal rows: `created_at` is the `when` of each migration in drizzle/meta/_journal.json
--    (0046_single_fund_model, 0047_migrate_fund_data, 0048_fund_account_group).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1794689782475, 1794689893989, 1794689979972);

COMMIT;
