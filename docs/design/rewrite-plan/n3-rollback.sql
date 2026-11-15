-- N3 · recupero (rewrite plan, 03-releases.md «N3»; 06-data.md §6.1 e §6.2; 12-account-modes.md §12.8).
--
-- Il rollback normale è solo l'immagine:
--   docker tag ledgerly:pre-n3-1 ledgerly:latest && docker compose up -d --no-build ledgerly
-- L'immagine precedente (v0.20.0) funziona con lo schema di N3: non scrive le colonne nuove di
-- `transactions`, e la colonna `origin` ha il default `provider`. I movimenti a mano restano: per
-- l'immagine precedente sono movimenti normali, senza il badge e senza il loro dialogo.
-- Questo file serve solo nel caso sotto. Si esegue a mano, dentro una transazione.

-- 1. I saldi dopo i movimenti a mano. L'immagine precedente legge le righe con fonte `movement`
--    come un saldo qualunque, ma non le aggiorna: dopo un movimento a mano cambiato o eliminato
--    con quell'immagine, o dopo una lettura della banca, il saldo del giorno può restare quello
--    vecchio. Questo passo le cancella: da lì l'immagine precedente mostra il saldo senza i
--    movimenti a mano, come prima di N3. Nessun movimento e nessun saldo letto o scritto da una
--    persona viene toccato. Con l'immagine di N3 di nuovo attiva le righe si ricreano da sole al
--    primo movimento a mano o alla prima lettura.
BEGIN;
DELETE FROM balance_entries WHERE source = 'movement';
COMMIT;

-- 2. Lo schema non si riporta indietro: le due colonne di `transactions`, l'indice della chiave
--    di idempotenza e il check più largo di `balance_entries` sono compatibili con l'immagine
--    precedente. Il dump `n3-1` si ripristina solo se una modifica ai dati è sbagliata; questa
--    parte di N3 non modifica nessun dato esistente.
