-- N3.1 · recupero (rewrite plan, 03-releases.md «N3.1»; 06-data.md §6.1 e §6.2; 12-account-modes.md §12.9).
--
-- Il rollback normale è solo l'immagine:
--   docker tag ledgerly:pre-n3-1-send ledgerly:latest && docker compose up -d --no-build ledgerly
-- L'immagine precedente (v0.22.2) funziona con lo schema di N3.1: non scrive le due colonne nuove
-- di `transactions` e non legge le due tabelle nuove.
--
-- Cosa resta dopo il rollback dell'immagine, senza questo file:
-- - Un movimento a mano già inviato resta sulla sorgente ed è un movimento della sorgente anche
--   qui. Ledgerly non lo ritira: si elimina sulla sorgente, a mano.
-- - Un movimento «Da inviare» o «Non inviato» resta in Ledgerly come movimento a mano. L'immagine
--   precedente non lo invia e non lo lascia modificare (il suo dialogo rifiuta i conti «lettura e
--   scrittura»): si può eliminare. Con l'immagine di N3.1 di nuovo attiva parte al primo
--   aggiornamento.
--
-- Questo file serve solo se, dopo il deploy di N3.1, una categoria della sorgente è stata
-- **associata** a un'altra categoria. L'immagine precedente non conosce la corrispondenza: a ogni
-- lettura riporta i movimenti riletti sotto la categoria con il nome della sorgente, che è
-- archiviata, e lascia gli altri dov'erano. Il blocco sotto riporta ogni categoria della sorgente
-- allo stato «aggiunta», come prima di N3.1. Si esegue a mano, prima di avviare l'immagine
-- precedente. Con nessuna associazione fatta non cambia nessuna riga.
BEGIN;
-- 1. I movimenti della sorgente tornano sotto la categoria con il nome della sorgente. Un movimento
--    con una categoria scelta a mano non si tocca.
UPDATE transactions t
SET category_id = s.added_category_id
FROM source_categories s
WHERE t.source_category_id = s.id
  AND t.category_origin = 'provider'
  AND s.added_category_id IS NOT NULL
  AND s.category_id IS DISTINCT FROM s.added_category_id
  AND t.category_id IS DISTINCT FROM s.added_category_id;
-- 2. La categoria con il nome della sorgente, archiviata dall'associazione, torna attiva.
UPDATE categories c
SET archived_at = NULL
FROM source_categories s
WHERE c.id = s.added_category_id
  AND s.category_id IS DISTINCT FROM s.added_category_id
  AND c.archived_at IS NOT NULL;
-- 3. La corrispondenza torna «aggiunta».
UPDATE source_categories
SET category_id = added_category_id
WHERE added_category_id IS NOT NULL
  AND category_id IS DISTINCT FROM added_category_id;
COMMIT;

-- I limiti dei budget sommati da un'associazione non tornano con questo file: si correggono in
-- Budgets, oppure con «Annulla» prima del rollback. Lo schema non si riporta indietro. Il dump
-- `n3-1-send` si ripristina solo se una modifica ai dati è sbagliata: la migrazione scrive le righe
-- della corrispondenza e la categoria della sorgente sui movimenti, e non cambia `category_id`.
