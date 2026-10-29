-- Investments history rollback (docs/design/investments-history.md, PERS-100): the estimated
-- readings go, each service whose opening period was moved back to them starts again at its first
-- real reading, and the check of 0038 comes back. The migration row of 0039 stays: the image
-- before it does not read the journal past its own last migration.
BEGIN;
WITH moved AS (
  SELECT r.investment_account_id AS id, min(r.on) FILTER (WHERE r.status <> 'estimated') AS first_real
  FROM investment_readings r
  WHERE r.investment_account_id IN (SELECT investment_account_id FROM investment_readings WHERE status = 'estimated')
  GROUP BY r.investment_account_id
)
UPDATE investment_account_periods p SET from_on = m.first_real, starts_at = m.first_real::timestamptz
FROM moved m WHERE p.investment_account_id = m.id AND p.reason = 'opening' AND m.first_real IS NOT NULL;
WITH moved AS (
  SELECT r.investment_account_id AS id, min(r.on) FILTER (WHERE r.status <> 'estimated') AS first_real
  FROM investment_readings r
  WHERE r.investment_account_id IN (SELECT investment_account_id FROM investment_readings WHERE status = 'estimated')
  GROUP BY r.investment_account_id
)
UPDATE investment_accounts a SET managed_since = m.first_real, opened_on = m.first_real
FROM moved m WHERE a.id = m.id AND m.first_real IS NOT NULL;
WITH moved AS (
  SELECT ia.account_id, min(r.on) FILTER (WHERE r.status <> 'estimated') AS first_real
  FROM investment_readings r JOIN investment_accounts ia ON ia.id = r.investment_account_id
  WHERE r.investment_account_id IN (SELECT investment_account_id FROM investment_readings WHERE status = 'estimated')
  GROUP BY ia.account_id
)
DELETE FROM balance_entries b USING moved m
WHERE b.account_id = m.account_id AND b.source = 'portfolio' AND b.on < m.first_real;
DELETE FROM investment_readings WHERE status = 'estimated';
DELETE FROM investment_sync_coverage WHERE stream = 'balance_history' AND reason = 'estimated';
ALTER TABLE investment_readings DROP CONSTRAINT investment_readings_status_ck;
ALTER TABLE investment_readings ADD CONSTRAINT investment_readings_status_ck
  CHECK (status IN ('complete', 'partial', 'confirmed_zero', 'pending_zero'));
COMMIT;
