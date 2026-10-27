# Investments · fase 1: fondamenta

PERS-80, fase 1 del piano di `docs/design/investments.md` (§7). Nessuna funzione nuova per chi usa
l'app: questa fase prepara il terreno per le fasi 1b e 2.

## Cosa cambia

| Punto | Dove | Effetto |
|---|---|---|
| Registro dei pass (§3.1) | `src/platform/integrations/registry.ts`, `jobs.ts` | `passFor(provider)` sostituisce l'`if/else` del dispatcher. Corrispondenza esatta, poi il prefisso più lungo che finisce con `:` (`ccxt:`). Wallet, Trek e Paperless si comportano come prima: `integrations/jobs.itest.ts` non è cambiato |
| Fonte `portfolio` (§1.7) | `accounts/rules.ts` (`BALANCE_SOURCES`, `SOURCE_PRECEDENCE`), `accounts/queries.ts` (`SOURCE_RANK`) | Ordine manual > import > **portfolio** > provider > system > derived. `SOURCE_RANK` si costruisce da `SOURCE_PRECEDENCE`. Nessuna riga `portfolio` esiste ancora |
| Filtro di `rebuildDerivedBalances` (§1.7, V3) | `accounts/service.ts`, `integrations/rules.ts` (`syncsTransactions`) | Ricostruisce solo i conti sincronizzati di un provider con il kind `transactions` in `KINDS_OF` (oggi solo Wallet) |
| `fx_rates` (§1.8) | `src/platform/fx/` | Cambi BCE contro EUR, righe immutabili (`on conflict do nothing`) |
| Job `fx-rates-refresh` | `fx/jobs.ts`, tier `daily` (12:00) | Primo run: backfill dal primo `balance_entries.on` dell'istanza. Run successivi: solo i giorni dopo l'ultimo salvato e, se compare un saldo più vecchio, i giorni prima del primo salvato. Senza saldi non chiama Frankfurter |
| `serverExternalPackages: ["ccxt"]` (§3.2) | `next.config.ts` | Pronto per la fase 4; nessun pacchetto nuovo |

Migrazione `0035_portfolio_source_fx`: tabella `fx_rates`, CHECK `balance_entries_source_ck` con
`portfolio`. Solo additiva: l'immagine precedente ignora la tabella e non scrive `portfolio`.

Fonte dei cambi: `GET https://api.frankfurter.dev/v1/<from>..<to>?base=EUR`. La risposta è "1 EUR =
`rate` unità"; `eur_per_unit = 1 / rate` a 10 decimali. Frankfurter apre la serie con l'ultimo fixing
≤ `from`, quindi anche un primo saldo di domenica ha il suo cambio.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-1` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-1`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-1.dump`.
3. `docker compose build ledgerly ledgerly-cron && docker compose up -d --wait ledgerly ledgerly-cron`
   (la migrazione parte dall'entrypoint).
4. Backfill subito, senza aspettare le 12:00: come admin, `Settings → Integrations → Scheduled jobs →
   fx-rates-refresh → Run now`. Non usare il tick `daily` a mano: rilancia tutto il tier (backup,
   avvisi).

## Rollback

1. `docker tag ledgerly:pre-investments-1 ledgerly:latest` e
   `docker tag ledgerly-cron:pre-investments-1 ledgerly-cron:latest`, poi `docker compose up -d --no-build`.
2. SQL inverso (nessuna riga `portfolio` esiste in questa fase):

   ```sql
   DROP TABLE fx_rates;
   ALTER TABLE balance_entries DROP CONSTRAINT balance_entries_source_ck;
   ALTER TABLE balance_entries ADD CONSTRAINT balance_entries_source_ck
     CHECK (source in ('manual', 'provider', 'system', 'import', 'derived'));
   DELETE FROM drizzle.__drizzle_migrations
     WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations); -- la riga di 0035
   ```

   Il passo 2 è facoltativo: l'immagine precedente funziona anche con `fx_rates` presente. Va fatto
   prima di un nuovo deploy della fase 1, altrimenti la migrazione non viene riapplicata.
3. Ultima risorsa: `pg_restore --clean --if-exists` da `backups/ledgerly/pre-investments-1.dump`.
