-- Release R5g, pull request 1 "Time off" (migration 0074): the way back for the database, with the
-- image `pre-r5g-timeoff`. Run it alone, after the image before is running again.
--
-- The release only adds: the old columns stayed written, so the image before reads every day, every
-- allowance and the patron saint as they are. What does not come back: the types a person made, the
-- days off of the year besides the patron saint, the working week and the first month of the leave
-- year, the carry-over stated by hand. A day of a type made after the release has no old kind: it
-- becomes a day of "other", or goes when its date already has one (the old key is one row per date
-- and kind). A row counted in hours keeps its nearest half or whole day, which it always wrote.
BEGIN;
DELETE FROM leave_days d
WHERE d.kind IS NULL
  AND EXISTS (SELECT 1 FROM leave_days o WHERE o.user_id = d.user_id AND o.on = d.on AND o.kind = 'other');
DELETE FROM leave_days d USING leave_days o
WHERE d.kind IS NULL AND o.kind IS NULL AND d.user_id = o.user_id AND d.on = o.on AND d.id > o.id;
UPDATE leave_days SET kind = 'other' WHERE kind IS NULL;
ALTER TABLE leave_days DROP CONSTRAINT leave_days_user_on_type_uq;
ALTER TABLE leave_days DROP CONSTRAINT leave_days_minutes_ck;
ALTER TABLE leave_days DROP CONSTRAINT leave_days_type_id_leave_types_id_fk;
DROP INDEX leave_days_type_idx;
ALTER TABLE leave_days DROP COLUMN type_id;
ALTER TABLE leave_days DROP COLUMN minutes;
ALTER TABLE leave_days ALTER COLUMN kind SET NOT NULL;
ALTER TABLE leave_days DROP CONSTRAINT leave_days_pending_delete_ck;
ALTER TABLE leave_days ADD CONSTRAINT leave_days_pending_delete_ck
  CHECK (pending <> 'delete' OR origin IN ('trek', 'external') OR synced_at IS NOT NULL);
DROP TABLE leave_allowances;
DROP TABLE leave_rest_days;
DROP TABLE leave_settings;
DROP TABLE leave_types;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795620000000;
COMMIT;
