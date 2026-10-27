# Investments: design della nuova sezione

PERS-71 (27/10/2026), fase di pianificazione dell'epica PERS-68. **Solo design**: nessun codice,
nessuna migrazione e nessun deploy prima dell'approvazione di Mattia.

Input:

- requisiti di Mattia (PERS-68);
- analisi dello stato attuale su `main` @ `813c1ac` (PERS-70): i riferimenti `E1`–`E10` (punti di
  estensione) e `V1`–`V13` (vincoli) rimandano a quel documento;
- ricerca provider (PERS-69) e fatti eToro già verificati in Pluto (Hindsight `progetto:pluto`).

Le scelte marcate **[D<n>]** sono raccomandazioni che dipendono da una decisione aperta (sezione 8).
Il resto del documento le dà per accettate.

## 0. Principi

1. **Una sola fonte per il patrimonio netto** (V1). Ogni servizio di investimento è una riga di
   `accounts`. Il suo valore giornaliero è una `balance_entry` di quel conto, come per `funds` (E6).
   Patrimonio netto, Overview, snapshot, MCP e `/api/v1` lo vedono senza modifiche.
2. **Un solo scrittore per conto.** Sui conti gestiti da Investments, solo il modulo Investments
   scrive `balance_entries`, con la nuova fonte `portfolio` [D3]. Le letture del provider, gli asset
   e le rettifiche restano nelle tabelle del modulo e si combinano in un solo numero.
3. **Il provider è la fonte di verità per ciò che riporta.** Gli asset manuali coprono solo ciò che il
   provider non vede. Le correzioni sono rettifiche datate, mai sovrascritture silenziose.
4. **Valori in EUR nei saldi** [D1]. La valuta originale resta nelle tabelle del modulo, con il cambio
   usato. Nessun totale somma valute diverse (V7).
5. **Sola lettura verso l'esterno.** Ledgerly non fa mai trading né prelievi. Le chiavi con permessi
   di scrittura vengono rifiutate dove l'API lo permette di verificare.

## 1. Modello dati

Il modulo resta `src/modules/investments/` (E10). Le tabelle nuove sostituiscono
`investment_platforms`, `investment_movements` e `investment_valuations`. I dati attuali (2 / 5 / 2
righe) vengono migrati (fase 2, [D4]).

### 1.1 Catalogo dei provider

Statico nel codice, non in tabella [D12]: `INVESTMENT_PROVIDERS` in `src/modules/investments/catalog.ts`.

| Campo | Esempio | Note |
|---|---|---|
| `id` | `etoro`, `ccxt:binance`, `manual` | coincide con `integration_connections.provider` |
| `category` | `accounts` \| `broker` \| `crypto` | le tre sezioni del catalogo: Conti, Online Broker, Crypto |
| `connect` | `apikey` \| `manual` | come si collega |
| `status` | `available` \| `planned` | `planned` compare nel catalogo ma senza "Collega" |
| `url` | `https://www.etoro.com` | link diretto al servizio |
| `credentialFields` | `["api_key", "user_key"]` | chiavi piatte, compatibili con `credentialsSchema` (V5) |
| `readOnlyCheck` | `api` \| `declared` | se i permessi si verificano via API (sezione 5.2) |

Prima versione del catalogo:

| Categoria | Provider | Collegamento |
|---|---|---|
| Conti | Conto manuale (Directa, Fineco, conto deposito, BTP, fondi…) | manuale |
| Online Broker | eToro | API key read-only |
| Online Broker | Interactive Brokers (Flex Web Service), Degiro, Trade Republic, Scalable | `planned` / manuale |
| Crypto | Binance, Kraken, Coinbase, Bitvavo, Crypto.com (via ccxt) [D5] | API key read-only |
| Crypto | Bitpanda, Young Platform | manuale (adapter custom fuori perimetro) [D6] |

### 1.2 Connessioni

Si riusa `integration_connections` così com'è (E1, V4).

- **Un provider per exchange** [D2]: `ccxt:binance`, `ccxt:kraken`, … (≤ 40 caratteri,
  `schema.ts:46`). L'unique `(user_id, provider)` resta valido. Limite accettato: un solo conto
  Binance per utente.
- `PROVIDERS` e `KINDS_OF` (`src/platform/integrations/rules.ts:37`, `:49`) prendono gli id dal
  catalogo. Nuovi kind: `holdings` (snapshot di posizioni e valore) e `flows` (depositi, prelievi,
  trade, reddito). Il CHECK di `SYNC_KINDS` richiede una migrazione (E1).
- Nuovi `ENTITY_TYPES` per `provider_links` (E4): `investment_operation`, `investment_holding`.

### 1.3 Conti di investimento

Un servizio collegato o manuale è un `accounts` di tipo `investment` (broker e conti) o `crypto`
(exchange). Nessun tipo nuovo [D13]. Il modulo aggiunge una riga 1:1:

`investment_accounts`

| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid | `userScoped` |
| `account_id` | uuid FK `accounts`, unique | il conto di valutazione, come `funds.valuation_account_id` |
| `category` | `accounts` \| `broker` \| `crypto` | |
| `provider` | text | id del catalogo; `manual` per i conti manuali |
| `mode` | `assets` \| `total` | `assets`: cassa + asset. `total`: solo valutazioni complessive (il modello di oggi) |
| `native_currency` | `^[A-Z]{3}$` | valuta del servizio (USD per eToro). Il saldo è sempre EUR |
| `url` | text null | override del link del catalogo |
| `opened_on`, `closed_on` | date | |
| `created_at`, `updated_at` | timestamptz | |

Vincoli: un conto che è già `valuation_account_id` di un fondo non può diventare un conto di
investimento (i fondi restano nel modulo `funds`).

La sincronizzazione crea i conti con il ciclo di vita esistente: `applyProviderAccounts` /
`reconcileProviderAccounts` (`src/modules/accounts/service.ts:594`, `rules.ts:442`). L'adozione per
nome di un conto manuale esistente resta valida e serve anche alla migrazione.

### 1.4 Asset: catalogo e posizioni

`investment_assets`: il catalogo degli asset disponibili per l'utente.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id` | uuid | |
| `class` | `stock` \| `etf` \| `fund` \| `bond` \| `crypto` \| `cash` \| `other` | |
| `name` | text | |
| `isin` | text null | stesso CHECK di `funds_isin_ck` |
| `symbol` | text null | ticker o simbolo crypto (`BTC`) |
| `mic` | text null | borsa (es. `XMIL`) |
| `currency` | `^[A-Z]{3}$` | valuta di quotazione |
| `price_source` | `manual` \| `provider` \| `market` | `market` solo dalla fase 6 |
| `archived_at` | timestamptz null | |

Unique: `(user_id, isin)` dove `isin` non è null; `(user_id, class, symbol, mic)`.
La lista iniziale viene da un seed modificabile (crypto principali, ETF più comuni) più gli asset che
i provider scoprono. L'utente può aggiungere un asset mancante dal dialog.

`investment_holdings`: una posizione di un asset in un conto.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id` | uuid | |
| `investment_account_id` | uuid FK | |
| `asset_id` | uuid FK | |
| `origin` | `manual` \| `provider` | |
| `distinct_from_provider` | bool, default false | vedi regola R4 (sezione 2.2) |
| `state` | `open` \| `closed` \| `suspended` | `suspended` = esclusa dal valore (R4) |
| `opened_on`, `closed_on` | date | |

Unique: `(investment_account_id, asset_id, origin)` per le posizioni aperte.
Quantità e costo medio **non** sono colonne: si calcolano dalle operazioni.

### 1.5 Operazioni

`investment_operations`: tutti gli eventi di un conto.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id` | uuid | |
| `investment_account_id` | uuid FK | |
| `holding_id` | uuid FK null | obbligatorio per `buy`, `sell`, `valuation`, `close`, `income` legato a un asset |
| `kind` | vedi sotto | |
| `on` | date | giorno civile (`src/platform/dates.ts`) |
| `quantity` | `numeric(38,18)` null | 18 decimali: copre wei/satoshi (V8) |
| `unit_price` | `numeric(30,12)` null | nella valuta dell'asset |
| `native_amount` | `numeric(30,12)` null | importo nella valuta nativa |
| `native_currency` | text null | |
| `fx_rate` | `numeric(20,10)` null | EUR per 1 unità nativa usato per `amount_cents` |
| `amount_cents` | bigint | importo in EUR, segno per tipo (sotto) |
| `fee_cents` | bigint, default 0 | |
| `valid_until` | date null | solo per `adjustment` |
| `origin` | `manual` \| `provider` \| `import` | |
| `transaction_id` | uuid null, unique | collegamento al movimento bancario, come oggi (`schema.ts:73`) |
| `note` | text null | |

`kind`:

| Kind | Effetto sulla cassa (modo `assets`) | Effetto sulla posizione | Flusso per il rendimento |
|---|---|---|---|
| `deposit` | + `amount` | — | entrata |
| `withdrawal` | − `amount` | — | uscita |
| `buy` | − (`amount` + `fee`) | + `quantity`, prezzo = `unit_price` | — |
| `sell` | + (`amount` − `fee`) | − `quantity`, prezzo = `unit_price` | — |
| `valuation` | — | nuovo prezzo (o valore) dal giorno `on` | — |
| `close` | + (`amount` − `fee`) | quantità a 0, posizione `closed` | — |
| `income` | + `amount` (dividendo, interesse, staking) | — | — |
| `fee` | − `amount` | — | — |
| `account_valuation` | — | valore complessivo del conto (solo modo `total`) | — |
| `adjustment` | rettifica datata (R3) | — | — |

Le operazioni dei provider hanno un `provider_links` (E4) e sono idempotenti come in Wallet (E3).

### 1.6 Letture del provider

`investment_readings`: cosa ha riportato il provider a ogni sync. **Non** sono `balance_entries`.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id`, `investment_account_id` | uuid | |
| `on` | date | una lettura per conto e giorno: l'ultima del giorno sostituisce le precedenti |
| `observed_at` | timestamptz | |
| `total_cents` | bigint | valore totale in EUR riportato o calcolato (R1) |
| `cash_cents` | bigint null | |
| `native_total` | `numeric(30,12)` null | |
| `fx_rate` | `numeric(20,10)` null | |

`investment_reading_positions`: posizioni della lettura (`reading_id`, `asset_id`, `quantity`,
`value_cents`). Servono alla pagina del servizio, non al totale (R1).

### 1.7 Valore nel tempo

- Il valore giornaliero di un conto è una `balance_entry` con `source = 'portfolio'` [D3].
- `BALANCE_SOURCES` aggiunge `portfolio`; `SOURCE_RANK` diventa
  manual > import > **portfolio** > provider > system > derived (V2). Il CHECK
  `balance_entries_source_ck` (`schema.ts:142`) richiede una migrazione.
- Il modulo scrive un punto per ogni giorno con un evento (operazione, lettura, inizio o fine di una
  rettifica) più l'ultimo giorno di ogni mese. Tra due punti vale la regola `hold` esistente.
- Riscrittura: delete + insert dei punti `portfolio` del conto a partire dal giorno più vecchio
  toccato, nella stessa transazione che modifica le operazioni (come `rebuildDerivedBalances`).
- `rebuildDerivedBalances` ignora i conti di investimento: filtro sui conti il cui provider ha il kind
  `transactions` in `KINDS_OF` (V3).
- Nella pagina Accounts, il saldo di un conto di investimento non è modificabile a mano: il pulsante
  rimanda alla pagina del servizio. Una `manual` scritta prima della migrazione resta valida e vince
  (rank), come oggi.

### 1.8 Valute e cambio

[D1] I saldi dei conti di investimento sono sempre in EUR (`accounts.currency = 'EUR'`).
La conversione avviene alla fonte, nell'ordine:

1. il provider dà già EUR (eToro `/api/v1/balances?displayCurrency=EUR`);
2. coppia `X/EUR` sull'exchange (ccxt);
3. coppia `X/USDT` o `X/USDC` sull'exchange, poi cambio USD→EUR BCE;
4. cambio BCE per le valute fiat.

`fx_rates` (dato di mercato, non personale, quindi senza `user_id`):

| Colonna | Tipo |
|---|---|
| `on` | date |
| `currency` | `^[A-Z]{3}$` |
| `eur_per_unit` | `numeric(20,10)` |
| `source` | `ecb` |

PK `(on, currency)`. Fonte: Frankfurter (dati BCE), un job giornaliero nel tier `daily`. Nei giorni
senza fixing (weekend, festivi) si usa l'ultimo cambio ≤ giorno. Ogni operazione salva il cambio
usato (`fx_rate`), quindi un ricalcolo non cambia il passato.

## 2. Regole di valorizzazione

Notazione per il conto `A` al giorno `d`: `V(A,d)` è il valore scritto in `balance_entries`.

### 2.1 Conto manuale

**Modo `assets`:**

```
V(A,d) = Cassa(A,d) + Σ ValoreAsset(h,d)   per le posizioni aperte al giorno d

Cassa(A,d)       = Σ deposit − Σ withdrawal − Σ (buy + fee) + Σ (sell − fee)
                   + Σ (close − fee) + Σ income − Σ fee            (operazioni con on ≤ d)
ValoreAsset(h,d) = Quantità(h,d) × UltimoPrezzo(h,d) × Cambio(d)
UltimoPrezzo     = prezzo dell'ultimo buy / sell / valuation con on ≤ d
```

- Asset senza quantità (BTP o fondo registrato per controvalore): `valuation` con solo
  `amount_cents`. Il valore è l'ultimo `amount_cents` ≤ d.
- Una posizione `closed` vale 0 dal giorno di chiusura; il ricavato è già in cassa.
- Cassa negativa: consentita (dati incompleti), con un avviso nella pagina del servizio.

Esempio (conto Directa, manuale, modo `assets`):

| Giorno | Operazione | Cassa | Asset | V |
|---|---|---|---|---|
| 01/03 | deposit 10.000 € | 10.000 | 0 | **10.000** |
| 02/03 | buy 100 VWCE @ 60 €, fee 2 € | 3.998 | 6.000 | **9.998** |
| 30/06 | valuation VWCE @ 65 € | 3.998 | 6.500 | **10.498** |
| 15/09 | close VWCE @ 70 €, fee 2 € | 10.996 | 0 | **10.996** |
| 20/09 | withdrawal 2.000 € | 8.996 | 0 | **8.996** |

**Modo `total`** (il comportamento di oggi, per chi non vuole tracciare le posizioni):

```
V(A,d) = ultima account_valuation ≤ d + flussi netti (deposit − withdrawal) dopo quella valutazione
```

È la regola di `valueOn` (`src/modules/investments/rules.ts:115`). Un conto passa da `total` ad
`assets` inserendo le posizioni: dal primo giorno con posizioni vale la formula `assets`.

### 2.2 Conto sincronizzato

```
V(A,d) = P(A,d) + M(A,d) + R(A,d)
```

- **R1 · P = lettura del provider.** `P(A,d)` è `total_cents` dell'ultima `investment_readings` con
  `on ≤ d`. Comprende tutto quello che il provider riporta: cassa e posizioni. Se il provider dà solo
  le quantità (ccxt `fetchBalance`), Ledgerly calcola il totale **al momento della sync** e lo salva
  nella lettura. Le posizioni della lettura servono al dettaglio, mai al totale.
- **R2 · M = asset manuali fuori dal provider.** Somma di `ValoreAsset` (formula 2.1) delle posizioni
  `origin = manual`, `state = open`. Su un conto sincronizzato depositi e prelievi manuali non toccano
  il valore: il provider li vede già nella sua cassa. Contano solo per il rendimento.
- **R3 · R = rettifiche datate.** Somma degli `adjustment` con `on ≤ d` e (`valid_until` null o
  `valid_until ≥ d`). Una rettifica è un delta in EUR con motivo obbligatorio. Senza `valid_until` vale
  per sempre: la pagina segnala le rettifiche aperte da più di 30 giorni.
- **R4 · Niente doppi conteggi tra M e P.** Se una lettura riporta una posizione dello stesso asset di
  una posizione manuale aperta, la posizione manuale passa a `suspended` dal giorno della lettura e non
  conta in `M`. La pagina mostra un avviso con due azioni: "Chiudi la posizione manuale" oppure "È una
  posizione diversa" (`distinct_from_provider = true`, es. ETH in Earn vs ETH spot). Con il flag la
  posizione torna a contare e R4 non si applica più.
- **R5 · Letture mancanti.** Se il provider non risponde, `P` resta l'ultima lettura (hold). Il conto
  diventa stale secondo `stale_after_hours` come oggi.
- **R6 · Correzione del provider.** Se il provider rettifica un valore passato (es. storico eToro
  ricaricato), la lettura del giorno viene sostituita e i punti `portfolio` vengono riscritti da quel
  giorno.

Esempi numerici:

**Esempio 1 · Solo provider (eToro).**

| Giorno | Lettura eToro (EUR) | M | R | V |
|---|---|---|---|---|
| 10/11 | 12.340 | 0 | 0 | **12.340** |
| 11/11 | nessuna (errore API) | 0 | 0 | **12.340** (R5) |
| 12/11 | 12.410 | 0 | 0 | **12.410** |

Un deposito manuale di 1.000 € registrato il 12/11 entra nel rendimento, non in V: eToro lo include
già nei 12.410.

**Esempio 2 · Provider + asset manuale (Binance + Simple Earn).**
ccxt `fetchBalance` legge solo lo spot (PERS-69). Mattia aggiunge a mano 0,5 ETH in Earn.

| Giorno | Lettura Binance (spot) | Asset manuale | V |
|---|---|---|---|
| 01/12 | 3.000 € | 0,5 ETH × 2.400 € = 1.200 € | **4.200** |
| 15/12 | 3.100 € | valuation 0,5 ETH × 2.600 € = 1.300 € | **4.400** |
| 20/12 | 3.150 € + posizione ETH 0,5 = 1.310 € (lettura Earn aggiunta in fase 4) | `suspended` (R4) | **4.460** |

Il 20/12 il provider vede l'ETH: la posizione manuale esce dal totale e non viene contata due volte.
Se Mattia indica "È una posizione diversa", V torna a 4.460 + 1.300 = 5.760.

**Esempio 3 · Provider + rettifica (bonifico in transito).**
Il 05/11 Mattia invia 500 € a eToro; eToro li accredita il 07/11.

| Giorno | Lettura eToro | Rettifica | V |
|---|---|---|---|
| 05/11 | 10.000 | +500 (05/11 → 06/11, "bonifico in transito") | **10.500** |
| 06/11 | 10.020 | +500 | **10.520** |
| 07/11 | 10.530 | scaduta | **10.530** |

Senza `valid_until` la rettifica il 07/11 avrebbe contato 500 € due volte: per questo la UI propone
sempre una data di fine e segnala quelle aperte.

**Esempio 4 · Rettifica permanente (valuta).**
Il provider sopravvaluta di 37 € una posizione per un cambio sbagliato: rettifica −37 € dal 03/10
senza fine. V = P − 37 finché la rettifica esiste. Dopo 30 giorni la pagina chiede di chiuderla.

### 2.3 Rapporto con saldi, patrimonio netto, home e conti F1

- Il valore entra in patrimonio netto, Overview, snapshot, MCP e API tramite `accountsView` e
  `balancesOn` (V1). Nessuna somma calcolata a parte.
- Il tile "Investments" della home resta il bucket `investments` di `bucketOf` (investment, pension,
  crypto): ora comprende anche i conti collegati, perché sono `accounts` di quei tipi.
- I flag `in_net_worth`, `in_snapshot`, `counts_as_liquid` dei conti restano validi. Default per i
  conti di investimento: `in_net_worth = true`, `in_snapshot = true`, `counts_as_liquid = false`.
- Lo snapshot mensile legge `balancesOn(..., observed: true)`: `portfolio` è una fonte osservata, non
  è nell'elenco `NOT_OBSERVED` (`queries.ts:42`).
- MCP e API (V13): `balance` mantiene il significato "valore del conto", `source` può valere anche
  `portfolio`. È un valore nuovo di un campo esistente: va scritto nel changelog dell'API.
- **Doppio conteggio di oggi** (PERS-70 §3, limite 2): le 2 piattaforme diventano conti (fase 2) e il
  conto `investment` manuale che rappresenta la stessa piattaforma viene adottato, non duplicato [D4].
- Fondi pensione e PAC restano in `funds`: non compaiono nel catalogo Investments. La home
  Investments li mostra in sola lettura come "Fondi" con link alla loro pagina.

### 2.4 Rendimento

Per conto e per portafoglio [D8]:

- **Guadagno** = V − depositi + prelievi (come `platformStats`, `rules.ts:137`).
- **Rendimento semplice** = guadagno / depositi.
- **Rendimento annualizzato money-weighted (XIRR)** sui flussi `deposit` / `withdrawal` e sul valore
  finale. Si mostra solo se i flussi sono completi; altrimenti "flussi incompleti" (es. eToro, che non
  espone depositi e prelievi).

## 3. Integrazioni

### 3.1 Interfaccia comune del provider

La fase 1 sostituisce l'`if/else` del dispatcher (`src/platform/integrations/jobs.ts:51-60`, E2) con
un registro. Il comportamento di Wallet, Trek e Paperless non cambia.

```ts
// src/platform/integrations/registry.ts
interface ProviderPass {
  provider: string;                       // id o prefisso ("ccxt:")
  kinds: readonly SyncKind[];             // da KINDS_OF
  run(person, ctx, connection, now): Promise<PassOutcome>; // answered | failed | refused | busy | absent
}
```

Le integrazioni di investimento implementano un contratto in più, senza DB e senza `server-only` nel
client (stesso schema `client.ts` / `sync.ts` / `mapping.ts`, E3):

```ts
// src/platform/integrations/investments/source.ts
interface InvestmentSource {
  verifyReadOnly(credentials): Promise<"read-only" | "write" | "unverifiable">;
  fetchHoldings(credentials, now): Promise<HoldingsSnapshot>;   // conti, cassa, posizioni, totale EUR
  fetchFlows(credentials, cursor): Promise<{ flows: ProviderFlow[]; cursor: string | null }>;
}
```

Il pass di un provider di investimento:

1. `withJobLock("investments-sync:<connectionId>")` (V9): un secondo chiamante riceve `busy`.
2. Fuori transazione: legge credenziali (`readCredentials`), chiama `fetchHoldings` e `fetchFlows`.
3. In transazioni brevi (V6): `applyProviderAccounts` per i conti, upsert della lettura del giorno,
   upsert delle operazioni con `linkExternal` nello stesso `tx`, ricalcolo dei punti `portfolio` dai
   giorni toccati.
4. `recordRun` → `finishRun` per ogni kind; un `401/403` porta `markConnection(…, "revoked")`.
5. Protezione dalle cancellazioni di massa come `removalDoubt`: una lettura vuota quando la precedente
   aveva posizioni non chiude nulla e fallisce il run.

Lo scheduler PERS-60 resta invariato: minimo 15 minuti, `busy` non avanza la schedule, errori
isolati per connessione. Default per i nuovi provider: regola `times` 07:30 e 22:30 (due letture al
giorno bastano per un valore EOD e restano lontane dai rate limit). Mattia la cambia dall'editor.

### 3.2 Crypto via ccxt

- Pacchetto `ccxt` pinnato a versione esatta (V11), in `serverExternalPackages` di `next.config.ts`
  (70 MB, fuori dal bundle) e importato in modo dinamico solo nel client ccxt.
- Un'istanza per pass, mai in cache. `enableRateLimit: true`; niente `paginate` (sperimentale):
  paginazione esplicita per finestre.
- Exchange iniziali [D5]: Binance e Kraken in fase 4; Coinbase, Bitvavo, Crypto.com quando servono
  (stesso adapter, solo voce di catalogo e test di mapping).

Dati letti:

| Dato | Metodo ccxt | Note |
|---|---|---|
| Saldi | `fetchBalance()` | Binance: anche `{ type: "funding" }`. Earn non incluso (R4, esempio 2) |
| Prezzi | `fetchTickers()` delle coppie `X/EUR`, poi `X/USDT` | regola 1.8 |
| Flussi | `fetchLedger` (Kraken, Coinbase, Bitvavo, Crypto.com) | cursore = ultimo timestamp |
| Flussi Binance | `fetchDeposits` / `fetchWithdrawals` a finestre di 90 giorni, `fetchMyTrades` per simbolo | simboli = asset con saldo o già visti |

Mappatura sulle operazioni:

| Evento ccxt | Operazione |
|---|---|
| deposito fiat | `deposit` (EUR) |
| deposito crypto da wallet esterno | `deposit` valorizzato al cambio del giorno |
| prelievo fiat o crypto | `withdrawal` |
| trade `BTC/EUR` buy | `buy` BTC |
| trade `ETH/BTC` buy | `sell` BTC + `buy` ETH, stesso giorno, controvalore EUR al prezzo del trade |
| fee del trade | `fee_cents` dell'operazione |
| ledger `reward`, `staking`, `interest` | `income` |
| ledger `transfer` interno (spot ↔ earn) | ignorato |

Storico iniziale [D11]: al primo collegamento, 24 mesi di flussi dove l'exchange li espone.

### 3.3 Online Broker: eToro

PERS-69 non trova un aggregatore adatto a un singolo utente in UE: si parte da eToro con l'API
nativa. SnapTrade Personal è scartato: copre solo eToro, IBKR e Degiro, e su Degiro le credenziali
passano a terzi.

- Credenziali sigillate: `api_key` (`x-api-key`) e `user_key` (`x-user-key`); `x-request-id` è un
  UUID nuovo per ogni chiamata.
- Chiave **propria di Ledgerly**, Real + Read: il rate limit è per chiave e non va condiviso con Pluto.
  In pratica la stessa coppia di chiavi funziona su demo e real e cambia solo il path `/demo/`
  (verificato in Pluto): l'adapter usa solo path real fissi, mai `/demo/`.
- Lettura per pass (≤ 4 chiamate, sotto 60/min):

| Dato | Endpoint |
|---|---|
| Totale in EUR | `GET /api/v1/balances?displayCurrency=EUR` |
| Posizioni | `GET /api/v1/trading/info/portfolio` |
| Trade chiusi | `GET /api/v1/trading/info/trade/history?minDate=…` (finestre < 1 anno) |
| Storico (solo al primo collegamento) | `GET /api/v1/balances/{accountType}/{accountId}/history` (12 mesi) |

- Depositi e prelievi: l'API non li espone. Fonti: collegamento ai movimenti bancari (il
  `transaction_id` di oggi) o inserimento manuale. Il rendimento XIRR indica "flussi incompleti"
  finché mancano.
- Dividendi: nessun endpoint, già inclusi nel valore. Non si creano `income`.
- L'API è beta e cambia spesso: il client valida le risposte con zod e fallisce in modo esplicito
  (`failed` con messaggio normalizzato), senza scrivere letture parziali.
- Termini eToro: Ledgerly salva una lettura al giorno per lo storico del valore. Il marchio eToro
  accompagna i dati nella pagina del servizio.

Prossimo broker dopo eToro: IBKR Flex Web Service (token read-only, IP restrict), fuori da questo
piano.

## 4. UI

Tutte le schermate: i18n `en` + `it`, doppia vista tabella / lista mobile con gli stessi controlli,
target ≥ 24 px, voci in `navigation.ts` e `icons.ts`, presenza in `tests/e2e/a11y.spec.ts` e
`keyboard.spec.ts` nello stesso commit che le aggiunge, con dati seed per l'utente `layout` (V12).

### 4.1 Home Investments (`/investments`)

- KPI: valore totale, versato netto, guadagno, XIRR (con "parziale" se un conto ha flussi incompleti).
- Grafico valore vs versato (36 mesi, come oggi), da `balance_entries` dei conti di investimento.
- Tabella dei servizi: nome, categoria, origine (manuale / sincronizzato), stato sync, ultimo
  aggiornamento, valore, variazione 30 giorni, peso. Ogni riga apre la pagina del servizio.
- Allocazione per classe di asset (stock, etf, crypto, …) e per servizio.
- Sezione "Fondi" in sola lettura con link a `funds`.
- Pulsante "Aggiungi servizio" → catalogo.

### 4.2 Catalogo (`/investments/catalog`)

- Tre sezioni: **Conti**, **Online Broker**, **Crypto**.
- Card per provider: nome, stato (collegato / disponibile / in arrivo), link "Apri sito" (URL del
  catalogo), azione:
  - `apikey` → dialog "Collega": guida passo passo per creare una chiave **read-only** sul servizio
    (permessi esatti per provider, sezione 5), campi write-only, verifica permessi, primo sync;
  - `manual` → dialog "Crea conto manuale" (nome, categoria, modo `assets`/`total`, URL);
  - già collegato → "Apri" (pagina del servizio).
- Le card delle integrazioni di investimento non compaiono più in Settings → Integrazioni come card
  dedicate: Settings mostra la connessione nell'elenco con link al catalogo (E7). Schedule e azioni
  (test, sync ora, disconnetti) riusano le Server Action esistenti.

### 4.3 Pagina del servizio (`/investments/[accountId]`)

- Header: nome, provider, stato sync e ultima lettura, valore attuale, link "Apri servizio",
  "Sincronizza ora".
- KPI: valore, versato netto, prelievi, guadagno, rendimento semplice e XIRR.
- Grafico: valore nel tempo vs versato; marker su depositi, prelievi e rettifiche.
- **Asset**: nome, classe, quantità, prezzo, valore, peso, P/L, origine (provider / manuale), stato
  (`suspended` con avviso R4). Azioni per riga manuale: Valuta, Vendi, Chiudi.
- **Operazioni**: tabella filtrabile per tipo e periodo; collegamento ai movimenti bancari.
- **Letture e rettifiche** (solo sincronizzati): ultime letture del provider, rettifiche aperte con
  scadenza, "Aggiungi rettifica" (delta, dal, al, motivo).
- **Impostazioni**: modo (`assets`/`total`), flag del conto, sostituzione chiave (5.3), disconnessione.
  Disconnettere non cancella lo storico: il conto torna `manual` con le letture già salvate.

### 4.4 Inserimento manuale degli asset

Dialog "Aggiungi asset":

1. Ricerca nel catalogo `investment_assets` (combobox con filtro per classe, ricerca per nome, ISIN o
   simbolo). Se manca: "Nuovo asset" (classe, nome, ISIN/simbolo, valuta).
2. Acquisto: data, quantità e prezzo unitario **oppure** importo totale (per BTP e fondi), commissioni,
   valuta (cambio BCE proposto, modificabile).
3. Salvataggio: `buy` + punti `portfolio` ricalcolati.

Valutazione intermedia (opzionale): data + prezzo unitario o controvalore. Chiusura: data + prezzo o
ricavato + commissioni.

## 5. Sicurezza delle credenziali

### 5.1 Regole

- Solo `saveConnection` / `readCredentials` con il keyring AES-256-GCM esistente
  (`src/platform/crypto.ts`, `APP_ENCRYPTION_KEY`). Nessuna tabella o chiave nuova.
- Campi write-only nella UI: dopo il salvataggio non si rileggono mai. La UI mostra solo "chiave
  impostata il …" e l'esito dell'ultima verifica.
- Nessun segreto in log, errori, `sync_runs.error`, API, MCP, export:
  - il tipo `Connection` non contiene `credentials` (già oggi);
  - ccxt con `verbose: false`; gli errori di ccxt e di eToro passano da `syncErrorText` e
    `redactForLog`, con un test che verifica che chiave e firma non compaiano nel messaggio;
  - le richieste ccxt possono contenere la firma nell'URL: il messaggio salvato contiene solo classe
    dell'errore e codice HTTP, mai l'URL.
- Istanze ccxt create per pass e scartate: le chiavi non restano in memoria tra un pass e l'altro.

### 5.2 Solo chiavi read-only

Al collegamento e a ogni sostituzione della chiave, `verifyReadOnly`:

| Provider | Verifica | Esito se la chiave scrive |
|---|---|---|
| Binance | endpoint delle restrizioni della chiave (`GET /sapi/v1/account/apiRestrictions`) | rifiuto se trading o prelievi abilitati |
| Coinbase (CDP) | endpoint dei permessi della chiave (`GET /api/v3/brokerage/key_permissions`) | rifiuto se `can_trade` o `can_transfer` |
| Kraken, Bitvavo, Crypto.com, eToro | nessun endpoint noto per leggere i permessi | `unverifiable`: conferma esplicita dell'utente |

- I due endpoint di Binance e Coinbase vanno verificati nella fase che introduce il provider (chiamata
  reale con una chiave read-only), prima di scrivere il codice. Se non esistono più, il provider passa
  a `unverifiable`.
- `unverifiable` [D7]: il dialog mostra i permessi esatti da impostare (PERS-69) e chiede la conferma
  "La chiave ha solo permessi di lettura". La conferma e la data restano nella connessione (campo
  non segreto).
- Ledgerly non prova mai una chiamata di scrittura per testare i permessi.
- IP whitelist consigliata nel dialog dove il servizio la supporta (Binance, Kraken, Bitvavo,
  Crypto.com, eToro).

### 5.3 Rotazione

- "Sostituisci chiave": nuova chiave → `verifyReadOnly` → chiamata di prova → solo se tutto va bene
  `saveConnection` sostituisce le credenziali. Se fallisce, la chiave vecchia resta.
- Promemoria nella pagina del servizio dopo 90 giorni (raccomandazione eToro) o alla scadenza
  dichiarata dal servizio.
- Rotazione della chiave di cifratura: già coperta dal keyring (`k2:…,k1:…`).

## 6. Aggiornamento automatico dei prezzi (nice to have)

**Proposta: rinviare a una fase 6 separata, e farla solo per ciò che si può fare bene.** Le fasi 1–5
funzionano senza prezzi automatici. Motivi:

- Per i conti sincronizzati i prezzi arrivano già dal provider (eToro, ticker degli exchange).
- Per gli asset manuali una fonte ha senso solo se la copertura è verificata sugli ISIN reali di
  Mattia: EODHD su Borsa Italiana e sui BTP non è confermato (PERS-69 §4).

Quando si fa (fase 6):

| Classe | Fonte | Note |
|---|---|---|
| Cambi | Frankfurter (BCE) | già in fase 1 per la conversione |
| Crypto | CoinGecko Demo | prezzo EUR giornaliero, attribuzione obbligatoria nella UI |
| Azioni ed ETF | EODHD | Free (20 chiamate/giorno) se bastano; €19,99/mese solo dopo un test con gli ISIN reali |
| Fondi, BTP | manuale | nessuna fonte gratuita con licenza chiara |

Regole: tabella `asset_prices` (`asset_id`, `on`, `price`, `currency`, `source`), un prezzo di
chiusura al giorno, mai intraday. Un `valuation` manuale dello stesso giorno vince sempre. Un prezzo
più vecchio di 5 giorni lavorativi rende l'asset "stale" nella pagina. `price_source = market` si
attiva asset per asset.

Criterio "fare bene o non fare": la fase 6 parte solo se il test copre ≥ 90% del valore degli asset
manuali di Mattia; altrimenti resta manuale.

## 7. Piano a fasi

Rollback comune (`docs/scheduler.md:130-152`): prima del deploy tag `ledgerly:pre-<fase>` e
`ledgerly-cron:pre-<fase>` + dump `backups/ledgerly/pre-<fase>.dump`. Per tornare indietro: retag,
`docker compose up -d --no-build`, SQL inverso scritto nel doc della fase, riga cancellata da
`drizzle.__drizzle_migrations`. Gate di ogni fase: `npm run format && npm run lint && npm run
typecheck && npm run format:check && npm test`, `npm run test:integration`, `npm run e2e`.

| Fase | Perimetro | Migrazioni | Test | Rollback |
|---|---|---|---|---|
| **1 · Fondamenta** | Registro dei pass al posto dell'`if/else` (stesso comportamento); fonte `portfolio` in `BALANCE_SOURCES` e `SOURCE_RANK`; filtro di `rebuildDerivedBalances`; tabella `fx_rates` + job Frankfurter giornaliero; `serverExternalPackages` pronto | `0035_portfolio_source_fx`: CHECK di `balance_entries.source`, tabella `fx_rates` | unit: registro, `SOURCE_RANK` con `portfolio`; itest: `jobs.itest.ts` invariato per Wallet/Trek/Paperless, `rebuildDerivedBalances` esclude i conti non Wallet; job FX con risposta finta | SQL inverso: drop `fx_rates`, CHECK originale (nessuna riga `portfolio` esiste ancora) |
| **2a · Modello e conti manuali** | Tabelle 1.3–1.6, motore di valorizzazione puro (`rules.ts`), scrittura dei punti `portfolio`, Server Action; migrazione dati delle 2 piattaforme [D4] | `0036_investments_v2`: tabelle nuove; trasformazione SQL delle piattaforme in `accounts` + `investment_accounts` (modo `total`); `investment_movements` → `deposit`/`withdrawal`, `investment_valuations` → `account_valuation`; le tabelle vecchie restano in sola lettura | unit: tutte le formule della sezione 2 con gli esempi numerici di questo documento come casi; itest: migrazione dati su una copia seed, idempotenza dei punti `portfolio`, patrimonio netto senza doppi conteggi | SQL inverso: drop tabelle nuove, delete dei conti creati e delle entry `portfolio`; le tabelle vecchie sono intatte |
| **2b · UI** | Home, catalogo (solo provider manuali), pagina del servizio, dialog asset/valutazione/chiusura/rettifica | nessuna | e2e: flusso conto manuale completo; a11y e keyboard sulle 3 schermate nuove | retag immagine |
| **3 · eToro** | Adapter `etoro`, catalogo attivo, collegamento con verifica, storico 12 mesi, letture giornaliere, R1/R3/R5 | `0037_investment_sync_kinds`: `holdings`, `flows` in `SYNC_KINDS`, nuovi `ENTITY_TYPES` | unit: mapping eToro con fixture reali anonimizzate (chiamata reale Read fatta prima di scrivere il mapping); itest: pass con client finto, lock, `revoked` su 401, lettura vuota rifiutata; test di redazione dei segreti | disabilitare la voce di catalogo, revocare la chiave su eToro, SQL inverso dei kind |
| **4 · ccxt** | Adapter `ccxt:binance`, `ccxt:kraken`; verifica read-only Binance; prezzi EUR; flussi e mapping 3.2; R4 | nessuna (kind già presenti) | unit: mapping per exchange con fixture, conversione EUR, R4; itest: pass con exchange finto, finestre 90 gg Binance; build: dimensione immagine e `mem_limit` | rimuovere le voci di catalogo; le connessioni restano ma non hanno pass |
| **5 · Esposizione e rendimento** | XIRR, tool MCP `list_investments` e `get_investment_holdings` (sola lettura), endpoint `/api/v1/investments`, export aggiornato, drop delle tabelle vecchie | `0038_drop_legacy_investments` (dopo dump) | itest MCP/API (scope, nessun segreto); unit XIRR | restore delle tabelle vecchie dal dump `pre-5` |
| **6 · Prezzi automatici (opzionale)** | Sezione 6, dopo il test di copertura | `0039_asset_prices` | unit: priorità manuale > market, stale; itest con fonte finta | disattivare `price_source = market`, drop tabella |

Ogni fase è una PR separata, rilasciabile da sola. La fase 2a non dipende dai provider: Mattia può
usare i conti manuali con gli asset prima di eToro e ccxt.

## 8. Decisioni aperte per Mattia

1. **Valuta dei saldi (D1).** (a) Conti di investimento sempre in EUR, conversione alla fonte e
   valuta nativa nel modulo; (b) FX generale in Accounts (tabella cambi applicata a tutti i totali).
   **Raccomandazione: (a).** Non tocca F1 e non rompe i totali. (b) è un progetto a sé.
2. **Più exchange (D2).** (a) Un provider per exchange (`ccxt:binance`); (b) togliere l'unique
   `(user, provider)` e aggiungere un'etichetta. **Raccomandazione: (a).** Nessuna migrazione dei
   vincoli. Limite: un solo account per exchange.
3. **Fonte del valore (D3).** (a) Nuova fonte `portfolio` con rank esplicito, unico scrittore per i
   conti di investimento; (b) riuso di `manual`/`provider` come fa `funds`. **Raccomandazione: (a).**
   Con (b) una lettura `provider` del giorno dopo nasconderebbe asset e rettifiche.
4. **Piattaforme esistenti (D4).** (a) Migrarle in conti in modo `total` e adottare il conto
   `investment` manuale che rappresenta la stessa piattaforma; (b) tenerle come registro separato.
   **Raccomandazione: (a).** Elimina il doppio conteggio di oggi. Serve un tuo sì su quale conto
   manuale corrisponde a quale piattaforma.
5. **Exchange iniziali (D5).** Quali exchange usi davvero? **Raccomandazione:** Binance e Kraken in
   fase 4, gli altri su richiesta.
6. **Bitpanda e Young Platform (D6).** (a) Conto manuale; (b) adapter custom con le loro API
   read-only. **Raccomandazione: (a)** finché non li usi in modo rilevante.
7. **Chiavi con permessi non verificabili (D7).** (a) Accettarle con la tua conferma esplicita;
   (b) rifiutarle. **Raccomandazione: (a).** Con (b) Kraken ed eToro non si collegano.
8. **Rendimento (D8).** (a) Semplice + XIRR; (b) anche TWR. **Raccomandazione: (a).** Il TWR richiede
   valori giornalieri esatti a ogni flusso, che eToro e i conti manuali non danno.
9. **Prezzi automatici (sezione 6).** (a) Fase 6 dopo il test di copertura; (b) mai.
   **Raccomandazione: (a)**, con soglia del 90% del valore coperto.
10. **Termini eToro sul caching.** Ledgerly salva una lettura al giorno per lo storico. (a) Accetti
    l'interpretazione "ragionevolmente necessario"; (b) solo valore attuale, senza storico.
    **Raccomandazione: (a).** Senza storico non c'è andamento oltre 12 mesi.
11. **Storico iniziale (D11).** (a) eToro 12 mesi (limite API), ccxt 24 mesi; (b) solo da oggi.
    **Raccomandazione: (a).**
12. **Catalogo provider (D12).** (a) Statico nel codice; (b) tabella modificabile dalla UI.
    **Raccomandazione: (a).** Un provider nuovo richiede comunque codice.
13. **Tipo di conto (D13).** (a) `investment` per broker e conti, `crypto` per exchange; (b) nuovo tipo
    `broker` con migrazione del CHECK. **Raccomandazione: (a).** Le categorie del catalogo bastano.
