# Investments · fase 3: eToro

PERS-84, fase 3 del piano di `docs/design/investments.md` (§7), con le proposte dello spike
approvate il 28/10/2026 (D17, `investments-spike.md` E1–E9), che prevalgono sul testo precedente.

## Cosa cambia

| Punto | Dove | Effetto |
|---|---|---|
| Contratto delle sorgenti (§3.1) | `src/platform/integrations/investments/source.ts` | `InvestmentSource` (`verifyReadOnly`, `fetchHoldings`, `fetchFlows`, `fetchHistory`), `SourceError` con classe e status, `sourceErrorText` a allowlist (§5.1): si salva e si stampa solo `<provider> · <classe> · <status>` |
| Client eToro | `src/platform/integrations/etoro/client.ts` | Host fisso `public-api.etoro.com`, solo `GET` real, header `x-api-key`/`x-user-key`/`x-request-id`, `redirect: error`, timeout 20 s, risposte validate con zod; 401 → `auth`, 403 → `permission`, 429 → `rate_limited` con `Retry-After`/`ratelimit-reset`, 5xx → `unavailable`, `UNSUPPORTED_DISPLAY_CURRENCY` → `unsupported_currency` (E8, E9) |
| Mapping | `src/platform/integrations/etoro/mapping.ts` | Scope `:read` → `read-only`, ogni altro suffisso → `write` (E1); un conto esterno per `gcid`, prodotti `trading`/`cash`/`crypto`/`copy`, gli altri `other:<tipo>` con `complete = false` (E2, E3, E6); conto vuoto con `includeZeroBalances=true` (E7); trade completi a pagine (E4); depositi da eToro Money (E5); storico 360 giorni (D11) |
| Sync | `src/modules/investments/sync.ts` | `connectInvestmentProvider` (unico punto che salva una chiave, SEC-05), il pass del dispatcher con lock `investments-sync:<id>`, esiti separati `holdings`/`flows` (A8), backoff su 429, `revoked` su 401/403, "Sincronizza ora" e "Verifica" con cooldown di 60 s, sostituzione e revoca guidata della chiave (§5.3), disconnessione = conversione sincronizzato → manuale (§2.5) |
| Registro | `src/platform/integrations/registry.ts` | Pass `etoro` → `runInvestmentPass` |
| Catalogo | `src/modules/investments/catalog.ts` | eToro `available`, `readOnlyCheck = api`, valute EUR/USD/GBP/CHF; schema strict delle credenziali (SEC-03) |
| UI | catalogo, pagina del servizio, Settings › Integrazioni | Dialog "Collega" con passi, campi write-only e conto di destinazione; card "Connessione" (stato, ultima verifica, chiave, copertura, Sincronizza ora, Verifica, Sostituisci chiave, Scollega, revoca); posizioni dalla lettura; guadagno nascosto finché i flussi non sono coperti (§2.4) |

## Migrazione `0038_investment_sync`

Additiva: `holdings` e `flows` in `SYNC_KINDS` (CHECK di `sync_jobs` e `sync_runs`); `investment_event` e
`investment_holding` in `ENTITY_TYPES` (CHECK di `provider_links`); prodotti `trading`, `cash`,
`crypto`, `copy` nei CHECK di `investment_holdings`, `investment_reading_positions`,
`investment_reading_scopes`; tabelle `investment_key_checks` e `investment_sync_coverage`. Nessuna riga
esistente cambia.

## Interpretazioni dove il design non decide

- **Valore di una posizione**: `amount + unrealizedPnL.pnL` in USD × `exchangeRate` del conto Trading di
  `/balances` (cambio di eToro, fonte `etoro`). Per questo il pass legge `/trading/info/real/pnl`
  (stesso `clientPortfolio` di `/portfolio`, con il P/L). Il totale P resta `totalBalance` (R1).
- **Nomi degli strumenti**: `/market-data/instruments`, non verificato nello spike. Se fallisce
  (schema, 5xx) l'asset si chiama `eToro <id>` e la lettura è `partial`; un 401/429 ferma il pass.
- **Trade chiusi**: due eventi per trade, `buy` all'apertura (unità, `openRate`, investito) e `close`
  alla chiusura (`closeRate`, investito + `netProfit`, che eToro dà già al netto delle commissioni:
  nessuna gamba `fee`, per non contarle due volte). Uno short ha la stessa forma con la nota "short".
  Copy trade (`parentPositionId`/`socialTradeId`) nel prodotto `copy`. Gli importi in USD sono
  convertiti nella valuta del conto al cambio BCE del giorno; se `fx_rates` parte dopo il primo
  trade, il pass scarica una volta da Frankfurter i giorni mancanti (righe immutabili).
- **Storico dei trade**: `minDate = 2020-01-01`, il valore verificato nello spike; copertura
  `complete` da quella data.
- **Depositi**: solo i movimenti `settled` di eToro Money; i trasferimenti con "eToro Trading
  Platform DPT/WDL" sono interni al perimetro e non diventano eventi.
- **Collegamento a un conto esistente**: un conto manuale `investment` nessun altro scrive (passaggio
  di autorità a oggi, §1.3) oppure un servizio manuale, come il conto eToro legacy della fase 2:
  il periodo sincronizzato parte dal più recente tra l'inizio dell'ultimo periodo e il primo giorno
  dello storico. Un conto nuovo parte dal primo giorno dello storico.
- **Una lettura al giorno** (D10): l'ultima del giorno sostituisce le precedenti. Una lettura vuota
  `pending_zero` sostituisce quella del mattino, quindi P resta l'ultima lettura che conta di un
  giorno precedente.
- **Stato della chiave**: `investment_key_checks` ha in più `provider`, `origin` (connect, replace,
  pass, verify) e `retired_at` (chiave sostituita, scollegata o rifiutata), su cui si basa la richiesta
  di revoca (SEC-07) anche dopo la disconnessione. La conferma "solo lettura" non serve per eToro (E1):
  `attested_read_only_at` resta vuoto.
- **Backoff**: in `sync_jobs.cursor.backoff_until` della riga `holdings`; finché non scade il pass
  registra due run `skipped` e risponde `refused`, senza chiamate.
- **Schedule**: 07:30 e 22:30 dal collegamento (§3.1); il primo pass dei flussi parte subito.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-3` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-3`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-3.dump`.
3. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (la migrazione parte
   dall'entrypoint; `cron/` non cambia).

## Rollback

1. `docker tag ledgerly:pre-investments-3 ledgerly:latest` (e `ledgerly-cron:pre-investments-3` se
   ricostruita), poi `docker compose up -d --no-build`.
2. `docker exec -i postgres psql -U ledgerly ledgerly -v ON_ERROR_STOP=1 < docs/design/investments-phase-3-rollback.sql`:
   cancella la connessione eToro (credenziali, run, copertura) e rimette il servizio a `manual`. Le
   tabelle e i CHECK della `0038` restano (additivi, ignorati dall'immagine della fase 2), e la riga
   del journal resta: un nuovo deploy della fase 3 non riapplica la migrazione.
3. Revocare la chiave su eToro.
4. Ultima risorsa: `pg_restore --clean --if-exists` da `backups/ledgerly/pre-investments-3.dump`.
