-- docs/design/investments-phase-4-rollback.sql — Investments phase 4 (PERS-85), after the retag to
-- ledgerly:pre-investments-4. Phase 4 has no migration: this script only stops the Binance passes
-- and forgets the key, because the phase 3 image does not know the provider `ccxt:binance`.
--
--   docker exec -i postgres psql -U ledgerly ledgerly -v ON_ERROR_STOP=1 < docs/design/investments-phase-4-rollback.sql
--
-- Revoke the key on Binance as well (API Management): deleting it here does not.
BEGIN;

-- The connection and its credentials; by cascade its sync_jobs (the flows cursor), sync_runs and
-- coverage. The key checks keep their rows with connection_id set to null.
DELETE FROM integration_connections WHERE provider = 'ccxt:binance';

-- The links of the events: the phase 3 image refuses an unknown provider on write, never on read,
-- so they are harmless, but nothing will read them again.
DELETE FROM provider_links WHERE provider = 'ccxt:binance';

-- The service keeps its readings, events and `portfolio` points: the phase 3 engine reads a synced
-- period as it is. Mark it manual, so the catalog does not show it as linked to Binance.
UPDATE investment_accounts SET provider = 'manual', updated_at = now() WHERE provider = 'ccxt:binance';

COMMIT;
