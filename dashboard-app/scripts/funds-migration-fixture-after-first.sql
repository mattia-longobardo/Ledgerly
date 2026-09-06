DO $$ BEGIN
  IF current_database() <> 'dashboard_test' THEN
    RAISE EXCEPTION 'fixture may run only against dashboard_test';
  END IF;
END $$;

BEGIN;
SELECT set_config('app.user_id', '', true), set_config('app.role', 'system', true);

DO $$
DECLARE
  owner_id uuid := '10000000-0000-7000-8000-000000000002';
  fideuram_id uuid;
  cometa_id uuid;
  cometa_account_id uuid;
BEGIN
  IF (SELECT count(*) FROM legacy_funds) <> 2
    OR (SELECT count(*) FROM fund_settings) <> 4
    OR (SELECT count(*) FROM fund_deposits) <> 6 THEN
    RAISE EXCEPTION 'Migration changed a frozen legacy table';
  END IF;

  SELECT id, account_id INTO fideuram_id, cometa_account_id
  FROM funds WHERE user_id = owner_id AND slug = 'fideuram';
  IF fideuram_id IS NULL OR cometa_account_id <> '10000000-0000-7000-8000-000000000020' THEN
    RAISE EXCEPTION 'Fideuram did not link the existing account';
  END IF;

  SELECT id, account_id INTO cometa_id, cometa_account_id
  FROM funds WHERE user_id = owner_id AND slug = 'cometa';
  IF cometa_id IS NULL OR cometa_account_id IS NULL THEN
    RAISE EXCEPTION 'Cometa fund/account was not created and linked';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = cometa_account_id AND user_id = owner_id AND name = 'Fondo Cometa'
      AND type = 'pension_fund' AND currency = 'EUR' AND origin = 'manual'
  ) THEN RAISE EXCEPTION 'Cometa account attributes are wrong'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM audit_events
    WHERE action = 'funds.migration.snapshot_account_created'
      AND entity_type = 'account' AND entity_id = cometa_account_id::text
      AND after->>'snapshotAccountKey' = 'cometa'
  ) OR EXISTS (
    SELECT 1 FROM audit_events
    WHERE action = 'funds.migration.snapshot_account_created'
      AND entity_type = 'account'
      AND entity_id = '10000000-0000-7000-8000-000000000020'
  ) THEN RAISE EXCEPTION 'Snapshot-account provenance is wrong'; END IF;

  IF (SELECT count(*) FROM fund_plans WHERE fund_id IN (fideuram_id, cometa_id)) <> 4 THEN
    RAISE EXCEPTION 'Expected four migrated plans';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_plans WHERE fund_id = fideuram_id AND effective_from = '2026-01-01'
      AND initial_capital = 1000.00 AND fixed_monthly_amount = 100.00
  ) THEN RAISE EXCEPTION 'Earliest Fideuram plan is wrong'; END IF;

  IF (SELECT count(*) FROM fund_contribution_schedules WHERE fund_id IN (fideuram_id, cometa_id)) <> 2 THEN
    RAISE EXCEPTION 'Expected two schedules';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_contribution_schedules WHERE fund_id = cometa_id
      AND frequency = 'quarterly' AND period_anchor_month = 1
      AND posting_lag_months = 1 AND fee_per_posting = 3.00
  ) THEN RAISE EXCEPTION 'Cometa schedule is wrong'; END IF;

  IF (SELECT count(*) FROM fund_contributions WHERE fund_id = fideuram_id AND source = 'migration') <> 4 THEN
    RAISE EXCEPTION 'Fideuram should have one opening and three voluntary rows';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_contributions WHERE fund_id = fideuram_id AND type_code = 'adjustment'
      AND amount = 1000.00 AND posted_month = '2026-01-01'
  ) THEN RAISE EXCEPTION 'Fideuram opening must use the earliest setting'; END IF;

  IF (SELECT count(*) FROM fund_contributions WHERE fund_id = cometa_id) <> 10 THEN
    RAISE EXCEPTION 'Cometa should have opening + 5 deposit parts + 3 fees + joining fee';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_contributions WHERE fund_id = cometa_id AND type_code = 'employee'
      AND amount = 10.00 AND posted_month = '2026-04-01'
      AND payroll_record_id = '10000000-0000-7000-8000-000000000011'
      AND source = 'migration'
  ) THEN RAISE EXCEPTION 'Matched January employee split is wrong'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_contributions WHERE fund_id = cometa_id AND type_code = 'employer'
      AND amount = 20.00 AND posted_month = '2026-04-01'
      AND payroll_record_id = '10000000-0000-7000-8000-000000000011'
      AND source = 'migration'
  ) THEN RAISE EXCEPTION 'Matched January employer split is wrong'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_contributions WHERE fund_id = cometa_id AND type_code = 'employee'
      AND amount = 90.00 AND posted_month = '2026-10-01'
      AND payroll_record_id IS NULL AND source = 'migration'
  ) THEN RAISE EXCEPTION 'Future unmatched Q3 payroll contribution is missing'; END IF;
  IF (SELECT count(*) FROM fund_contributions WHERE fund_id = cometa_id AND type_code = 'fee' AND source = 'system') <> 3 THEN
    RAISE EXCEPTION 'Expected one system fee for each of three posted quarters';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_contributions WHERE fund_id = cometa_id AND type_code = 'fee'
      AND source = 'migration' AND amount = -10.32 AND note = 'joining fee'
      AND posted_month = '2026-04-01'
  ) THEN RAISE EXCEPTION 'Joining fee is wrong'; END IF;

  IF (SELECT count(*) FROM account_balances WHERE account_id = cometa_account_id) <> 2 THEN
    RAISE EXCEPTION 'Cometa must import exactly one canonical value per month';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM account_balances WHERE account_id = cometa_account_id
      AND as_of = '2026-01-01' AND balance = 111.00
      AND source = 'migration' AND captured_at = '2026-01-01T00:00:00Z'
  ) OR NOT EXISTS (
    SELECT 1 FROM account_balances WHERE account_id = cometa_account_id
      AND as_of = '2026-02-01' AND balance = 222.00
      AND source = 'migration' AND captured_at = '2026-02-01T00:00:00Z'
  ) THEN RAISE EXCEPTION 'Cometa canonical history did not retain dates/values'; END IF;
  IF EXISTS (SELECT 1 FROM account_balances WHERE account_id = cometa_account_id AND balance = 999.00) THEN
    RAISE EXCEPTION 'Stale latest snapshot was imported';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM accounts a JOIN account_balances b ON b.account_id = a.id
    WHERE a.id = '10000000-0000-7000-8000-000000000021'
      AND a.notes = 'must survive' AND b.balance = 42.00
  ) THEN RAISE EXCEPTION 'Unrelated account changed'; END IF;
END $$;

-- User edits made after migration must survive an immediate rerun.
UPDATE funds SET name = 'My Fideuram', version = version + 1
WHERE user_id = '10000000-0000-7000-8000-000000000002' AND slug = 'fideuram';
UPDATE fund_plans SET fixed_monthly_amount = '123.45'
WHERE fund_id = (
  SELECT id FROM funds
  WHERE user_id = '10000000-0000-7000-8000-000000000002' AND slug = 'fideuram'
) AND effective_from = '2026-01-01';
UPDATE accounts SET notes = 'owner edit', version = version + 1
WHERE id = '10000000-0000-7000-8000-000000000020';
UPDATE accounts SET notes = 'owner edit on snapshot-derived account', version = version + 1
WHERE id = (
  SELECT account_id FROM funds
  WHERE user_id = '10000000-0000-7000-8000-000000000002' AND slug = 'cometa'
);

COMMIT;
