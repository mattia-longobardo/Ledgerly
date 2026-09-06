-- Destructive test fixture. Run only against dashboard_test:
--   npm run test:db:up
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run db:migrate
--   docker exec -i dashboard-postgres-test psql -U app_test -d dashboard_test -v ON_ERROR_STOP=1 < scripts/vacation-budget-migration-fixture.sql
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run migrate:vacation
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run migrate:vacation   -- second run: must write nothing
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run migrate:vacation:validate
--
-- Fixture per the task brief's Verify block: initial 500, two accrual rates,
-- three accrual rows, one withdrawal and one adjustment.

-- BEGIN wraps the guard itself: if the guard raises, the transaction is left
-- aborted, so every statement below it — including the TRUNCATE — is
-- rejected by Postgres even when psql is run without -v ON_ERROR_STOP=1 and
-- keeps feeding it statements. Guarding outside BEGIN does not protect
-- anything: psql would report the raised exception and carry on to TRUNCATE
-- against whatever database is connected.
BEGIN;

DO $$ BEGIN
  IF current_database() <> 'dashboard_test' THEN
    RAISE EXCEPTION 'fixture may run only against dashboard_test';
  END IF;
END $$;

SELECT set_config('app.user_id', '', true), set_config('app.role', 'system', true);

TRUNCATE TABLE organizations, vacation_ledger, vacation_accrual_rate, budgets RESTART IDENTITY CASCADE;

INSERT INTO roles (code, label) VALUES ('owner', 'Owner') ON CONFLICT (code) DO NOTHING;
INSERT INTO organizations (id, name)
VALUES ('20000000-0000-7000-8000-000000000001', 'Vacation fixture');
INSERT INTO users (id, organization_id, email, display_name, currency)
VALUES (
  '20000000-0000-7000-8000-000000000002',
  '20000000-0000-7000-8000-000000000001',
  'vacation-fixture@example.test',
  'Vacation fixture owner',
  'EUR'
);
INSERT INTO user_roles (user_id, role_code)
VALUES ('20000000-0000-7000-8000-000000000002', 'owner');

INSERT INTO vacation_accrual_rate (effective_from, monthly_amount) VALUES
  ('2026-01-01', '50.00'),
  ('2026-04-01', '60.00');

-- initial has month=NULL deliberately: it exercises the "month ?? occurred_at::date"
-- fallback, and vacation_ledger_month_uq is a single unique index across
-- (initial, accrual) rows so initial and the January accrual cannot share a month.
INSERT INTO vacation_ledger (entry_type, month, amount, note, occurred_at) VALUES
  ('initial',    NULL,         '500.00', NULL,                '2026-01-01T00:00:00Z'),
  ('accrual',    '2026-01-01', '50.00',  NULL,                '2026-01-31T00:00:00Z'),
  -- Deliberately off the rate (50.00) to exercise the R6-4 reconciliation.
  ('accrual',    '2026-02-01', '45.00',  NULL,                '2026-02-28T00:00:00Z'),
  ('accrual',    '2026-03-01', '50.00',  NULL,                '2026-03-31T00:00:00Z'),
  ('withdrawal', NULL,         '-30.00', 'Trip to Rome',      '2026-05-10T00:00:00Z'),
  ('adjustment', NULL,         '15.00',  'Manual correction', '2026-06-15T00:00:00Z');

COMMIT;
