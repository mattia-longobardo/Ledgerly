-- Release R5a, step c "Subscriptions and Pockets": the way back for the database
-- (docs/design/rewrite-plan/03-releases.md "R5a").
--
-- The step adds nullable columns (`subscriptions.every_unit`, `every_count`), a column with a default
-- (`pockets.accrual_day`), a unique index per month of the accruals, makes `subscriptions.utility`
-- nullable and widens two checks. The image before it (`ledgerly:pre-r5a-c`) reads `cycle`, which
-- holds the nearest cycle of an «every», so the rollback is the images:
--
--   docker tag ledgerly:pre-r5a-c ledgerly:latest && docker tag ledgerly-web:pre-r5a-c ledgerly-web:latest
--   docker compose up -d --no-build
--
-- Two things the image before does not know, made after the deploy, need this file before it:
-- a subscription saved with no vote (its list would refuse the null) and an accrual on a day other
-- than the 1st (its next accrual of that month would meet the monthly index). The file gives the
-- votes back (5), keeps the accruals and drops what the image before does not have.
BEGIN;
UPDATE subscriptions SET utility = 5 WHERE utility IS NULL;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_every_ck;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS every_unit;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS every_count;
ALTER TABLE subscriptions ALTER COLUMN utility SET NOT NULL;
DROP INDEX IF EXISTS pocket_movements_accrual_month_uq;
ALTER TABLE pockets DROP CONSTRAINT IF EXISTS pockets_accrual_day_ck;
ALTER TABLE pockets DROP COLUMN IF EXISTS accrual_day;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795560000000;
COMMIT;
