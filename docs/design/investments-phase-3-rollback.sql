-- docs/design/investments-phase-3-rollback.sql — Investments phase 3 (PERS-84), after the retag to
-- ledgerly:pre-investments-3. The migration 0038 is additive and the phase 2 image ignores its
-- tables and the new values of its CHECKs, so it stays applied: a later deploy of phase 3 finds it
-- in the journal and skips it. This script only stops the eToro passes and forgets the key.
--
--   docker exec -i postgres psql -U ledgerly ledgerly -v ON_ERROR_STOP=1 < docs/design/investments-phase-3-rollback.sql
--
-- Revoke the key on eToro as well (Settings → API keys): deleting it here does not.
BEGIN;

-- The connection and its credentials; by cascade its sync_jobs, sync_runs and coverage. The key
-- checks keep their rows with connection_id set to null.
DELETE FROM integration_connections WHERE provider = 'etoro';

-- The service keeps its readings and its `portfolio` points: the phase 2 engine reads a synced
-- period as it is. Mark it manual, so the phase 2 catalog does not show it as linked to eToro.
UPDATE investment_accounts SET provider = 'manual', updated_at = now() WHERE provider = 'etoro';

COMMIT;
