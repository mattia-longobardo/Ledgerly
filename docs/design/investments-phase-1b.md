# Investments · fase 1b: valuta di visualizzazione

PERS-82, fase 1b del piano di `docs/design/investments.md` (§7), decisione D1. È una fase di
Accounts F1: ogni conto tiene i saldi nella sua valuta; ogni totale su più conti è mostrato nella
valuta di visualizzazione scelta in Settings → Profilo (default EUR), al cambio BCE del giorno
(`fx_rates`, fase 1). Nessun saldo viene convertito o riscritto.

## Cosa cambia

| Punto | Dove | Effetto |
|---|---|---|
| Conversione pura (§1.8) | `src/platform/fx/rules.ts` (`convertCents`, `eurPerUnitOn`, `rateTable`) | `cents × eur_per_unit(from) / eur_per_unit(to)`, ultimo fixing ≤ giorno, arrotondamento al centesimo metà lontano da zero, in `bigint`. Stessa valuta: nessun cambio. Cambio mancante: `null`, mai 1:1 |
| Lettura dei cambi | `src/platform/fx/service.ts` (`ratesOn`) | I cambi della finestra più l'ultimo prima del suo inizio. Con tutti i conti nella valuta di visualizzazione non fa nessuna query |
| Valute ammesse | `fx/rules.ts` (`ECB_CURRENCIES`, `DISPLAY_CURRENCIES`) | EUR + le 29 valute BCE pubblicate oggi (BGN esclusa: non ha più fixing dal 2026) |
| Preferenza | `users/rules.ts`, `users/service.ts`, `Ctx.displayCurrency` | Letta con le altre preferenze e portata dal `Ctx` di pagine, API, MCP e job |
| Totali | `accounts/queries.ts` (`accountsView`) | Ogni conto convertito al cambio del giorno del punto (fine mese = ultimo giorno del mese, oggi = oggi), poi sommato: patrimonio netto, serie, bucket, totale precedente. Campi nuovi `currency`, `missingRates`, e per riga `display` e `missingRate`. I campi nativi (`balance`, `series`, `held`) restano nella valuta del conto |
| Snapshot | `accounts/service.ts` (`runSnapshot`) | Le righe `system` restano nella valuta del conto; il totale è nella valuta di visualizzazione e salva `total_currency` |
| Report e API | `reports/monthly.ts`, `api/summary.ts`, `mcp/tools.ts` | Campo nuovo `currency`: vedi `docs/api-changelog.md` |
| Formattazione | `src/platform/format.ts` (`formatMoney(…, { currency })`) | Simbolo della valuta dalla locale al posto di `€` fisso; senza `currency` resta EUR, quindi ogni importo che non ha una valuta propria non cambia |
| UI | home, Accounts, dettaglio conto, grafico del patrimonio, Settings → Dati | Totali nella valuta di visualizzazione; ogni conto nella sua valuta con il controvalore (`≈ …`) sotto quando le valute sono diverse; avviso quando manca un cambio |
| Valuta del conto | `accounts/service.ts` (`updateAccountSettings`) | Con almeno una entry la valuta non cambia più: `currency_locked` |

Migrazione `0036_display_currency`: `user_preferences.display_currency` e
`snapshot_runs.total_currency`, entrambe `text not null default 'EUR'` con CHECK `^[A-Z]{3}$`. Solo
colonne con default: nessuna riga riscritta, e l'immagine precedente le ignora.

Con tutti i conti in EUR e valuta EUR nessun numero cambia: lo verifica il test golden in
`src/modules/accounts/currency.itest.ts`.

Fuori perimetro: le entrate e le uscite del mese (`income`, `expense`, `net` del summary e del report)
restano somme dei movimenti senza conversione, come prima. Le pagine Investments (legacy), Fondi,
Pocket e Abbonamenti restano in EUR: i loro importi non hanno una valuta propria.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-1b` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-1b`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-1b.dump`.
3. `docker compose build ledgerly ledgerly-cron && docker compose up -d --wait ledgerly ledgerly-cron`
   (la migrazione parte dall'entrypoint).

## Rollback

1. `docker tag ledgerly:pre-investments-1b ledgerly:latest` e
   `docker tag ledgerly-cron:pre-investments-1b ledgerly-cron:latest`, poi `docker compose up -d --no-build`.
2. SQL inverso (le due colonne contengono solo la preferenza e la valuta degli snapshot, nessun
   saldo). `fx_rates` resta: è della fase 1.

   ```sql
   ALTER TABLE user_preferences DROP COLUMN display_currency;
   ALTER TABLE snapshot_runs DROP COLUMN total_currency;
   DELETE FROM drizzle.__drizzle_migrations
     WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations); -- la riga di 0036
   ```

   Il passo 2 è facoltativo: l'immagine precedente funziona anche con le colonne presenti. Va fatto
   prima di un nuovo deploy della fase 1b, altrimenti la migrazione non viene riapplicata.
3. Se nel frattempo esistono conti non EUR, dopo il rollback i totali tornano alla somma senza
   conversione di Accounts F1.
4. Ultima risorsa: `pg_restore --clean --if-exists` da `backups/ledgerly/pre-investments-1b.dump`.
