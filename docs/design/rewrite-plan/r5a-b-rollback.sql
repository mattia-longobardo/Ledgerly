-- Release R5a, step b "first start": the way back for the database (docs/design/rewrite-plan/03-releases.md "R5a").
--
-- The step adds two nullable columns to `user_preferences` (`country`, `onboarded_at`) and its check,
-- sets `onboarded_at` on the rows of today, and gives a row to a person who had none. The image before
-- it (`ledgerly:pre-r5a-b`) never reads the columns, and reads a row with the same values it used as
-- defaults, so the rollback is the images, nothing more:
--
--   docker tag ledgerly:pre-r5a-b ledgerly:latest && docker tag ledgerly-web:pre-r5a-b ledgerly-web:latest
--   docker compose up -d --no-build
--
-- Run this file only if the step is not coming back: it drops the columns and removes the migration
-- from the journal. The rows given to a person who had none stay: they hold the old defaults.
BEGIN;
ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_country_ck;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS country;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS onboarded_at;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795550000000;
COMMIT;
