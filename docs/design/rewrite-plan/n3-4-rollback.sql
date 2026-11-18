-- N3.4 · recupero (categories-and-rules.md §4 e §10; migrazione 0061_rules).
--
-- Il rollback normale è solo l'immagine:
--   docker tag ledgerly:pre-n3-4 ledgerly:latest && docker compose up -d --no-build ledgerly
-- L'immagine precedente (v0.33.0) funziona con lo schema di N3.4: non legge `category_rules`,
-- `category_rule_undos` e `transactions.category_rule_id`. Un movimento con categoria da regola
-- (`category_origin = 'rule'`) per lei è una categoria scelta: conta come oggi, senza il segno
-- «automatica». Le regole non si applicano più ai movimenti nuovi finché l'immagine di N3.4 non torna.
--
-- Questo file serve solo per togliere anche lo schema di N3.4. Si esegue a mano, dopo l'immagine.
-- Il check di `category_origin` si restringe solo dopo aver portato `rule` a `table` (§10): un
-- movimento da regola resta automatico, con la sua categoria, e nessun numero cambia.
BEGIN;
UPDATE transactions SET category_origin = 'table', category_reason = NULL, category_reason_params = NULL
WHERE category_origin = 'rule';
ALTER TABLE transactions DROP CONSTRAINT transactions_category_origin_ck;
ALTER TABLE transactions ADD CONSTRAINT transactions_category_origin_ck
  CHECK (category_origin IS NULL OR category_origin IN ('user', 'provider', 'memory', 'model', 'table'));
ALTER TABLE transactions DROP COLUMN category_rule_id;
DROP TABLE category_rule_undos;
DROP TABLE category_rules;
-- La riga del registro delle migrazioni: `created_at` è il `when` di 0061 in drizzle/meta/_journal.json.
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795490000000;
COMMIT;
