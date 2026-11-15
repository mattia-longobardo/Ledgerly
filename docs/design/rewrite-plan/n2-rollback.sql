-- N2 · recupero (rewrite plan, 03-releases.md «N2»; 06-data.md §6.1 e §6.2).
--
-- Il rollback normale è solo l'immagine:
--   docker tag ledgerly:pre-n2 ledgerly:latest && docker compose up -d --no-build ledgerly
-- L'immagine precedente (v0.19.1) funziona con lo schema di N2: ignora le colonne nuove e salva
-- ogni collegamento sulla chiave (user_id, provider, instance_key). Questo file serve solo nei
-- casi sotto. Si esegue a mano, un blocco per volta, dentro una transazione.

-- 1. Le chiavi degli avvisi. L'immagine precedente cerca `wallet_sync_failed` e `wallet_sync_stale`:
--    senza questo passo può mandare una volta in più una mail già mandata negli ultimi 7 giorni.
--    Le chiavi nuove sono usate da N2 per ogni fornitore; l'immagine precedente avvisa solo per Wallet.
BEGIN;
UPDATE notifications_log n SET kind = 'wallet_sync_failed'
  FROM integration_connections c
  WHERE n.kind = 'sync_failed' AND c.id::text = n.key AND c.provider = 'wallet';
UPDATE notifications_log n SET kind = 'wallet_sync_stale'
  FROM integration_connections c
  WHERE n.kind = 'sync_stale' AND c.id::text = n.key AND c.provider = 'wallet';
COMMIT;

-- 2. La chiave unica vecchia. Non serve all'immagine v0.19.1. Serve solo per tornare a
--    un'immagine più vecchia della v0.19.1 (v0.19.0 o prima), che salva con
--    ON CONFLICT (user_id, provider). Fallisce se un utente ha più di una banca: prima va
--    scollegata dall'interfaccia ogni banca oltre la prima.
-- BEGIN;
-- ALTER TABLE integration_connections
--   ADD CONSTRAINT integration_connections_user_provider_uq UNIQUE (user_id, provider);
-- COMMIT;

-- 3. Le modifiche ai dati non si annullano con SQL: le righe di `sync_runs` oltre 30 giorni e lo
--    stato `running` delle righe orfane tornano solo dal dump `n2-<sha7>/ledgerly.dump`
--    (docs/RELEASE.md §8). Sono righe di registro: nessun numero dipende da loro.

-- Le colonne nuove (`error_code`, `consecutive_failures`, `origin`, `http_status`, `app_version`,
-- `unreachable_since`) restano: sono additive e l'immagine precedente non le legge.
