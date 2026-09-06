-- Destructive test fixture. Run only against dashboard_test:
--   npm run test:db:up
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run db:migrate
--   docker exec -i dashboard-postgres-test psql -U app_test -d dashboard_test -v ON_ERROR_STOP=1 < scripts/funds-migration-fixture.sql
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run migrate:funds
--   docker exec -i dashboard-postgres-test psql -U app_test -d dashboard_test -v ON_ERROR_STOP=1 < scripts/funds-migration-fixture-after-first.sql
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run migrate:funds
--   docker exec -i dashboard-postgres-test psql -U app_test -d dashboard_test -v ON_ERROR_STOP=1 < scripts/funds-migration-fixture-after-rerun.sql
--   DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test npm run migrate:funds:validate

DO $$ BEGIN
  IF current_database() <> 'dashboard_test' THEN
    RAISE EXCEPTION 'fixture may run only against dashboard_test';
  END IF;
END $$;

BEGIN;
SELECT set_config('app.user_id', '', true), set_config('app.role', 'system', true);

TRUNCATE TABLE organizations, legacy_funds, balance_snapshots RESTART IDENTITY CASCADE;

INSERT INTO roles (code, label) VALUES ('owner', 'Owner') ON CONFLICT (code) DO NOTHING;
INSERT INTO organizations (id, name)
VALUES ('10000000-0000-7000-8000-000000000001', 'Funds fixture');
INSERT INTO users (id, organization_id, email, display_name, currency)
VALUES (
  '10000000-0000-7000-8000-000000000002',
  '10000000-0000-7000-8000-000000000001',
  'funds-fixture@example.test',
  'Funds fixture owner',
  'EUR'
);
INSERT INTO user_roles (user_id, role_code)
VALUES ('10000000-0000-7000-8000-000000000002', 'owner');

INSERT INTO legacy_funds (id, slug, name) VALUES
  (1, 'fideuram', 'Fideuram'),
  (2, 'cometa', 'Fondo Cometa');

INSERT INTO fund_settings (fund_id, effective_from, initial_capital, deposit_mode, fixed_monthly_amount) VALUES
  (1, '2026-01-01', '1000.00', 'fixed', '100.00'),
  (1, '2026-06-01', '9999.00', 'fixed', '25.00'),
  (2, '2026-01-01', '100.00', 'payroll', NULL),
  (2, '2026-06-01', '777.00', 'payroll', NULL);

INSERT INTO fund_deposits (fund_id, month, amount, employee_part, employer_part, source) VALUES
  (1, '2026-01-01', '100.00', NULL, NULL, 'fixed'),
  (1, '2026-02-01', '50.00', NULL, NULL, 'manual'),
  (1, '2026-09-01', '25.00', NULL, NULL, 'fixed'),
  (2, '2026-01-01', '30.00', '10.00', '20.00', 'payroll'),
  (2, '2026-04-01', '60.00', '20.00', '40.00', 'payroll'),
  (2, '2026-09-01', '90.00', NULL, NULL, 'payroll');

INSERT INTO payroll_imports (
  id, user_id, status, file_name, size_bytes, sha256, storage_key,
  text_source, scan_status, retention_until, uploaded_via
) VALUES (
  '10000000-0000-7000-8000-000000000010',
  '10000000-0000-7000-8000-000000000002',
  'applied', '2026-01.pdf', 1, repeat('a', 64), 'fixture/2026-01.pdf',
  'pdf_text', 'clean', '2030-01-01T00:00:00Z', 'migration'
);
INSERT INTO payroll_records (
  id, user_id, import_id, period_start, period_end, kind, currency
) VALUES (
  '10000000-0000-7000-8000-000000000011',
  '10000000-0000-7000-8000-000000000002',
  '10000000-0000-7000-8000-000000000010',
  '2026-01-01', '2026-01-31', 'ordinary', 'EUR'
);

-- Existing correctly named Fideuram account: migration must link and preserve it.
INSERT INTO accounts (
  id, user_id, name, type, currency, origin, notes
) VALUES (
  '10000000-0000-7000-8000-000000000020',
  '10000000-0000-7000-8000-000000000002',
  'Fideuram', 'investment', 'EUR', 'manual', 'pre-existing'
);
INSERT INTO account_balances (
  account_id, as_of, balance, source, captured_at
) VALUES
  ('10000000-0000-7000-8000-000000000020', '2026-01-01', '1100.00', 'migration', '2026-01-01T00:00:00Z'),
  ('10000000-0000-7000-8000-000000000020', '2026-02-01', '1200.00', 'migration', '2026-02-01T00:00:00Z');

INSERT INTO accounts (
  id, user_id, name, type, currency, origin, notes
) VALUES (
  '10000000-0000-7000-8000-000000000021',
  '10000000-0000-7000-8000-000000000002',
  'Unrelated', 'savings', 'EUR', 'manual', 'must survive'
);
INSERT INTO account_balances (
  account_id, as_of, balance, source, captured_at
) VALUES (
  '10000000-0000-7000-8000-000000000021',
  '2026-01-15', '42.00', 'manual', '2026-01-15T12:00:00Z'
);

-- The non-latest row wins January even though the stale latest row is newer.
-- The later id wins the February captured_at tie.
INSERT INTO balance_snapshots (source, account_key, balance, captured_at, raw) VALUES
  ('teable', 'fideuram', '1100.00', '2026-01-01T00:00:00Z', '{"kind":"history"}'),
  ('teable', 'fideuram', '999.00', '2026-01-31T20:00:00Z', '{"kind":"latest"}'),
  ('teable', 'fideuram', '1190.00', '2026-02-01T00:00:00Z', '{"kind":"history"}'),
  ('teable', 'fideuram', '1200.00', '2026-02-01T00:00:00Z', '{"kind":"history"}'),
  ('teable', 'cometa', '111.00', '2026-01-01T00:00:00Z', '{"kind":"history"}'),
  ('teable', 'cometa', '999.00', '2026-01-31T20:00:00Z', '{"kind":"latest"}'),
  ('teable', 'cometa', '222.00', '2026-02-01T00:00:00Z', '{"kind":"history"}');

COMMIT;
