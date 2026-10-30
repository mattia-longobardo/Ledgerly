# Investments · taglio a 12 mesi e un solo calcolo (PERS-145)

Regole di Mattia del 29–30/10/2026 (thread su PERS-79), scritte in `investments-ux.md` §4.2, §4.4 e
§4.10. Questo documento dice come si porta in produzione e come si torna indietro.

## Cosa cambia nei dati

- **Migrazione 0042** `reading_reconstructed`: lo stato `estimated` delle letture diventa
  `reconstructed` (check aggiornato), `price_source` `estimated` → `close`, la copertura
  `balance_history` ricostruita diventa `complete`. Nessuna colonna nuova.
- **Pulizia** (`settleCutoff`, alla prima passata del sync o con `scripts/investments-cutoff.ts`), solo
  per i servizi sincronizzati collegati come nuovi:
  - cancella gli eventi del provider prima del taglio (con le gambe e i link `provider_links`), le
    letture prima del taglio e le posizioni del provider rimaste senza gambe e senza letture;
  - scrive la cassa del taglio come `opening_cash` (nota `cutoff_opening`, link `opening:cash`), se il
    provider non l'ha già scritta;
  - scrive ogni scarto di cassa come voce propria (`fee` o `income`, nota `exchange_cost` o
    `balance_difference`, link `gap:<dal>:<al>`);
  - riscrive i punti `portfolio` dal taglio.
  È idempotente: una seconda esecuzione non cambia nulla. I conti di Wallet manager, i servizi manuali,
  gli handover e le conversioni non si toccano (integration test `cutoff.itest.ts`).

Produzione al 29/10/2026 (copia di prova `ledgerly_scratch145`): eToro 928 eventi del 2021–2023
cancellati, apertura 0,33 USD al 02/11/2025, una voce "Costo di cambio" −43,56 USD il 16/06/2026;
Binance nessun evento prima del taglio, 4 voci "Differenza di saldo" (−0,06 € il 15/11/2025, +0,08 € il
19/11/2025, +0,01 € il 03/01/2026, −1,38 € il 10/05/2026).

## Deploy (git-policy §7, `AGENTS.md`)

```sh
flock -n /var/lock/deploy-ledgerly.lock -c '
  docker tag ledgerly:latest ledgerly:pre-investments-cutoff &&
  docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-cutoff &&
  docker exec postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" -Fc ledgerly" \
    > ../../backups/ledgerly/pre-investments-cutoff.dump &&
  docker compose build ledgerly && docker compose up -d --wait ledgerly &&
  sh scripts/on-homelab.sh scripts/investments-cutoff.ts
'
```

`cron/` non cambia: `ledgerly-cron` resta com'è (il tag serve solo al rollback). L'entrypoint applica la
migrazione 0042 prima che il server parta. Lo script stampa, per ogni servizio, eventi, letture e
posizioni cancellati, l'apertura e le voci scritte.

## Rollback

Il codice torna con l'immagine; i dati cancellati tornano solo dal dump.

```sh
docker compose stop ledgerly ledgerly-cron
docker exec -i postgres sh -c 'pg_restore -U "$POSTGRES_USER" --clean --if-exists -d ledgerly' \
  < ../../backups/ledgerly/pre-investments-cutoff.dump
docker tag ledgerly:pre-investments-cutoff ledgerly:latest
docker tag ledgerly-cron:pre-investments-cutoff ledgerly-cron:latest
docker compose up -d --no-build ledgerly ledgerly-cron
```

Il dump è di prima della migrazione 0042: il restore riporta anche il journal delle migrazioni e lo stato
`estimated`, che è quello che l'immagine precedente legge. Dopo il restore: `curl -s
https://dash.longobardo.me/api/health` e la home di Investments.
