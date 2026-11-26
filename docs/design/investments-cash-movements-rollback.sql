-- Versamenti e prelievi di Investments come movimenti nei conti · recupero (PERS-651,
-- investments-cash-movements.md §5; migrazione 0083_investment_legs).
--
-- La migrazione è solo additiva: due colonne nuove e un valore in più nel check dell'origine. I dati
-- nuovi sono le gambe (`transactions.origin = 'investments'`), scritte dalle operazioni e dal
-- passaggio una tantum `--link-investment-legs`. Questo file serve solo se si torna all'immagine
-- precedente: toglie le gambe (i movimenti della banca tornano giroconti «in attesa»), le colonne e
-- rimette il check di prima. Si esegue a mano, dopo l'immagine.
BEGIN;
-- Il gemello di una gamba resta un giroconto da abbinare, come lo vede l'immagine precedente.
UPDATE transactions SET transfer_group_id = NULL
WHERE transfer_group_id IN (SELECT transfer_group_id FROM transactions WHERE origin = 'investments');
DELETE FROM giroconto_proposals
WHERE out_id IN (SELECT id FROM transactions WHERE origin = 'investments')
   OR in_id IN (SELECT id FROM transactions WHERE origin = 'investments');
ALTER TABLE investment_events DROP COLUMN leg_transaction_id;
ALTER TABLE fund_operations DROP COLUMN leg_transaction_id;
DELETE FROM transactions WHERE origin = 'investments';
ALTER TABLE transactions DROP CONSTRAINT transactions_origin_ck;
ALTER TABLE transactions ADD CONSTRAINT transactions_origin_ck CHECK (origin IN ('provider', 'manual'));
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795710000000;
COMMIT;
