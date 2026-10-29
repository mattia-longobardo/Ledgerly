-- Investments phase 5 rollback (docs/design/investments-phase-5.md): the transfers linked after the
-- deploy. Optional: the image before phase 5 never reads `transfer_group_id`. No migration to undo.
BEGIN;
UPDATE investment_events SET transfer_group_id = NULL WHERE transfer_group_id IS NOT NULL;
COMMIT;
