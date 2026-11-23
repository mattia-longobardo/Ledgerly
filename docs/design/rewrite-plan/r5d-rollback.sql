-- Release R5d, step 1 "Manual portfolio": the way back for the database
-- (docs/design/rewrite-plan/03-releases.md "R5d", migration 0069_instruments).
--
-- The step adds three tables of the instance (`instruments`, `instrument_listings`,
-- `instrument_prices`) and a nullable column `investment_assets.instrument_id`. The image before it
-- (`ledgerly:pre-r5d`) reads none of them, so the rollback is the images:
--
--   docker tag ledgerly:pre-r5d ledgerly:latest && docker tag ledgerly-web:pre-r5d ledgerly-web:latest
--   docker compose up -d --no-build
--
-- A manual portfolio made after the deploy (`investment_accounts.provider = 'portfolio'`) stays: the
-- image before shows it as a synced service whose value the module wrote, and its account keeps
-- its last balance. Nothing below touches it.
--
-- Only to remove the step for good (never needed for the images before): run in one transaction.
BEGIN;
ALTER TABLE "investment_assets" DROP CONSTRAINT IF EXISTS "investment_assets_instrument_id_instruments_id_fk";
DROP INDEX IF EXISTS "investment_assets_instrument_idx";
ALTER TABLE "investment_assets" DROP COLUMN IF EXISTS "instrument_id";
DROP TABLE IF EXISTS "instrument_prices";
DROP TABLE IF EXISTS "instrument_listings";
DROP TABLE IF EXISTS "instruments";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795570000000;
COMMIT;
