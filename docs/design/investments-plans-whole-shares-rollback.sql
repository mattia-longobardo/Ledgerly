-- Rollback of the basket plans (PERS-681, docs/design/investments-plans-whole-shares.md §3.6), for the
-- image before migration 0084_plan_baskets. Run it in one transaction, after a dump, then deploy the
-- previous image. The new tables and columns stay: the previous image does not read them.
-- Replace :deployed_at with the time of the deploy of 0084 (timestamptz).
BEGIN;

-- The plans the previous image would run wrongly are paused; send the list to Mattia, who starts them again.
UPDATE investment_plans SET state = 'paused', updated_at = now()
WHERE model = 'basket' AND state = 'active' AND (
  created_at >= :'deployed_at'::timestamptz
  OR frequency = 'day'
  OR id IN (SELECT plan_id FROM investment_plan_instruments GROUP BY plan_id HAVING count(*) > 1)
)
RETURNING id, name;

-- The previous image does not know 'expired', nor the open executions of a basket.
UPDATE investment_plan_runs SET state = 'skipped', updated_at = now()
WHERE state = 'expired'
   OR (state IN ('pending', 'waiting_price', 'proposed') AND id IN (SELECT run_id FROM investment_plan_run_lines))
   OR (state IN ('pending', 'waiting_price', 'proposed') AND plan_id IN (SELECT id FROM investment_plans WHERE model = 'basket'));

UPDATE investment_plans SET model = 'single', updated_at = now() WHERE model = 'basket';

-- The facts of the new event: the previous image does not know it (the new image raises them again).
-- The checks stay as 0084 left them, wider: the previous image writes none of the new values, and a
-- deploy of the new image again finds them (0084 is not applied twice).
DELETE FROM notifications WHERE event = 'plan_amount_missing';
DELETE FROM notification_preferences WHERE event = 'plan_amount_missing';

COMMIT;

-- For ever (never needed for the images), after the line above:
--   DROP TABLE investment_plan_run_lines, investment_plan_instruments;
--   ALTER TABLE investment_plans DROP COLUMN model, DROP COLUMN execution_amount_cents;
--   ALTER TABLE investment_plan_runs DROP COLUMN budget_cents, DROP COLUMN carry_in_cents, DROP COLUMN carry_out_cents;
--   the frequency and the notification checks as in 0083, and the row of 0084 in drizzle.__drizzle_migrations.
