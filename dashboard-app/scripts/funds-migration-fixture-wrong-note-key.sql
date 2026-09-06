DO $$ BEGIN
  IF current_database() <> 'dashboard_test' THEN
    RAISE EXCEPTION 'fixture may run only against dashboard_test';
  END IF;
END $$;

BEGIN;
SELECT set_config('app.user_id', '', true), set_config('app.role', 'system', true);

DO $$
DECLARE
  account_id uuid;
  removed integer;
BEGIN
  SELECT f.account_id INTO account_id FROM funds f WHERE f.slug = 'cometa';
  DELETE FROM audit_events
  WHERE action = 'funds.migration.snapshot_account_created'
    AND entity_type = 'account' AND entity_id = account_id::text;
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> 1 THEN RAISE EXCEPTION 'Expected to remove one Cometa provenance event, removed %', removed; END IF;

  UPDATE accounts
  SET notes = 'created by funds migration from balance_snapshots:foreign-fund'
  WHERE id = account_id;
END $$;

COMMIT;
