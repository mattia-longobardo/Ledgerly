# Investments · fase 2: motore, conti manuali e UI

PERS-83, fase 2 del piano di `docs/design/investments.md` (§7), in un solo deploy (A9). Il motore
completo della §2 (`V = P − C + M + R`, R1–R6, conversioni §2.5, stato a data, revisioni) scrive il
valore giornaliero di ogni servizio come `balance_entry` con fonte `portfolio`: patrimonio netto,
Overview, snapshot, MCP e `/api/v1` lo leggono senza modifiche. Le due piattaforme legacy diventano
conti; le tabelle legacy restano in sola lettura fino al drop (≥ 30 giorni dopo il deploy).

## Cosa cambia

| Punto | Dove | Effetto |
|---|---|---|
| Motore puro (§2) | `src/modules/investments/rules.ts` | `valueOn` (manuale `assets`/`total`, sincronizzato `P − C + M + R`), `holdingStates` (quantità, ultimo prezzo, costo medio, effetto cambio), `computePoints`/`pointDays` (§1.7), `flowsOn`/`performance` (§2.4), `emptyReadingStatus` (R5), `openingCashFor` (§2.5). Decimali in `bigint` a punto fisso: quantità 10⁻¹⁸, prezzi 10⁻¹², cambi 10⁻¹⁰ |
| Servizio | `src/modules/investments/service.ts` | Ogni scrittura in una transazione con lock sulla riga del servizio: dati + riscrittura dei punti `portfolio` dal giorno più vecchio toccato (`replacePortfolioPoints`). Conto manuale nuovo o passaggio di autorità (§1.3), asset (§4.4), operazioni, modifica/cancellazione con revisioni (A2), conversioni di modo (§2.5), letture (`saveReading`, per le fasi 3–4), conferma dello zero (R5), riconciliazione (R4) |
| Catalogo | `src/modules/investments/catalog.ts` | Statico (D12). In fase 2 solo il conto manuale è `available`; eToro, Interactive Brokers, Degiro, Trade Republic, Scalable e gli exchange ccxt sono `planned` |
| Accounts | `accounts/service.ts` | `managed_locked`: nessuna entry manuale (crea, modifica, cancella) dal `managed_since` di un servizio; il tipo resta `investment`/`crypto`. `createAccount` accetta la transazione del chiamante. `replacePortfolioPoints` e `takeOverEntries` sono gli unici punti in cui Investments tocca `balance_entries` |
| Fondi | `funds/queries.ts` | Un servizio non è proponibile come conto di valutazione di un fondo, e un conto di valutazione non può diventare un servizio |
| Export | `platform/export/service.ts` | `investment-services` e `investment-operations` dalle tabelle nuove al posto di `investment-platforms`/`investment-movements` |
| UI | `/investments`, `/investments/catalog`, `/investments/[accountId]` | Home, catalogo e pagina del servizio della §4; la pagina legacy è rimossa |

## Migrazione `0037_investments_v2`

1. **Tabelle** (§1.3–1.6, additive): `investment_accounts`, `investment_account_periods`,
   `investment_assets`, `investment_holdings`, `investment_events` (`seq` identity per l'ordine
   intragiornaliero), `investment_operations` (CHECK del segno per tipo), `investment_operation_revisions`,
   `investment_readings`, `investment_reading_positions`, `investment_reading_scopes`,
   `investment_reconciliations`, `investment_superseded_entries`. `investment_key_checks` e
   `investment_sync_coverage` arrivano con la `0038` (fase 3).
2. **Dati** (D4, mappatura confermata nello spike):
   - ogni piattaforma legacy diventa un conto nuovo in EUR (Binance → `crypto`, eToro → `investment`),
     modo `total`, periodo dal primo movimento; i movimenti diventano eventi `deposit`/`withdrawal`
     (stesso id, `transaction_id` e nota conservati), le valutazioni `account_valuation` ordinate a
     fine giornata;
   - ogni conto manuale `investment`/`crypto` che non è conto di valutazione di un fondo passa a
     Investments con il passaggio di autorità al giorno del deploy: il saldo di quel giorno apre il
     periodo, le entry `manual`/`import`/`provider` da quel giorno sono archiviate e rimosse. In
     produzione nessun conto è in questo caso (Fideuram e Cometa restano in `funds`);
   - i punti `portfolio` calcolati in SQL con la stessa regola del motore (test `migration.itest.ts`:
     una ricostruzione non cambia nessun punto). Oggi Binance ed eToro valgono 0 dal 23/09/2026:
     il patrimonio netto non cambia.
3. **Sola lettura**: trigger `BEFORE INSERT OR UPDATE OR DELETE … FOR EACH ROW` sulle tre tabelle
   legacy (`investments_legacy_read_only`, errore `read_only_sql_transaction`). Un `TRUNCATE` e una
   cascata che non cancella righe non sono bloccati.

## Interpretazioni dove il design non decide

- **Modo `total` prima della prima valutazione**: valore ignoto (nessun punto) se sono entrati soldi,
  0 se non è successo niente, mai sotto zero: la regola del `valueOn` legacy che la §2.1 cita.
- **Posizioni per controvalore** (BTP, fondi senza quantità): ultima `valuation` + acquisti − vendite
  successivi. Con un solo acquisto coincide con la §2.1 ("vale l'importo del buy").
- **Confine di periodo dentro un giorno**: colonna `starts_at` in `investment_account_periods`. Gli
  eventi dello stesso giorno ordinati prima della conversione appartengono al periodo precedente,
  così l'invariante V(T) prima = V(T) dopo regge anche con operazioni nel giorno T.
- **`legacy_platform_id`** in `investment_accounts`: lega il conto alla piattaforma per il rollback.
- **Passaggio di autorità**: T = giorno della scelta (o del deploy); il saldo di T apre il periodo
  (`account_valuation` in modo `total`, `opening_cash` in modo `assets`) ed è il valore iniziale nei
  flussi del rendimento. Accounts controlla `investment_accounts` (`investments/managed.ts`) e
  risponde `managed_locked`.
- **Rettifiche**: il motore le applica in ogni modo; la UI le propone solo sui conti sincronizzati
  (§4.3), quindi in produzione compaiono dalla fase 3.
- **Catalogo asset**: il seed (crypto principali, ETF comuni) viene scritto per l'utente al primo uso.
- **Kraken** è nel catalogo come `planned` (Mattia non ha un conto: fuori dalla fase 4).
- **R5 parziale per prodotto** ("per i prodotti non letti vale l'ultima lettura completa"): è compito
  degli adapter delle fasi 3–4, che salvano in `total_cents` il totale già composto; il motore usa
  `total_cents` della lettura.
- **Grafico della home**: il versato è convertito nella valuta di visualizzazione al cambio di fine
  mese; la conversione al cambio del giorno del flusso serve al rendimento di portafoglio (fase 5).
- XIRR e trasferimenti interni restano alla fase 5; la pagina mostra valore, versato, guadagno e
  rendimento semplice.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-2` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-2`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-2.dump`.
3. `docker compose build ledgerly ledgerly-cron && docker compose up -d --wait ledgerly ledgerly-cron`
   (la migrazione parte dall'entrypoint).

## Rollback

1. `docker tag ledgerly:pre-investments-2 ledgerly:latest` e
   `docker tag ledgerly-cron:pre-investments-2 ledgerly-cron:latest`, poi `docker compose up -d --no-build`.
2. SQL inverso, in una sola transazione:
   `docker exec -i postgres psql -U ledgerly ledgerly -v ON_ERROR_STOP=1 < docs/design/investments-phase-2-rollback.sql`.
   Toglie i trigger; rifà movimenti e valutazioni legacy dagli eventi correnti (anche quelli scritti
   dopo il deploy; un servizio nuovo con depositi, prelievi o valutazioni diventa una piattaforma);
   rimette in `balance_entries` le entry archiviate; cancella i punti `portfolio`; archivia i conti
   creati per le piattaforme legacy; toglie la riga di 0037 dal journal. Le tabelle nuove restano e
   conservano asset, letture e rettifiche, che il modello vecchio non rappresenta. Validato su una
   copia del DB di produzione.
3. Prima di un nuovo deploy della fase 2 dopo un rollback: eliminare le tabelle nuove (`DROP TABLE
   investment_… CASCADE`, dopo un dump) oppure ripristinare il dump, altrimenti la `0037` fallisce.
4. Ultima risorsa: `pg_restore --clean --if-exists` da `backups/ledgerly/pre-investments-2.dump`.

## Dopo il deploy

Deploy eseguito il **28/10/2026** (0037 applicata; Binance ed eToro migrati come conti `crypto` e
`investment` in modo `total`, valore 0 € dal 23/09/2026; nessun conto esistente passato di mano).

Il drop delle tabelle legacy (`0039_drop_legacy_investments`) è un'issue separata, da fare non prima
del **27/11/2026** (30 giorni dopo il deploy), dopo un dump.
