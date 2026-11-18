-- Release R1 "worker": the way back for the database (docs/design/rewrite-plan/03-releases.md "R1").
--
-- The release only adds three tables, and the image before it (`ledgerly:pre-r1`) never reads them.
-- So the rollback is the images and the compose of before, nothing more:
--
--   docker tag ledgerly:pre-r1 ledgerly:latest && docker tag ledgerly-cron:pre-r1 ledgerly-cron:latest
--   git checkout <tag before R1> -- docker-compose.yml && docker compose up -d --no-build --remove-orphans
--
-- The cron container starts again and the web runs the jobs again; the tables stay, unused.
-- Run this file only if the release is not coming back: it drops the tables and removes the
-- migration from the journal, so that a new deploy applies it again. Nothing in them is worth
-- keeping: tasks not yet run (the schedule makes them again), heartbeats and windows of a limit.
BEGIN;
DROP TABLE IF EXISTS job_queue;
DROP TABLE IF EXISTS worker_heartbeats;
DROP TABLE IF EXISTS rate_limit_counters;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795510000000;
COMMIT;
