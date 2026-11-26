-- Giroconti senza categoria e albero di Wallet · recupero (categories-and-rules.md §13; migrazioni
-- 0079_giroconti_wallet_tree, 0080_wallet_category_tree, 0081_category_labels e 0082_times_from_text).
--
-- La migrazione cambia dati: le categorie di Trasferimenti e la loro assegnazione ai giroconti si
-- eliminano, i 15 default si rinominano e si spostano. Il recupero dei dati è solo il dump `pre-*`
-- preso nello stage di release, prima del deploy, con l'immagine `pre-*` (procedura di
-- `docs/operations.md`, «Release dumps» e «Deploy»).
--
-- L'immagine precedente da sola non basta con lo schema nuovo: crea categorie di tipo `transfer` e
-- giroconti con categoria, che i check nuovi rifiutano. Questo file serve solo se si torna
-- all'immagine precedente SENZA il dump (i dati restano quelli migrati: albero nuovo, giroconti senza
-- categoria): toglie lo schema nuovo e rimette il check di prima. Si esegue a mano, dopo l'immagine.
BEGIN;
ALTER TABLE transactions DROP CONSTRAINT transactions_transfer_outside_ck;
ALTER TABLE transactions DROP CONSTRAINT transactions_transfer_category_ck;
-- Un giroconto verso un conto esterno torna un giroconto «spaiato», come lo vede l'immagine precedente.
ALTER TABLE transactions DROP COLUMN transfer_outside;
ALTER TABLE transactions DROP COLUMN transfer_account_id;
DROP TABLE giroconto_proposals;
ALTER TABLE categories DROP CONSTRAINT categories_type_ck;
ALTER TABLE categories ADD CONSTRAINT categories_type_ck CHECK (type IN ('income', 'expense', 'transfer'));
-- Anche 0081_category_labels torna indietro: drizzle riapplica solo le migrazioni più recenti
-- dell'ultima registrata, quindi con la riga di 0081 un nuovo deploy salterebbe 0079 e 0080.
-- Le etichette importate si perdono: si reimportano dal file dopo il nuovo deploy.
DROP TABLE category_labels;
ALTER TABLE category_models DROP COLUMN group_threshold;
-- E 0082_times_from_text, per la stessa ragione: è idempotente (solo righe senza ora), il nuovo
-- deploy la riapplica dopo 0079–0081.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at IN (1795670000000, 1795680000000, 1795690000000, 1795700000000);
COMMIT;
