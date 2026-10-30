# Investments · drop delle tabelle legacy

PERS-98, ultimo passo della fase 5 di `docs/design/investments.md` (§7). La migrazione
`0043_drop_legacy_investments` elimina `investment_platforms`, `investment_movements`,
`investment_valuations`, la funzione `investments_legacy_read_only` e la colonna
`investment_accounts.legacy_platform_id`. Mattia ha anticipato il drop rispetto al 27/11/2026.

`investment_superseded_entries` resta: `service.ts` e `sync.ts` la scrivono ancora a ogni passaggio
di autorità.

## Cosa si perde

I conti migrati dalla fase 2 non esistono più: eToro e Binance sono stati ricollegati come conti nuovi
il 28/10/2026 (`legacy_platform_id` è vuota su tutti i conti). Le tabelle legacy conservano 2
piattaforme, 5 movimenti e 2 valutazioni. Dopo il drop, questi dati esistono solo nel dump. Nessuna
pagina li legge.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-drop` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-drop`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-drop.dump`.
3. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (la migrazione parte
   dall'entrypoint). `cron/` non cambia.

## Rollback

Il dump resta in `backups/ledgerly/pre-investments-drop.dump`: è l'unica copia dei dati. Procedura
validata su una copia del DB di produzione. Non usa un `pg_restore --clean` completo, che cancellerebbe
le scritture successive al drop.

1. Colonna e riga del journal (`created_at` è il `when` di 0043 in `drizzle/meta/_journal.json`):
   ```sql
   BEGIN;
   ALTER TABLE "investment_accounts" ADD COLUMN "legacy_platform_id" uuid;
   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793375998535;
   COMMIT;
   ```
2. Tabelle, vincoli, indici, funzione e trigger, solo per queste voci del dump:
   ```sh
   docker cp ../../backups/ledgerly/pre-investments-drop.dump postgres:/tmp/drop.dump
   docker exec postgres sh -c "pg_restore -l /tmp/drop.dump | grep -E 'investment_(platforms|movements|valuations)|investments_legacy_read_only' > /tmp/drop.list"
   docker exec postgres pg_restore -U ledgerly -d ledgerly --single-transaction -L /tmp/drop.list /tmp/drop.dump
   docker exec postgres rm -f /tmp/drop.dump /tmp/drop.list
   ```
3. Immagine: `docker tag ledgerly:pre-investments-drop ledgerly:latest`, poi
   `docker compose up -d --no-build ledgerly`.

Un nuovo deploy di `main` dopo il rollback riapplica la `0043`.
