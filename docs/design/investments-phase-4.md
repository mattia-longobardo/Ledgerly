# Investments · fase 4: ccxt (Binance)

PERS-85, fase 4 del piano di `docs/design/investments.md` (§7), con le proposte dello spike
approvate il 28/10/2026 (D18, `investments-spike.md` B1–B7), che prevalgono sul testo precedente.
Kraken è escluso: Mattia non ha un conto Kraken (27/10/2026). Resta nel catalogo come `planned`,
senza adapter né pass.

## Cosa cambia

| Punto | Dove | Effetto |
|---|---|---|
| ccxt | `package.json` | `ccxt` `4.5.89` pinnato (release del 20/10/2026, più di 7 giorni prima), override `undici` `7.30.1` (§5.4, spike §4). In `serverExternalPackages` dalla fase 1, importato in modo dinamico solo dal client |
| Client | `src/platform/integrations/ccxt/client.ts` | Un'istanza `binance` per pass, opzioni costruite campo per campo: `apiKey`, `secret`, `enableRateLimit`, `timeout` 35 s, `verbose: false`, solo mercati spot (SEC-03). Gli errori ccxt diventano classi della allowlist (`auth`, `permission`, `rate_limited`, `timeout`, `unavailable`, `network`, `bad_response`), mai il messaggio, che contiene URL e firma (SEC-04) |
| Mapping | `src/platform/integrations/ccxt/binance.ts` | Allowlist dei flag (B1); saldi Spot, Funding, Simple Earn > 0 (B4, B6); wallet non letti con valore come prodotto `other:<wallet>` incompleto (B4); percorso di prezzo di §1.8 con coppia inversa `EUR/USDT` e mai USDT = USD (B5); polvere (B5); eventi con gambe e commissioni in asset per depositi, prelievi, SEPA, carta, Convert, reward e trade (B2) |
| Sorgente | `src/platform/integrations/ccxt/source.ts` | Finestre di 90 giorni (depositi, prelievi), 30 (Convert), 180 (reward); scoperta dei mercati da tutti gli stream e dai saldi (B3); trade per mercato a partire da `fromId` (B7); 24 mesi di storico (D11) con lacuna dichiarata `api_limit_24m`; cursore per stream con 24 h di sovrapposizione (A7) |
| Contratto | `src/platform/integrations/investments/source.ts` | `fetchFlows` riceve cursore, valuta del conto e cambi BCE e restituisce il cursore; una gamba può portare il proprio cambio (`fxRate`, `fxSource`); una posizione il suo prezzo con ora e percorso di cambio |
| Sync | `src/modules/investments/sync.ts` | Sorgente `ccxt:binance`; cursore salvato nella stessa transazione degli eventi (A7); apertura `inferred` per ogni coin all'inizio dello storico e controllo delle quantità a ogni pass (A6); i primi flussi dopo "Collega" e i flussi di "Sincronizza ora" girano dopo la risposta (`after`) |
| Catalogo | `src/modules/investments/catalog.ts` | Binance `available`, `readOnlyCheck = api`, prodotti `spot`, `funding`, `earn`, valute EUR e USD |
| UI | catalogo, pagina del servizio | Dialog con i passi per Binance e l'IP whitelist suggerita (D7); prodotti non letti di una lettura ("non letti: Cross margin"); stream e motivi nuovi della copertura; en/it |

Nessuna migrazione: le tabelle e i CHECK della `0038` bastano.

## Interpretazioni dove il design non decide

- **SEPA e carta in una sola richiesta.** `sapiGetFiatOrders` e `sapiGetFiatPayments` accettano 24 mesi
  in una sola chiamata (verificato con la chiave read-only di Ledgerly: 10 depositi, 6 prelievi, 5
  acquisti). Ogni chiamata dura circa 30 s, quindi niente finestre: un intervallo a pagine da 500.
- **Trade per id.** Ogni mercato si legge da `fromId = 0` (primo pass) o dall'ultimo id visto
  (incluso: è la sovrapposizione), a pagine da 1000; i trade più vecchi dei 24 mesi si scartano.
- **Contanti e coin.** Le valute fiat (EUR, USD, …) sono cassa: non hanno una posizione e la gamba
  `quote` di un trade in EUR non esiste (il `buy` toglie già la cassa). Ogni altra valuta, stablecoin
  comprese, è una posizione con quantità.
- **Valore delle gambe in coin.** Chiusura giornaliera (`fetchOHLCV` 1d) del mercato del giorno, con il
  percorso di §1.8: `X/K`, poi `X/USDT` o `X/USDC` e la stablecoin in `K` (o `USDT/USD` × BCE). La
  fonte resta sulla gamba (`exchange:BNB/EUR@2026-01-03`). Una coin senza mercato quel giorno tiene la
  quantità e importo 0 (`unpriced`). Il prezzo unitario in una stablecoin si salva convertito nella
  valuta del conto (il CHECK di `price_currency` ammette solo codici di 3 lettere).
- **Acquisto con carta.** Il denaro arriva dalla carta, non dal conto: gamba `quote` `deposit` in EUR,
  gamba `base` `buy` della coin, gamba `fee`.
- **Convert.** Valore dal lato fiat se c'è, altrimenti dalla coin ricevuta.
- **Apertura e controllo delle quantità (A6).** Al primo pass dei flussi, per ogni coin tenuta o mossa
  nei 24 mesi: apertura = quantità riportata oggi (somma dei prodotti) − flussi netti, `opening_position`
  `inferred` all'inizio dello storico, valorizzata alla chiusura di quel giorno. Un'apertura negativa
  non si scrive e la copertura dello stream `quantities` è `partial` (`negative_opening`). A ogni pass,
  apertura + Σ gambe contro la lettura, coin per coin: una differenza oltre la polvere è `partial`
  (`quantity_mismatch`). È qui che si vede un mercato non scoperto (`pair_not_discovered` del design).
- **Earn.** Il wallet Earn conta letto se ha posizioni Simple Earn; con valore > 0 e nessuna posizione
  leggibile il prodotto `earn` è incompleto. Un saldo spot `LD<X>` con una posizione flessibile di `X`
  non si conta due volte.
- **Polvere (B5).** Una coin senza mercato con quantità < 0,001 non rende la lettura `partial`; una
  posizione con prezzo vale i suoi centesimi (anche 0).
- **Pass.** Registrato per id (`ccxt:binance`), non per il prefisso `ccxt:`: un exchange senza adapter
  non ha un pass da chiamare.
- **Tempi.** Primo pass dei flussi circa 2 minuti (verificato in sola lettura: 589 eventi in 24 mesi),
  i successivi circa 1,5 minuti (le chiamate fiat). Il cron ha un limite di 600 s per tick; per non
  superare il timeout del proxy, "Collega" e "Sincronizza ora" rispondono con il valore e lasciano i
  flussi a `after()`, sotto lo stesso lock.

## Supply chain (§5.4)

- `npm ci` nel `Dockerfile`; `npm audit signatures`: tutte le firme verificate.
- `npm audit`: nessuna vulnerabilità da ccxt; restano le 4 `moderate` di `drizzle-kit` (dev, già
  presenti su `main`).
- Prossimo aggiornamento di ccxt: solo dopo 7 giorni dalla release e lettura del changelog; con la
  `4.5.90` (23/10/2026) la regola permette l'aggiornamento dal 30/10/2026.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-4` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-4`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-4.dump`.
3. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (`cron/` non cambia).

## Rollback

1. `docker tag ledgerly:pre-investments-4 ledgerly:latest`, poi `docker compose up -d --no-build`.
2. `docker exec -i postgres psql -U ledgerly ledgerly -v ON_ERROR_STOP=1 < docs/design/investments-phase-4-rollback.sql`:
   cancella la connessione Binance (credenziali, run, cursore, copertura) e rimette il servizio a
   `manual`. Nessuna migrazione da annullare.
3. Revocare la chiave su Binance (Gestione API).
4. Ultima risorsa: `pg_restore --clean --if-exists` da `backups/ledgerly/pre-investments-4.dump`.
