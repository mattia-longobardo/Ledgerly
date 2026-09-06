DO $$ BEGIN
  IF current_database() <> 'dashboard_test' THEN
    RAISE EXCEPTION 'fixture may run only against dashboard_test';
  END IF;
END $$;

BEGIN;
SELECT set_config('app.user_id', '', true), set_config('app.role', 'system', true);

DO $$
DECLARE
  changed integer;
BEGIN
  UPDATE audit_events e
  SET after = jsonb_build_object('snapshotAccountKey', 'foreign-fund')
  FROM funds f
  WHERE e.action = 'funds.migration.snapshot_account_created'
    AND e.entity_type = 'account'
    AND e.entity_id = f.account_id::text
    AND f.slug = 'cometa';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Expected to corrupt one Cometa provenance event, changed %', changed; END IF;
END $$;

COMMIT;
