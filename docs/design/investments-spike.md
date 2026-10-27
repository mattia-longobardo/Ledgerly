# Investments: esito dello spike provider (fase 0)

PERS-81 (27/10/2026), fase 0 di `docs/design/investments.md` (§7). Input per le fasi 3 (eToro) e 4
(ccxt). Le proposte di questo documento **non cambiano il design**: vanno approvate e poi riportate in
`investments.md` prima di scrivere il codice della fase.

Metodo: script usa e getta fuori dal repo, chiavi read-only reali di Ledgerly, solo chiamate `GET` (eToro)
e metodi di lettura (ccxt `4.5.89` con override `undici` `7.30.1`). Nessuna chiamata di scrittura, nemmeno
"validate-only". Kraken è escluso: Mattia non ha un conto Kraken, quindi per Kraken ci sono solo le
verifiche pubbliche (sezione 4).

Fixture anonimizzate in `test/fixtures/investments/{etoro,binance}/`: id sostituiti con valori finti
coerenti (`fixture-id-NNNN`, `9000NN`, UUID `00000000-…`), importi e quantità moltiplicati per un fattore
fisso, nomi, IBAN, indirizzi, tag e txid rimossi. I prezzi di mercato e le date restano reali. Ogni file
ha `request` (o `method`), `status` e `body`.

## 1. Esiti

| Verifica | eToro | Binance | Kraken |
|---|---|---|---|
| Endpoint e flag dei permessi (§5.2) | **Verificabile**: `GET /api/v1/me` → `scopes[]`, 16 scope tutti `:read` | `sapiGetAccountApiRestrictions` esiste: `enableReading = true`, tutti gli altri flag `false`, 4 flag nuovi | escluso (`unverifiable` confermato lato ccxt) |
| Perimetro e prodotti | 3 tipi di conto: `Trading` (USD), `Cash` (eToro Money, EUR), `Crypto` (un conto per coin) | `sapiGetAssetWalletBalance`: 10 wallet con valore in BTC; Earn flessibile e bloccato leggibili | escluso |
| Risposta a conto vuoto | 200, `totalBalance: 0`; senza `includeZeroBalances` → `balances: []` | conto con polvere (BNB, TRX spot; ETHW funding); Earn `{ total: 0, rows: [] }` | escluso |
| Paginazione | trade: `page`/`pageSize` ≤ 500, **nessun limite di 1 anno**; storico saldi: 365 giorni e retention 12 mesi; cash: cursore `pageToken` | depositi/prelievi a finestre di 90 gg; trade `limit` 1000 + `fromId`; dividend ≤ 180 gg; convert ≤ 30 gg | escluso |
| Prezzi mancanti | non verificabile: nessuna posizione aperta | `USDT/EUR` non esiste (solo `EUR/USDT`); ETHW senza mercato; ticker con timestamp | ticker senza timestamp (pubblico) |
| Identità dei conti esterni | `gcid` (utente), `realCid` = `accountId` del Trading; id del Cash diverso tra `/balances` e `/balances/history` | `uid` da `GET /api/v3/account` | escluso |
| Valori di `displayCurrency` | EUR, USD, GBP, CHF accettati (anche minuscoli); `XYZ` → 400 `UNSUPPORTED_DISPLAY_CURRENCY` | — | — |
| Import per singolo exchange ccxt | — | non permesso da `exports` (run senza chiavi): import completo | idem |
| Mappatura D4 | conto eToro legacy in EUR: `displayCurrency=EUR` accettato | conto Binance nuovo, tipo `crypto` | — |

D4 confermata (lettura del DB in sola lettura, run precedente): Fideuram e Cometa restano in `funds`;
le piattaforme legacy Binance ed eToro diventano conti nuovi; nessun abbinamento ambiguo.

## 2. eToro: differenze dal design e proposte (fase 3)

**E1. Permessi verificabili (§5.2, §3.3).** `GET /api/v1/me` restituisce gli scope OAuth della chiave.
La chiave di Ledgerly ha solo scope `etoro-public:*:read`. L'OpenAPI di eToro elenca anche scope
`*:write` (`trade.real:write`, `real:write`, `money.transfer:write`, …) e `etoro-public:money:transfer`.
*Proposta:* eToro passa da `unverifiable` a `readOnlyCheck = api`. Allowlist: accettata solo se ogni
scope finisce con `:read`; uno scope `:write` → `write`; ogni altro suffisso → `unknown-flag`. Verifica a
ogni pass come per Binance. La conferma "solo lettura" del dialog non serve più per eToro. Limite: la
forma degli scope di una chiave con scrittura non è verificata con una chiamata reale (la chiave di Pluto
non si usa); va confermata da Mattia con una chiave Write di prova, oppure la fase 3 tratta come `write`
tutto ciò che non è `:read`, che è già sicuro.

**E2. Perimetro con più conti (§3.3).** Il design prevede un conto esterno con prodotto `custody`.
`/api/v1/balances?includeZeroBalances=true` restituisce un conto `Trading` (USD), un conto `Cash`
(eToro Money, EUR) e un conto `Crypto` per ogni coin (BTC, LTC, BCH, XLM). L'API dichiara anche
`Options`, `MoneyFarm`, `Spaceship`, `Plaee`. *Proposta:* un conto esterno per utente (`gcid`), prodotti
per `accountType`: `trading`, `cash`, `crypto`; i tipi che l'adapter non legge in dettaglio entrano nel
totale ma con perimetro `complete = false`.

**E3. Copy trading.** 402 dei 466 trade chiusi sono copy trade (`socialTradeId`, `parentPositionId`) e il
portfolio ha `mirrors[]`. Il design non li cita. *Proposta:* posizioni dei mirror lette da `mirrors[]`
come prodotto `copy`; i trade figli entrano nello storico come trade normali.

**E4. Storico dei trade completo.** `trade/history` con `minDate=2020-01-01` restituisce tutti i 466 trade
dal 2021, in pagine fino a 500. `minDate` è obbligatorio (400); una pagina oltre la fine dà `[]`.
*Proposta:* niente finestre < 1 anno e niente `api_limit_12m` sullo stream `trades`: paginazione per
`page` fino a una pagina vuota o più corta di `pageSize`. Il limite di 12 mesi resta per lo storico dei
saldi: `balances/history` rifiuta più di 365 giorni (`DATE_RANGE_TOO_LARGE`) e un `fromDate` oltre 12 mesi
(`DATE_RANGE_OUTSIDE_RETENTION`); gli snapshot sono giornalieri fino a ieri.

**E5. Depositi e prelievi in parte esposti.** Il design dice che l'API non li espone.
`GET /api/v1/money/accounts/cash/{accountId}/transactions` (scope `money.cash-transactions:read`, già
nella chiave) restituisce i movimenti del conto eToro Money: bonifici in entrata e in uscita e
trasferimenti con la piattaforma di trading (`counterparty.name` = `eToro Trading Platform DPT`/`WDL`).
Paginazione a cursore (`pageSize` ≤ 500, `nextPageToken`, `hasNext`). Copre solo i movimenti passati da
eToro Money (qui dal 06/2026); i depositi fatti direttamente sul conto Trading non ci sono.
*Proposta:* stream `deposits` da questa fonte (eventi `deposit`/`withdrawal` per i bonifici, trasferimenti
interni tra prodotti `cash` e `trading`), con copertura `partial` prima del primo movimento.

**E6. Identità dei conti.** `accountId` del Trading = `realCid`. Il conto Cash ha un UUID in `/balances` e
un id numerico diverso in `/balances/history`. *Proposta:* chiave esterna = `gcid`, prodotto = `accountType`;
mai l'`accountId` come chiave stabile tra endpoint.

**E7. Conto vuoto.** Con `includeZeroBalances=false` un conto vuoto e un conto senza conti attivi danno
la stessa risposta (`balances: []`). *Proposta:* chiamare sempre con `includeZeroBalances=true`; lettura
`confirmed_zero` quando tutti i conti elencati hanno `balance = 0` e `portfolio` è vuoto.

**E8. Valuta.** `displayCurrency` accetta EUR, USD, GBP, CHF; un codice sconosciuto dà 400 con codice
`UNSUPPORTED_DISPLAY_CURRENCY`, da mappare su un errore fisso (§5.1). Il conto eToro legacy della fase 2
può essere in EUR (D4, proposta del run precedente): eToro restituisce il totale in EUR senza conversioni
lato Ledgerly.

**E9. Endpoint instabili.** `GET /api/v1/data/positions/closed-events/history` ha risposto 503 dopo 15 s
(`DEPENDENCY_UNAVAILABLE`); `/api/v1/sub-accounts/me/accounts` dà 403 con una chiave Read. L'adapter non
li usa. Le risposte hanno gli header `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`: usarli
per il backoff (SEC-09).

## 3. Binance: differenze dal design e proposte (fase 4)

**B1. Flag dei permessi.** Oltre ai flag del design, la risposta ha `enableVanillaOptions`,
`enablePortfolioMarginTrading`, `enableFixApiTrade`, `enableFixReadOnly` (tutti `false`), più
`ipRestrict` e `createTime`. `enableFixReadOnly` è un permesso di lettura. *Proposta:* allowlist esplicita:
`enableReading` e `enableFixReadOnly` possono essere `true`; i 9 flag di trading, prelievo e trasferimento
noti devono essere `false`; un flag `enable*`/`permits*` sconosciuto con valore `true` → `unknown-flag`, con
valore `false` → accettato e registrato nel log. Attenzione: `canTrade`/`canWithdraw` di `GET /api/v3/account`
sono capacità del conto e valgono `true` anche con una chiave read-only: non usarli.

**B2. Flussi mancanti.** `fetchDeposits`/`fetchWithdrawals` danno solo i movimenti crypto. Nel conto reale
mancano, e senza di loro la conservazione delle quantità (A6) fallisce:

| Stream | Fonte | Dati reali | Finestra |
|---|---|---|---|
| depositi e prelievi fiat (SEPA) | `sapiGetFiatOrders` `transactionType` 0/1 | 3 depositi, 1 prelievo EUR (12 mesi) | lenta: ~30 s per chiamata |
| acquisti con carta | `sapiGetFiatPayments` `transactionType` 0 | 1 acquisto ETH, poi prelevato (12 mesi) | lenta: ~30 s |
| Convert | `sapiGetConvertTradeFlow` | 11 conversioni in 24 mesi (es. `SUI→USDC`, `BNB→EUR`) | ≤ 30 giorni |
| reward, staking, airdrop | `sapiGetAssetAssetDividend` | 485 righe in 30 mesi (`Soft Lock Rewards`, `Flexible`, `BNB Vault`, `Launchpool`, `HODLer Airdrops`) | ≤ 180 giorni (`-1108`) |

*Proposta:* stream `fiat_orders`, `fiat_payments`, `convert`, `dividends` oltre a `deposits`, `withdrawals`,
`trades:<simbolo>`. Mappatura: fiat order → `deposit`/`withdrawal` in EUR; fiat payment → `buy` con gamba
`quote` in EUR; convert → evento come un trade (`buy` + `sell`); dividend → `income`. `timeout` ccxt ≥ 35 s
per le chiamate fiat.

**B3. Scoperta delle coppie.** Gli asset di depositi, prelievi e saldi non bastano: ADA ha 4 trade
`ADA/EUR` e compare solo nei dividend; TON, DOGS, ROBO, OPN, SXT solo nei dividend. *Proposta:* la scoperta
usa gli asset di tutti gli stream (compresi dividend, convert, fiat payment). Resta la lacuna dichiarata
`pair_not_discovered` per i mercati senza altre tracce.

**B4. Perimetro.** `sapiGetAssetWalletBalance` restituisce il valore in BTC di ogni wallet (Spot, Funding,
Cross e Isolated Margin, Futures USDⓈ-M e COIN-M, Earn, Options, Trading Bots, Copy Trading).
*Proposta:* l'adapter legge Spot, Funding ed Earn (`sapiGetSimpleEarnFlexiblePosition`,
`sapiGetSimpleEarnLockedPosition`, entrambi leggibili con la chiave); se un wallet non letto ha valore
> 0, la lettura è `partial` e la pagina dice quale wallet manca. Earn può entrare nel perimetro già in
fase 4 (oggi R4 lo lascia fuori).

**B5. Prezzi.** Confermato: `USDT/EUR` manca, esiste `EUR/USDT` (proposta del run precedente: coppia
inversa al passo 3 di §1.8). `ETHW` non ha mercato: `value_cents = null` e lettura `partial` per una
quantità di polvere. *Proposta:* sotto una soglia di valore stimato (es. 1 centesimo con l'ultimo prezzo
noto, o asset senza alcun mercato e quantità < 0,001) la posizione resta visibile ma non rende la lettura
`partial`. I ticker Binance hanno `timestamp`.

**B6. Conto vuoto.** `fetchBalance()` riempie `free`/`used`/`total` con tutte le valute a 0: il mapping
filtra le quantità > 0. Con sola polvere la lettura non è `confirmed_zero`.

**B7. Paginazione e identità.** Depositi e prelievi a finestre di 90 giorni funzionano anche oltre 24 mesi
(primo deposito del 09/2024); senza `since` `fetchDeposits` legge solo gli ultimi 90 giorni. `fetchMyTrades`
accetta `since`, `limit` 1000 e `fromId` per paginare. `fetchLedger` su spot dà `NotSupported` (confermato).
Id del conto esterno: `uid` di `GET /api/v3/account`.

## 4. ccxt e Kraken (run senza chiavi, già riportato su PERS-81)

- Import della sola classe dell'exchange non permesso da `exports` di ccxt: import completo in
  `serverExternalPackages`, circa +65 MB di RSS.
- `npm audit` fallisce su ccxt `4.5.89` per `undici` `7.29.1`: override `undici` ≥ `7.30.1` finché ccxt non
  aggiorna il pin.
- Kraken: ticker senza `timestamp` (usare l'ora della risposta); nessun endpoint per i permessi.
  **Proposta per D5:** Mattia non ha un conto Kraken, quindi in fase 4 l'adapter Kraken non ha fixture
  reali. Spostare Kraken dopo la fase 4 o accettare test di mapping con fixture costruite dalla
  documentazione.

## 5. Fixture

| Cartella | File |
|---|---|
| `etoro/` | `me`, `balances-*` (USD ed EUR con zero, conto vuoto, valuta non supportata), `portfolio-empty`, `pnl-empty`, `trade-history*` (4 righe tipo, pagina oltre la fine, `minDate` mancante), `balances-history*` (3 snapshot, range troppo grande, fuori retention), `cash-transactions-*` (pagina e completo), `sub-accounts-forbidden`, `closed-events-unavailable` |
| `binance/` | `api-restrictions`, `wallet-balance`, `account`, `balance-spot`, `balance-funding`, `earn-*-empty`, `deposits`, `withdrawals`, `fiat-orders-*`, `fiat-payments-buy`, `convert-trade-flow*`, `asset-dividend`, `my-trades` (BNB fee, maker), `tickers` |
