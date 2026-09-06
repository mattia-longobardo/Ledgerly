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
  SELECT id INTO fideuram_id FROM funds WHERE user_id = owner_id AND slug = 'fideuram';
  SELECT id INTO cometa_id FROM funds WHERE user_id = owner_id AND slug = 'cometa';
  SELECT account_id INTO cometa_account_id FROM funds WHERE id = cometa_id;

  IF (SELECT count(*) FROM funds WHERE user_id = owner_id) <> 2
    OR (SELECT count(*) FROM fund_plans WHERE fund_id IN (fideuram_id, cometa_id)) <> 4
    OR (SELECT count(*) FROM fund_contribution_schedules WHERE fund_id IN (fideuram_id, cometa_id)) <> 2
    OR (SELECT count(*) FROM fund_contributions WHERE fund_id IN (fideuram_id, cometa_id)) <> 14 THEN
    RAISE EXCEPTION 'Rerun duplicated migrated rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM funds WHERE id = fideuram_id AND name = 'My Fideuram' AND version = 2) THEN
    RAISE EXCEPTION 'Rerun overwrote the fund edit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fund_plans WHERE fund_id = fideuram_id
      AND effective_from = '2026-01-01' AND fixed_monthly_amount = 123.45
  ) THEN RAISE EXCEPTION 'Rerun overwrote the plan edit'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = '10000000-0000-7000-8000-000000000020'
      AND notes = 'owner edit' AND version = 2
  ) THEN RAISE EXCEPTION 'Rerun overwrote the account edit'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = cometa_account_id
      AND notes = 'owner edit on snapshot-derived account' AND version = 2
  ) THEN RAISE EXCEPTION 'Rerun overwrote the snapshot-derived account edit'; END IF;
END $$;

COMMIT;
