-- Release R5c, step P2 "Trek come plugin": the way back for the database (docs/design/rewrite-plan/03-releases.md "R5c").
--
-- The step adds three nullable columns to `leave_days` (`external_kind`, `external_fraction`,
-- `external_state`) and lets `origin` be `external` beside `trek`. The image before it never reads
-- the new columns and writes no `external` origin, so the rollback is the images:
--
--   docker tag ledgerly:pre-r5c ledgerly:latest && docker tag ledgerly-web:pre-r5c ledgerly-web:latest
--   docker compose up -d --no-build
--
-- Run this file only if the step is not coming back: it drops the columns, restores the two checks
-- as they were and removes the migration from the journal, so that a new deploy applies it again.
-- It loses nothing: the new columns are a copy of `trek_*`, and `refused` is written again by the
-- next pass. A row with `origin = 'external'` cannot exist before P3; one found stops the rollback.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM leave_days WHERE origin = 'external') THEN
    RAISE EXCEPTION 'R5c rollback: leave_days has rows of origin external; rename them to trek first';
  END IF;
END $$;
ALTER TABLE leave_days DROP CONSTRAINT IF EXISTS leave_days_external_ck;
ALTER TABLE leave_days DROP COLUMN IF EXISTS external_kind;
ALTER TABLE leave_days DROP COLUMN IF EXISTS external_fraction;
ALTER TABLE leave_days DROP COLUMN IF EXISTS external_state;
ALTER TABLE leave_days DROP CONSTRAINT leave_days_origin_ck;
ALTER TABLE leave_days ADD CONSTRAINT leave_days_origin_ck CHECK (origin in ('manual', 'trek'));
ALTER TABLE leave_days DROP CONSTRAINT leave_days_pending_delete_ck;
ALTER TABLE leave_days ADD CONSTRAINT leave_days_pending_delete_ck
  CHECK (pending <> 'delete' or origin = 'trek' or synced_at is not null);
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795580000000;
COMMIT;
