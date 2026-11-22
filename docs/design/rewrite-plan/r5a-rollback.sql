-- Release R5a, step a "Addons": the way back for the database (docs/design/rewrite-plan/03-releases.md "R5a").
--
-- The step adds one column with a default, `user_preferences.modules`, and its check. The image before
-- it (`ledgerly:pre-r5a`) never reads them, so the rollback is the images, nothing more:
--
--   docker tag ledgerly:pre-r5a ledgerly:latest && docker tag ledgerly-web:pre-r5a ledgerly-web:latest
--   docker compose up -d --no-build
--
-- Run this file only if the step is not coming back: it drops the column and removes the migration
-- from the journal, so that a new deploy applies it again. What it loses: the addons a person turned
-- off after the deploy (each comes back on).
BEGIN;
ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_modules_ck;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS modules;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795530000000;
COMMIT;
