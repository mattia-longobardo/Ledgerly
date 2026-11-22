-- Release R5e "Avvisi": the way back for the database (docs/design/rewrite-plan/03-releases.md "R5e").
--
-- The release adds two tables, `notifications` and `notification_preferences`, and one column with a
-- default, `user_preferences.hide_amounts`. The image before it (`ledgerly:pre-r5e`) never reads them,
-- and its emails still use `notifications_log`, which R5e keeps as it is. The rollback is the images:
--
--   docker tag ledgerly:pre-r5e ledgerly:latest && docker tag ledgerly-web:pre-r5e ledgerly-web:latest
--   docker compose up -d --no-build
--
-- Run this file only if the release is not coming back: it drops the tables and the column and
-- removes the migration from the journal, so that a new deploy applies it again. What it loses: the
-- open facts of «Da fare» (the next jobs open them again), the channels a person changed, and
-- «Nascondi importi» (it comes back off).
BEGIN;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_preferences;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS hide_amounts;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795540000000;
COMMIT;
