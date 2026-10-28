-- docs/design/investments-phase-2-rollback.sql — SQL inverso della fase 2 Investments (PERS-83,
-- docs/design/investments.md §7). Da eseguire DOPO il retag delle immagini pre-investments-2, in una
-- sola transazione:
--   docker exec -i postgres psql -U ledgerly ledgerly -v ON_ERROR_STOP=1 < docs/design/investments-phase-2-rollback.sql
--
-- Le scritture rappresentabili nel modello vecchio (depositi, prelievi, valutazioni del conto)
-- tornano nelle tabelle legacy; le tabelle nuove restano (additive) e conservano ciò che il modello
-- vecchio non sa rappresentare (asset, letture, rettifiche). L'immagine precedente le ignora.
BEGIN;

-- 1. Le tabelle legacy tornano scrivibili.
DROP TRIGGER IF EXISTS "investment_platforms_read_only" ON "investment_platforms";
DROP TRIGGER IF EXISTS "investment_movements_read_only" ON "investment_movements";
DROP TRIGGER IF EXISTS "investment_valuations_read_only" ON "investment_valuations";
DROP FUNCTION IF EXISTS "investments_legacy_read_only"();

-- 2. Un servizio creato dopo il deploy, senza piattaforma legacy, che ha movimenti o valutazioni:
--    una piattaforma nuova con il nome del conto (il nome è unico per utente nel modello vecchio).
CREATE TEMP TABLE "rollback_platforms" ON COMMIT DROP AS
SELECT ia."id" AS "investment_account_id", ia."user_id", ia."legacy_platform_id" AS "platform_id"
FROM "investment_accounts" ia
WHERE ia."legacy_platform_id" IS NOT NULL;

INSERT INTO "rollback_platforms" ("investment_account_id", "user_id", "platform_id")
SELECT ia."id", ia."user_id", uuidv7()
FROM "investment_accounts" ia
WHERE ia."legacy_platform_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "investment_events" e JOIN "investment_operations" o ON o."event_id" = e."id"
    WHERE e."investment_account_id" = ia."id" AND o."kind" IN ('deposit', 'withdrawal', 'account_valuation')
  );

INSERT INTO "investment_platforms" ("id", "user_id", "name", "url")
SELECT r."platform_id", r."user_id",
  left(a."name", 54) || CASE
    WHEN EXISTS (SELECT 1 FROM "investment_platforms" p WHERE p."user_id" = r."user_id" AND p."name" = left(a."name", 60))
    THEN ' (' || left(r."platform_id"::text, 4) || ')' ELSE '' END,
  ia."url"
FROM "rollback_platforms" r
JOIN "investment_accounts" ia ON ia."id" = r."investment_account_id"
JOIN "accounts" a ON a."id" = ia."account_id"
WHERE ia."legacy_platform_id" IS NULL;

-- 3. Movimenti e valutazioni di ogni piattaforma rifatti dagli eventi correnti del suo conto
--    (compresi quelli scritti dopo il deploy). Una valutazione per giorno: l'ultima del giorno.
DELETE FROM "investment_movements" m USING "rollback_platforms" r WHERE m."platform_id" = r."platform_id";
DELETE FROM "investment_valuations" v USING "rollback_platforms" r WHERE v."platform_id" = r."platform_id";

INSERT INTO "investment_movements" ("user_id", "platform_id", "kind", "amount_cents", "on", "transaction_id", "note")
SELECT e."user_id", r."platform_id", o."kind", abs(o."amount_cents"), e."on", e."transaction_id",
  CASE WHEN length(btrim(coalesce(e."note", ''))) BETWEEN 1 AND 200 THEN e."note" END
FROM "investment_events" e
JOIN "investment_operations" o ON o."event_id" = e."id"
JOIN "rollback_platforms" r ON r."investment_account_id" = e."investment_account_id"
WHERE o."kind" IN ('deposit', 'withdrawal') AND o."amount_cents" <> 0
ORDER BY e."on", e."occurred_at", e."seq";

INSERT INTO "investment_valuations" ("user_id", "platform_id", "on", "value_cents")
SELECT DISTINCT ON (r."platform_id", e."on") e."user_id", r."platform_id", e."on", GREATEST(o."amount_cents", 0)
FROM "investment_events" e
JOIN "investment_operations" o ON o."event_id" = e."id"
JOIN "rollback_platforms" r ON r."investment_account_id" = e."investment_account_id"
WHERE o."kind" = 'account_valuation'
ORDER BY r."platform_id", e."on", e."occurred_at" DESC, e."seq" DESC;

-- 4. I punti `portfolio` spariscono; le entry archiviate dai passaggi di autorità tornano.
DELETE FROM "balance_entries" WHERE "source" = 'portfolio';

INSERT INTO "balance_entries" ("id", "user_id", "account_id", "on", "balance_cents", "available_cents", "source", "note", "captured_at")
SELECT s."balance_entry_id", s."user_id", s."account_id", s."on", s."balance_cents", s."available_cents", s."source", s."note", s."captured_at"
FROM "investment_superseded_entries" s
ON CONFLICT DO NOTHING;
DELETE FROM "investment_superseded_entries";

-- 5. I conti creati dalla migrazione per le piattaforme legacy vengono archiviati: il modello
--    vecchio mostra di nuovo la piattaforma, e il conto non comparirebbe due volte.
UPDATE "accounts" a SET "state" = 'archived', "archived_at" = now()
FROM "investment_accounts" ia
WHERE ia."account_id" = a."id" AND ia."legacy_platform_id" IS NOT NULL AND a."state" <> 'archived';

-- 6. La riga di 0037 nel journal: un nuovo deploy della fase 2 la riapplica. La migrazione rieseguita
--    fallisce sulle tabelle già esistenti: prima di un nuovo deploy vanno eliminate (vedi il doc).
--    `created_at` è il `when` di 0037 in drizzle/meta/_journal.json: se il journal cambia, aggiornalo.
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793145211239;

COMMIT;
