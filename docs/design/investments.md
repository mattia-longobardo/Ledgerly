# Investments: design della nuova sezione

PERS-71 (27/10/2026), fase di pianificazione dell'epica PERS-68. Revisione PERS-74 (27/10/2026) con
l'esito della review avversariale (PERS-72, obiezioni `A1`–`A10`) e della security review (PERS-73,
rischi `SEC-01`–`SEC-09`): la sezione 9 dice dove è stata recepita ogni obiezione. Revisione PERS-76
(27/10/2026) con le 16 decisioni di Mattia (sezione 8), tra cui la valuta di visualizzazione (1.8,
fase 1b). Revisione PERS-84 (28/10/2026) con le proposte dello spike (`investments-spike.md`, E1–E9 per
eToro e B1–B7 per Binance) approvate da Mattia: D17 e D18.
**Solo design**: nessun codice, nessuna migrazione e nessun deploy prima dell'approvazione di Mattia.

Input:

- requisiti di Mattia (PERS-68);
- analisi dello stato attuale su `main` @ `813c1ac` (PERS-70): i riferimenti `E1`–`E10` (punti di
  estensione) e `V1`–`V13` (vincoli) rimandano a quel documento;
- ricerca provider (PERS-69) e fatti eToro già verificati in Pluto (Hindsight `progetto:pluto`);
- review PERS-72 e PERS-73.

Le scelte marcate **[D<n>]** applicano una decisione presa da Mattia il 27/10/2026 (sezione 8).

## 0. Principi

1. **Una sola fonte per il patrimonio netto** (V1). Ogni servizio di investimento è una riga di
   `accounts`. Il suo valore giornaliero è una `balance_entry` di quel conto, come per `funds` (E6).
   Patrimonio netto, Overview, snapshot, MCP e `/api/v1` lo vedono senza modifiche.
2. **Un solo scrittore per conto.** Sui conti gestiti da Investments, solo il modulo Investments
   scrive `balance_entries`, con la nuova fonte `portfolio` [D3]. Il passaggio di autorità su un conto
   esistente è esplicito, datato e atomico (sezione 1.3). Le letture del provider, gli asset e le
   rettifiche restano nelle tabelle del modulo e si combinano in un solo numero.
3. **Il provider è la fonte di verità per il suo perimetro.** Ogni lettura dichiara cosa copre (conto
   esterno e prodotto). Gli asset manuali coprono solo ciò che è fuori da quel perimetro. Il simbolo
   dell'asset da solo non decide mai una sovrapposizione. Le correzioni sono rettifiche datate, mai
   sovrascritture silenziose.
4. **Storico riproducibile.** Ogni valore dipende solo da eventi datati e conservati: operazioni,
   letture, eventi di riconciliazione e di modo, prezzi e cambi salvati. Un ricalcolo da un giorno `d`
   lascia invariati tutti i giorni prima di `d`.
5. **Valuta nativa nei saldi, valuta di visualizzazione nei totali** [D1]. Ogni conto tiene i saldi
   nella sua valuta (`accounts.currency`). Ogni totale su più conti converte nella valuta di
   visualizzazione dell'utente (default EUR) al cambio BCE del giorno (1.8). Nessun totale somma valute
   diverse senza conversione (V7). Il prezzo e il percorso di conversione restano nelle tabelle del
   modulo. Un prezzo o un cambio mancante dà un valore parziale e segnalato, mai uno zero silenzioso
   né una parità 1:1.
6. **Sola lettura verso l'esterno.** Ledgerly non fa mai trading né prelievi. Una chiave è accettata
   solo se l'unico permesso attivo è la lettura (allowlist), verificato a ogni pass dove l'API lo
   permette (sezione 5.2).

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
| `credentialFields` | `["api_key", "user_key"]` | chiavi piatte (V5). Generano lo schema `z.strictObject` del provider: un campo in più è rifiutato (SEC-03) |
| `readOnlyCheck` | `api` \| `declared` | se i permessi si verificano via API (sezione 5.2) |
| `ipWhitelist` | `supported` \| `unsupported` | se il servizio supporta l'IP whitelist: il dialog la suggerisce come opzione, mai obbligatoria [D7] |
| `ccxtId` | `binance` | solo per ccxt: id dell'exchange, mai preso dall'input (SEC-03) |
| `products` | `["spot", "funding"]` | prodotti che l'adapter sa leggere: il perimetro massimo delle letture (A1) |
| `revokeUrl` | URL della pagina delle API key | per i passi di revoca (SEC-07) |

Prima versione del catalogo:

| Categoria | Provider | Collegamento |
|---|---|---|
| Conti | Conto manuale (Directa, Fineco, conto deposito, BTP, fondi…) | manuale |
| Online Broker | eToro | API key read-only |
| Online Broker | Interactive Brokers (Flex Web Service), Degiro, Trade Republic, Scalable | `planned` / manuale |
| Crypto | Binance, Kraken (via ccxt) [D5] | API key read-only |
| Crypto | Coinbase, Bitvavo, Crypto.com (via ccxt) | `planned`: solo voce di catalogo e test di mapping quando servono |

Gli exchange esclusi in [D6] non hanno voce nel catalogo, nemmeno manuale.

### 1.2 Connessioni

Si riusa `integration_connections` così com'è (E1, V4).

- **Un provider per exchange** [D2]: `ccxt:binance`, `ccxt:kraken`, … (≤ 40 caratteri,
  `schema.ts:46`). L'unique `(user_id, provider)` resta valido. Limite accettato: un solo conto
  Binance per utente.
- `PROVIDERS` e `KINDS_OF` (`src/platform/integrations/rules.ts:37`, `:49`) prendono gli id dal
  catalogo. Nuovi kind: `holdings` (snapshot di posizioni e valore) e `flows` (depositi, prelievi,
  trade, reddito). I due kind hanno esiti separati (A8). Il CHECK di `SYNC_KINDS` richiede una
  migrazione (E1).
- Nuovi `ENTITY_TYPES` per `provider_links` (E4): `investment_event`, `investment_holding`. Il
  collegamento esterno è sull'**evento**, non sulla singola operazione (A6, sezione 1.5).

`investment_key_checks` (SEC-01, SEC-07, [D7]): stato non segreto della chiave, una riga per
verifica. `integration_connections` non ha un campo adatto.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id`, `connection_id` | uuid | |
| `checked_at` | timestamptz | |
| `result` | `read-only` \| `write` \| `unknown-flag` \| `unverifiable` \| `error` | |
| `permissions` | jsonb | solo nomi e valori booleani dei flag letti dall'API, mai la chiave |
| `ip_restricted` | bool null | Binance `ipRestrict`; null se l'API non lo dice |
| `attested_read_only_at` | timestamptz null | conferma "solo lettura" dell'utente, obbligatoria per i provider `declared` |
| `attested_ip_at` | timestamptz null | conferma facoltativa "IP limitato", se l'utente ha seguito il suggerimento del dialog |
| `attestation_text_version` | text null | versione del testo mostrato nel dialog |
| `revoked_at_provider_at` | timestamptz null | conferma "chiave revocata presso il provider" dopo disconnessione o sostituzione |

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
| `managed_since` | date | giorno da cui Investments è l'unico scrittore del conto (A4) |
| `url` | text null | override del link del catalogo |
| `opened_on`, `closed_on` | date | |
| `created_at`, `updated_at` | timestamptz | |

La valuta del servizio è `accounts.currency` [D1]: la valuta nativa del servizio (es. USD per eToro,
EUR per un conto Binance in EUR), scelta al collegamento con default dal catalogo. Saldi, letture e
operazioni del conto sono in quella valuta. Non c'è una colonna `native_currency` separata.

**Modo e origine nel tempo (A3).** Il modo (`assets` \| `total`) e l'origine (`manual` \| `synced`)
non sono colonne correnti: sono intervalli in `investment_account_periods` (`investment_account_id`,
`from_on`, `mode`, `origin`, `reason`). Il valore di un giorno usa il periodo valido in quel giorno.
Un cambio di modo o di origine è sempre una **conversione esplicita** (sezione 2.5).

Vincoli:

- un conto che è già `valuation_account_id` di un fondo non può diventare un conto di investimento
  (i fondi restano nel modulo `funds`);
- **niente adozione per nome (A4).** Al collegamento e nella migrazione l'utente sceglie in modo
  esplicito: "Crea un conto nuovo" oppure "Usa il conto esistente X". Il dialog elenca i conti dello
  stesso tipo con saldo e fonte dell'ultima entry;
- un conto già alimentato da un'altra connessione (es. Wallet) non si può scegliere finché
  quella connessione lo alimenta. Il dialog lo mostra disabilitato con il motivo;
- **passaggio di autorità atomico (A4).** In una sola transazione, al giorno `T` = `managed_since`:
  le entry `manual`/`import`/`provider` del conto con `on ≥ T` vengono copiate in
  `investment_superseded_entries` (archivio con motivo) e cancellate; le entry prima di `T` restano;
  il modulo scrive i punti `portfolio` da `T`. Dopo `T` le Server Action di Accounts rifiutano entry
  manuali su quel conto. Test: al giorno `T` il valore è uguale in pagina del servizio, Accounts e
  patrimonio netto.

La sincronizzazione crea i conti nuovi con il ciclo di vita esistente: `applyProviderAccounts` /
`reconcileProviderAccounts` (`src/modules/accounts/service.ts:594`, `rules.ts:442`), ma con
l'adozione per nome disattivata per i provider del catalogo Investments: il conto di destinazione è
quello scelto nel dialog.

### 1.4 Asset: catalogo, posizioni e perimetro

`investment_assets`: il catalogo degli asset disponibili per l'utente.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id` | uuid | |
| `class` | `stock` \| `etf` \| `fund` \| `bond` \| `crypto` \| `stablecoin` \| `cash` \| `other` | `stablecoin` non è mai `cash` (A5) |
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
| `product` | text | prodotto o sottoconto: `spot`, `funding`, `earn`, `staking`, `custody`, `other:<etichetta>` (A1) |
| `opened_on` | date | |

Unique: `(investment_account_id, asset_id, origin, product)`. Quantità, costo medio e stato
**non** sono colonne: si calcolano dalle operazioni e dagli eventi di riconciliazione a una data
(A2). Una vista `holding_state_on(d)` dà lo stato a una data; la UI usa `d = oggi`.

**Perimetro di una lettura (A1).** Ogni lettura del provider dichiara il suo perimetro in
`investment_reading_scopes` (`reading_id`, `external_account_id`, `product`, `complete` bool). Una
posizione manuale con `product = p` è **in conflitto** con una lettura solo se la lettura copre `p`
per lo stesso conto esterno. Asset uguale in un prodotto diverso (ETH spot letto, ETH Earn manuale)
non è un conflitto.

`investment_reconciliations` (A1, A2): eventi datati, mai modifiche di stato.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id`, `holding_id` | uuid | posizione manuale |
| `effective_on` | date | decorrenza |
| `kind` | `covered_by_provider` \| `outside_scope` \| `partial` \| `reopened` | |
| `quantity` | `numeric(38,18)` null | per `partial`: quantità coperta dal provider |
| `reading_id` | uuid null | lettura che ha generato il conflitto |
| `decided_at`, `note` | | |

### 1.5 Operazioni ed eventi

`investment_events` (A6): l'unità idempotente. Un evento esterno (un trade, un deposito, una riga di
ledger) o un'azione manuale. `provider_links` (E4) punta qui con `entity_type = investment_event`.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id`, `investment_account_id` | uuid | |
| `occurred_at` | timestamptz | ora del provider o dell'inserimento |
| `on` | date | giorno civile (`src/platform/dates.ts`) |
| `seq` | bigint | ordine deterministico nello stesso giorno: `(on, occurred_at, seq)` (A2) |
| `origin` | `manual` \| `provider` \| `conversion` | `conversion`: aperture create da una conversione (2.5) |
| `transfer_group_id` | uuid null | lega le due gambe di un trasferimento tra conti di Mattia (A10) |
| `transaction_id` | uuid null, unique | collegamento al movimento bancario, come oggi (`schema.ts:73`) |
| `note` | text null | |

`investment_operations`: le gambe di un evento.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id`, `event_id` | uuid | |
| `leg` | `main` \| `base` \| `quote` \| `fee` | chiave stabile della gamba dentro l'evento: unique `(event_id, leg)` |
| `holding_id` | uuid FK null | obbligatorio per le gambe che toccano un asset, compresa una fee in BNB |
| `kind` | vedi sotto | |
| `quantity` | `numeric(38,18)` null | 18 decimali: copre wei/satoshi (V8) |
| `unit_price` | `numeric(30,12)` null | nella valuta di `price_currency` |
| `price_currency` | text null | |
| `native_amount` | `numeric(30,12)` null | importo nella valuta nativa |
| `native_currency` | text null | |
| `fx_rate` | `numeric(20,10)` null | unità della valuta del conto per 1 unità nativa, usato per `amount_cents`, salvato all'inserimento |
| `fx_source` | text null | `ecb:<data>`, `exchange:<coppia>@<timestamp>`, `manual` (A5) |
| `amount_cents` | bigint | importo nella valuta del conto, segno per tipo (sotto) |
| `valid_until` | date null | solo per `adjustment` |
| `quantity_basis` | `reported` \| `reconstructed` \| `inferred` | vedi 3.2 (A6) |

`kind`:

| Kind | Effetto sulla cassa (modo `assets`) | Effetto sulla posizione | Flusso per il rendimento |
|---|---|---|---|
| `opening_cash` | = `amount` all'apertura del periodo | — | valore iniziale del periodo (A10) |
| `opening_position` | — | quantità e prezzo iniziali | valore iniziale del periodo (A10) |
| `deposit` | + `amount` | — | entrata (esterna solo senza `transfer_group_id`) |
| `withdrawal` | − `amount` | — | uscita (esterna solo senza `transfer_group_id`) |
| `buy` | − `amount` | + `quantity`, prezzo = `unit_price` | — |
| `sell` | + `amount` | − `quantity`, prezzo = `unit_price` | — |
| `valuation` | — | nuovo prezzo (o valore) dal giorno `on` | — |
| `close` | + `amount` | quantità a 0 | — |
| `income` | + `amount` (dividendo, interesse, staking) | + `quantity` se pagato in asset | — |
| `fee` | − `amount` se in cassa | − `quantity` se pagata in asset | — |
| `account_valuation` | — | valore complessivo del conto (solo modo `total`) | — |
| `adjustment` | rettifica datata (R3) | — | — |

Le commissioni sono una gamba `fee` con asset e quantità propri, non più un `fee_cents` sulla gamba
principale (A6). Le operazioni dei provider sono idempotenti sull'evento: un retry riscrive tutte le
gambe dell'evento o nessuna (E3).

**Revisioni (A2).** Un'operazione manuale non si sovrascrive: la modifica salva la versione
precedente in `investment_operation_revisions` (`operation_id`, `changed_at`, `before` jsonb,
`reason`) e ricalcola i punti dal giorno più vecchio toccato.

### 1.6 Letture del provider

`investment_readings`: cosa ha riportato il provider a ogni sync. **Non** sono `balance_entries`.

| Colonna | Tipo | Note |
|---|---|---|
| `id`, `user_id`, `investment_account_id` | uuid | |
| `on` | date | una lettura per conto e giorno: l'ultima del giorno sostituisce le precedenti |
| `observed_at` | timestamptz | ora della lettura; se il provider non dà il timestamp, ora della risposta |
| `status` | `complete` \| `partial` \| `confirmed_zero` \| `pending_zero` | (A8) |
| `total_cents` | bigint | valore totale nella valuta del conto, riportato o calcolato (R1) |
| `cash_cents` | bigint null | |
| `native_total` | `numeric(30,12)` null | |
| `fx_rate`, `fx_source` | | percorso di conversione del totale (A5) |
| `missing_prices` | int, default 0 | posizioni senza prezzo o cambio (A5) |

`investment_reading_positions` (A5): `reading_id`, `asset_id`, `product`, `quantity`, `price`,
`price_currency`, `price_at`, `price_source`, `fx_rate`, `fx_source`, `value_cents` (null se manca
prezzo o cambio). Servono alla pagina del servizio, al conflitto di perimetro (R4) e al valore del
prodotto in conflitto; il totale resta `total_cents` (R1).

`investment_sync_coverage` (A7): `connection_id`, `kind` (`flows`), `stream` (es. `deposits`,
`withdrawals`, `trades:BTC/EUR`, `ledger`), `from_at`, `to_at`, `status` (`complete` \| `partial` \|
`gap`), `reason` (es. `api_limit_24m`, `api_limit_12m` solo per lo storico dei saldi eToro [D11],
`pair_not_discovered`, `before_first_movement` per i depositi eToro [D17]). La UI e il rendimento
leggono questa tabella, non l'esito della sync.

### 1.7 Valore nel tempo

- Il valore giornaliero di un conto è una `balance_entry` con `source = 'portfolio'` [D3].
- `BALANCE_SOURCES` aggiunge `portfolio`; `SOURCE_RANK` diventa
  manual > import > **portfolio** > provider > system > derived (V2). Il CHECK
  `balance_entries_source_ck` (`schema.ts:142`) richiede una migrazione. Il rank non serve a
  risolvere conflitti sui conti gestiti: dal giorno `managed_since` lì esiste solo `portfolio`
  (1.3, A4).
- Il modulo scrive un punto per ogni giorno con un evento (operazione, lettura, riconciliazione,
  conversione, inizio o fine di una rettifica) più l'ultimo giorno di ogni mese. Tra due punti vale
  la regola `hold` esistente.
- Riscrittura: delete + insert dei punti `portfolio` del conto a partire dal giorno più vecchio
  toccato, nella stessa transazione che modifica i dati (come `rebuildDerivedBalances`). Ogni calcolo
  usa lo stato **alla data** (eventi con `on ≤ d`), mai lo stato corrente (A2).
- `rebuildDerivedBalances` ignora i conti di investimento: filtro sui conti il cui provider ha il kind
  `transactions` in `KINDS_OF` (V3).
- Nella pagina Accounts, il saldo di un conto di investimento non è modificabile a mano: il pulsante
  rimanda alla pagina del servizio.

### 1.8 Valute e cambio

[D1] Due livelli, sempre distinti:

- **Valuta del conto** (`accounts.currency`, valuta nativa del servizio). Ogni `balance_entry`, lettura
  e operazione è in questa valuta. Un saldo salvato non viene mai convertito né riscritto per un
  cambio.
- **Valuta di visualizzazione** (`user_preferences.display_currency`, default `EUR`, scelta in
  Settings → Profilo). Tutti i totali su più conti (home, patrimonio netto, bucket, Overview, home e
  KPI di Investments, snapshot, report mensile, `/api/v1/summary`, MCP `get_summary`) convertono ogni
  conto in questa valuta **al momento della lettura**. La pagina di un singolo conto o servizio mostra
  il valore nella valuta del conto e il controvalore nella valuta di visualizzazione.

**Dal prezzo dell'asset alla valuta del conto `K`** (letture ccxt e asset manuali), nell'ordine (A5):

1. il provider dà già il totale in `K` (eToro `/api/v1/balances?displayCurrency=<K>`; lo spike
   verifica i valori ammessi);
2. coppia `X/K` sull'exchange (ccxt);
3. coppia `X/USDT` (o `X/USDC`) sull'exchange, poi `USDT/K` sull'exchange; se manca, `USDT/USD`
   sull'exchange × cambio BCE USD→`K`. **Mai parità implicita** tra stablecoin e USD;
4. cambio BCE per le valute fiat.

Se nessun percorso dà un prezzo, la posizione ha `value_cents = null`, la lettura è `partial` e il
valore della posizione resta l'ultimo noto, con avviso "prezzo mancante dal …". Mai zero.

**Dalla valuta del conto alla valuta di visualizzazione `D`** (solo totali e controvalori):

```
Totale(d) = Σ conti  arrotonda( V(A,d) × Cambio(K_A → D, d) )
Cambio(K → D, d) = eur_per_unit(K, d') / eur_per_unit(D, d')   con d' = ultimo fixing ≤ d; EUR = 1
```

- Il cambio di un punto è quello del suo giorno: il valore di fine mese di marzo usa il cambio del
  31/03 (o dell'ultimo fixing prima), il valore di oggi l'ultimo fixing disponibile.
- `K = D` non richiede cambi: con tutti i conti in EUR e `D = EUR` i totali sono identici a oggi.
- Arrotondamento al centesimo per conto, poi somma (metà lontano da zero, come `src/platform/money.ts`).
- Cambio mancante (valuta fuori dalla lista BCE, `fx_rates` vuota per quel giorno): il conto resta
  fuori dalla somma e il totale è `partial`, con la stessa semantica di un conto senza saldo
  (`sumCents`). Mai 1:1.
- La valuta di visualizzazione deve essere `EUR` o una valuta pubblicata dalla BCE (lista
  Frankfurter `/currencies`). La valuta di un conto è libera (`^[A-Z]{3}$`, come oggi); fuori dalla
  lista BCE il conto compare nei totali come mancante, con avviso.
- La valuta di un conto con almeno una entry non si cambia più dalle impostazioni: cambiarla
  reinterpreterebbe tutto lo storico (oggi `settingsForSynced` la blocca solo per i conti sincronizzati).

`fx_rates` (dato di mercato, non personale, quindi senza `user_id`):

| Colonna | Tipo |
|---|---|
| `on` | date |
| `currency` | `^[A-Z]{3}$` |
| `eur_per_unit` | `numeric(20,10)` |
| `source` | `ecb` |
| `fetched_at` | timestamptz |

PK `(on, currency)`. Base sempre EUR; i cambi tra due valute non EUR passano da EUR (formula sopra).
Fonte: Frankfurter (dati BCE), un job giornaliero nel tier `daily` per tutte le valute BCE, più un
backfill una tantum dal primo `balance_entries.on` dell'istanza (serie storica Frankfurter), così
anche i punti passati hanno il cambio del loro giorno. Nei giorni senza fixing (weekend, festivi) si
usa l'ultimo cambio ≤ giorno. Le righe sono **immutabili**: un ricalcolo non cambia un cambio già
usato (A5).

**Costo e valore (A5).** Il costo di un acquisto nella valuta del conto usa il cambio del giorno
dell'acquisto, salvato sull'operazione. Il valore corrente usa il cambio del giorno della valutazione:
per gli asset manuali in una valuta diversa da quella del conto è il cambio `fx_rates` del giorno `d`,
salvato sul punto. P/L = valore − costo, entrambi nella valuta del conto, con la parte dovuta al
cambio mostrata a parte. Il controvalore nella valuta di visualizzazione è solo una conversione per la
lettura, non un secondo P/L.

## 2. Regole di valorizzazione

Notazione per il conto `A` al giorno `d`: `V(A,d)` è il valore scritto in `balance_entries`, nella
valuta del conto (1.8). Ogni termine usa gli eventi con `on ≤ d`, ordinati per `(on, occurred_at,
seq)` (A2). La conversione nella valuta di visualizzazione avviene dopo, solo nei totali.

### 2.1 Conto manuale

**Modo `assets`:**

```
V(A,d) = Cassa(A,d) + Σ ValoreAsset(h,d)   per le posizioni con quantità > 0 al giorno d

Cassa(A,d)       = opening_cash del periodo + Σ deposit − Σ withdrawal − Σ buy + Σ sell
                   + Σ close + Σ income in cassa − Σ fee in cassa         (dopo l'apertura, on ≤ d)
ValoreAsset(h,d) = Quantità(h,d) × UltimoPrezzo(h,d) × Cambio(d)
UltimoPrezzo     = prezzo dell'ultimo buy / sell / valuation / opening_position secondo l'ordine sopra
```

- Asset senza quantità (BTP o fondo registrato per controvalore) (A3): il `buy` con solo importo
  inizializza il valore a quell'importo. Da lì vale l'ultimo `amount_cents` tra `buy` e `valuation`
  ≤ d. Non serve una `valuation` dopo l'acquisto.
- Una posizione chiusa vale 0 dal giorno di chiusura; il ricavato è già in cassa.
- Cassa negativa: consentita (dati incompleti), con un avviso nella pagina del servizio.

Esempio (conto Directa in EUR, manuale, modo `assets`):

| Giorno | Operazione | Cassa | Asset | V |
|---|---|---|---|---|
| 01/03 | deposit 10.000 € | 10.000 | 0 | **10.000** |
| 02/03 | buy 100 VWCE @ 60 € + gamba fee 2 € | 3.998 | 6.000 | **9.998** |
| 30/06 | valuation VWCE @ 65 € | 3.998 | 6.500 | **10.498** |
| 15/09 | close VWCE @ 70 € + gamba fee 2 € | 10.996 | 0 | **10.996** |
| 20/09 | withdrawal 2.000 € | 8.996 | 0 | **8.996** |

**Modo `total`** (il comportamento di oggi, per chi non vuole tracciare le posizioni):

```
V(A,d) = ultima account_valuation ≤ d + flussi netti (deposit − withdrawal) dopo quella valutazione
```

È la regola di `valueOn` (`src/modules/investments/rules.ts:115`). In modo `total` il dialog
"Aggiungi asset" non c'è: la pagina propone "Passa al modo per asset", che è una conversione (2.5).
Nessuna transizione automatica al primo acquisto (A3).

### 2.2 Conto sincronizzato

```
V(A,d) = P(A,d) − C(A,d) + M(A,d) + R(A,d)
```

- **R1 · P = lettura del provider.** `P(A,d)` è `total_cents` dell'ultima `investment_readings` con
  `on ≤ d` e stato `complete`, `partial` o `confirmed_zero`. Comprende tutto il perimetro della
  lettura: cassa e posizioni. Se il provider dà solo le quantità (ccxt `fetchBalance`), Ledgerly
  calcola il totale **al momento della sync** con la regola 1.8 e lo salva nella lettura, con prezzi
  e cambi di ogni posizione.
- **R2 · M = asset manuali fuori dal perimetro.** Somma di `ValoreAsset` (formula 2.1) delle posizioni
  `origin = manual` al giorno `d`, meno la parte coperta dal provider secondo le riconciliazioni con
  `effective_on ≤ d` (`covered_by_provider` toglie tutta la posizione, `partial` toglie `quantity`).
  Su un conto sincronizzato depositi e prelievi manuali non toccano il valore: il provider li vede già
  nella sua cassa. Contano solo per il rendimento.
- **R3 · R = rettifiche datate.** Somma degli `adjustment` con `on ≤ d` e (`valid_until` null o
  `valid_until ≥ d`). Una rettifica è un delta nella valuta del conto con motivo obbligatorio. Senza
  `valid_until` vale per sempre: la pagina segnala le rettifiche aperte da più di 30 giorni.
- **R4 · Conflitto di perimetro, senza salti silenziosi (A1).** Un conflitto nasce quando una lettura
  copre il prodotto `p` (1.4) e una posizione manuale aperta ha lo stesso asset e lo stesso `p`, senza
  una riconciliazione. Finché il conflitto è aperto:
  - `C(A,d)` = valore delle posizioni del provider in conflitto (da `investment_reading_positions`),
    quindi per quell'asset e prodotto conta il dato manuale e il totale non salta;
  - la pagina mostra "Riconcilia" con tre scelte, ognuna con decorrenza (default: giorno della
    lettura): "Il provider la copre tutta" (`covered_by_provider`), "Ne copre una parte" (`partial`,
    con la quantità), "È fuori dal perimetro" (`outside_scope`: l'utente cambia `product` della
    posizione manuale).
  - Dopo la scelta `C` torna 0 per quell'asset e i punti vengono riscritti dalla decorrenza.
  Il simbolo da solo non crea mai un conflitto: serve lo stesso prodotto.
- **R5 · Letture mancanti, vuote o parziali (A8).** Esiti distinti:
  - **errore** (rete, 5xx, timeout, schema non valido): nessuna lettura, `P` resta l'ultima (hold), il
    conto diventa stale secondo `stale_after_hours` come oggi;
  - **parziale** (paginazione non completa, prodotto non letto, prezzo mancante): lettura `partial`
    salvata solo se i prodotti letti sono `complete`; per i prodotti non letti vale l'ultima lettura
    completa di quel prodotto;
  - **zero**: una risposta valida, con paginazione completa, senza saldo né posizioni. Se la lettura
    precedente valeva meno di 50 € o esiste un `withdrawal` che spiega l'uscita negli ultimi 7
    giorni, la lettura è `confirmed_zero` e conta. Altrimenti è `pending_zero`: `P` resta l'ultima, la
    pagina chiede "Il conto è stato svuotato?" e Gotify avvisa. Alla conferma la lettura passa a
    `confirmed_zero` e i punti vengono riscritti da quel giorno.
  - `holdings` e `flows` hanno esiti separati: uno storico fallito non blocca l'aggiornamento del
    valore.
- **R6 · Correzione del provider.** Se il provider rettifica un valore passato (es. storico eToro
  ricaricato), la lettura del giorno viene sostituita e i punti `portfolio` vengono riscritti da quel
  giorno. I giorni precedenti non cambiano.

Esempi numerici:

**Esempio 1 · Solo provider (eToro, conto in USD).** Valuta di visualizzazione EUR; cambio BCE
dell'esempio: 1 USD = 0,92 € il 10/11, 0,93 € l'11/11 e il 12/11.

| Giorno | Lettura eToro (USD) | M | R | V (USD, saldo) | Nei totali (EUR) |
|---|---|---|---|---|---|
| 10/11 | 12.340 | 0 | 0 | **12.340** | 11.352,80 |
| 11/11 | nessuna (errore API) | 0 | 0 | **12.340** (R5, hold) | 11.476,20 |
| 12/11 | 12.410 | 0 | 0 | **12.410** | 11.541,30 |

L'11/11 il saldo non cambia ma il controvalore sì: è l'effetto del cambio, mostrato come tale.
Un deposito manuale di 1.000 $ registrato il 12/11 entra nel rendimento, non in V: eToro lo include
già nei 12.410.

**Esempio 2 · Provider + asset manuale in un altro prodotto (Binance in EUR, spot + Simple Earn).**
L'adapter legge `spot` e `funding` (PERS-69: Earn non è in `fetchBalance`). Mattia aggiunge a mano
0,5 ETH con `product = earn`.

| Giorno | Lettura Binance (perimetro spot, funding) | Asset manuale (earn) | V |
|---|---|---|---|
| 01/12 | 3.000 € (di cui 0,1 ETH spot) | 0,5 ETH × 2.400 € = 1.200 € | **4.200** |
| 15/12 | 3.100 € | valuation 0,5 ETH × 2.600 € = 1.300 € | **4.400** |

Il 0,1 ETH spot non è un conflitto: prodotto diverso (A1). Nessun asset viene escluso.

**Esempio 2b · Il provider inizia a coprire il prodotto (conflitto e riconciliazione).**
Dal 20/12 l'adapter legge anche `earn` e riporta 0,5 ETH Earn = 1.310 €. Totale lettura 4.460 €.

| Giorno | P | C (conflitto aperto) | M | V |
|---|---|---|---|---|
| 20/12 | 4.460 | 1.310 | 1.300 | **4.450** (nessun salto, nessun doppio conteggio) |
| 21/12, Mattia sceglie "Il provider la copre tutta" dal 20/12 | 4.470 | 0 | 0 | **4.470**; il 20/12 viene riscritto a **4.460** |

Con "Ne copre una parte" (0,3 ETH coperti) resta in M lo 0,2 ETH manuale.

**Esempio 3 · Provider + rettifica (bonifico in transito).**
Il 05/11 Mattia invia 500 € a Kraken (conto in EUR); Kraken li accredita il 07/11.

| Giorno | Lettura Kraken | Rettifica | V |
|---|---|---|---|
| 05/11 | 10.000 | +500 (05/11 → 06/11, "bonifico in transito") | **10.500** |
| 06/11 | 10.020 | +500 | **10.520** |
| 07/11 | 10.530 | scaduta | **10.530** |

Senza `valid_until` la rettifica il 07/11 avrebbe contato 500 € due volte: per questo la UI propone
sempre una data di fine e segnala quelle aperte.

**Esempio 4 · Rettifica permanente (cambio sbagliato del provider, conto in EUR).**
Il provider sopravvaluta di 37 € una posizione per un cambio sbagliato: rettifica −37 € dal 03/10
senza fine. V = P − 37 finché la rettifica esiste. Dopo 30 giorni la pagina chiede di chiuderla.

**Esempio 5 · Conto svuotato (A8).**
Il 10/01 Binance vale 10.000 €. L'11/01 Mattia preleva tutto; il pass delle 22:30 riceve una risposta
valida e vuota. Il ledger dell'11/01 ha un `withdrawal` di 10.000 € → `confirmed_zero`, V = **0**.
Senza il prelievo nei flussi (es. flows falliti) → `pending_zero`, V resta **10.000** con avviso fino
alla conferma.

### 2.3 Rapporto con saldi, patrimonio netto, home e conti F1

- Il valore entra in patrimonio netto, Overview, snapshot, MCP e API tramite `accountsView` e
  `balancesOn` (V1). Nessuna somma calcolata a parte.
- **Valuta (D1, fase 1b).** `balancesOn` resta nella valuta di ogni conto. `accountsView` (serie del
  patrimonio netto, bucket, totale corrente e precedente) converte ogni conto nella valuta di
  visualizzazione con la regola di 1.8 prima di `totalSeries` e della somma dei bucket. Oggi la somma
  ignora la valuta (`queries.ts:300-311`): i conti Wallet possono già avere una valuta diversa da EUR
  (`settingsForSynced`), quindi la fase 1b chiude anche un limite esistente di Accounts F1.
- Snapshot mensile: `snapshot_runs.total_cents` è salvato nella valuta di visualizzazione del
  momento, con la nuova colonna `total_currency`. Uno snapshot passato non viene riconvertito se la
  valuta cambia: la UI mostra il suo valore con la sua valuta.
- Il tile "Investments" della home resta il bucket `investments` di `bucketOf` (investment, pension,
  crypto): ora comprende anche i conti collegati, perché sono `accounts` di quei tipi.
- I flag `in_net_worth`, `in_snapshot`, `counts_as_liquid` dei conti restano validi. Default per i
  conti di investimento: `in_net_worth = true`, `in_snapshot = true`, `counts_as_liquid = false`.
- Lo snapshot mensile legge `balancesOn(..., observed: true)`: `portfolio` è una fonte osservata, non
  è nell'elenco `NOT_OBSERVED` (`queries.ts:42`).
- MCP e API (V13): `balance` mantiene il significato "valore del conto" nella valuta del conto
  (campo `currency`, già presente), `source` può valere anche `portfolio`. I totali di
  `/api/v1/summary` e `get_summary` sono nella valuta di visualizzazione, con il nuovo campo
  `currency`. Sono valori e campi nuovi additivi: vanno scritti nel changelog dell'API.
- **Conti esistenti e piattaforme legacy [D4].** Ogni conto esistente di tipo `investment` o `crypto`
  diventa un servizio della sezione (conto manuale, modo `total`, periodo da `managed_since`). Ogni
  piattaforma legacy si unisce al conto che la rappresenta, con il passaggio di autorità di 1.3
  (A4): i suoi movimenti e le sue valutazioni diventano eventi di quel conto e il valore conta una
  sola volta. Una piattaforma senza conto corrispondente diventa un conto nuovo. La fase 0 produce
  l'elenco proposto `conto ↔ piattaforma`; Mattia conferma solo gli abbinamenti ambigui. Note sui
  dati del 27/10/2026 (lettura di sola lettura del DB):
  - l'unico conto `investment` (Fideuram) è già `valuation_account_id` di un fondo. Per il vincolo di
    1.3 non può diventare un servizio: avrebbe due scrittori (`funds` e `portfolio`). Proposta: resta
    nel modulo `funds` e compare nella sezione "Fondi" della home Investments. Spostarlo in
    Investments richiede prima di sciogliere il fondo: decisione da confermare in fase 0;
  - nessun conto `crypto` esiste, e nessun conto rappresenta le 2 piattaforme legacy (Binance,
    eToro). Diventano 2 conti nuovi (`crypto` e `investment`) e nessuna unione serve. Oggi il loro
    valore è fuori dal patrimonio netto (PERS-70: le valutazioni legacy alimentano solo l'export):
    dopo la fase 2 il patrimonio netto sale del loro valore, con un marker "migrazione" nel grafico;
  - i conti `pension` (Cometa) non sono conti di investimento ai fini di questa regola: restano in
    `funds`.
  Quando Mattia collegherà Binance o eToro, sceglierà "Usa il conto esistente" su questi conti: è la
  conversione manuale → sincronizzato (2.5).
- Fondi pensione e PAC restano in `funds`: non compaiono nel catalogo Investments. La home
  Investments li mostra in sola lettura come "Fondi" con link alla loro pagina.

### 2.4 Rendimento

Per conto e per portafoglio [D8] (A10):

- **Valuta.** Il rendimento di un conto è nella valuta del conto. Quello del portafoglio è nella
  valuta di visualizzazione: ogni flusso è convertito al cambio del giorno del flusso, il valore
  finale al cambio del giorno finale (1.8). Il rendimento del portafoglio comprende quindi l'effetto
  cambio, e la UI lo dice.
- **Periodo.** Inizia dal primo periodo con dati: il valore di apertura (`opening_cash` +
  `opening_position`, o la prima lettura del provider) è il primo flusso in entrata.
- **Flussi esterni.** `deposit` e `withdrawal` senza `transfer_group_id`. Un trasferimento tra due
  conti di Mattia ha due gambe legate dallo stesso `transfer_group_id`: per il singolo conto è un
  flusso, per il portafoglio no. La UI propone il collegamento quando un prelievo e un deposito dello
  stesso asset e quantità cadono entro 3 giorni.
- **Deduplica.** Un flusso del provider, un inserimento manuale e un movimento bancario dello stesso
  importo e periodo vengono proposti come uno solo: il collegamento a `transaction_id` e all'evento
  del provider li unisce.
- **Guadagno** = V − valore di apertura − depositi + prelievi.
- **Rendimento semplice** = guadagno / (valore di apertura + depositi).
- **XIRR** money-weighted sugli stessi flussi e sul valore finale.
- **Completezza.** Guadagno, rendimento semplice e XIRR si mostrano solo con lo storico completo:
  se `investment_sync_coverage`
  dice `complete` per i flussi del periodo, o se il conto è manuale. Altrimenti la UI mostra solo il
  valore e "dati attendibili dal <data>" (prima data da cui la copertura è completa). eToro espone
  solo i movimenti passati da eToro Money [D17 · E5]: prima del primo movimento il rendimento è
  attendibile solo dopo il collegamento ai movimenti bancari.
- XIRR senza soluzione o con più soluzioni nell'intervallo [−99%, +1000%]: "non calcolabile".

### 2.5 Conversioni di modo e di origine (A3)

Ogni conversione è un'azione esplicita al giorno `T` con invariante **V(A,T) prima = V(A,T) dopo**.
La transazione crea un nuovo periodo in `investment_account_periods` e gli eventi `origin =
conversion`; i periodi precedenti non cambiano.

| Conversione | Cosa succede al giorno `T` |
|---|---|
| `total` → `assets` | Il dialog chiede le posizioni a `T` (asset, quantità, prezzo) e calcola `opening_cash = V(T) − Σ posizioni`. Se la cassa risultante è negativa, l'utente corregge o conferma |
| `assets` → `total` | `account_valuation` a `T` = V(T) |
| manuale → sincronizzato | Collegamento del provider sul conto esistente (1.3, A4). Il primo valore è la prima lettura; la differenza con V(T−1) è visibile nel grafico come "collegamento", non come guadagno |
| sincronizzato → manuale (disconnessione) | L'ultima lettura completa diventa `opening_cash` + `opening_position` (quantità e prezzi della lettura) a `T`. Il conto resta in modo `assets` con quelle posizioni |
| riconnessione | Come manuale → sincronizzato. Le posizioni manuali esistenti entrano in conflitto R4 se lo stesso prodotto è coperto |

Esempio: conto `total` con una valutazione di 10.000 € il 01/02. Il 10/02 Mattia passa al modo
`assets` e dichiara 100 VWCE @ 60 € = 6.000 €. `opening_cash` = 4.000 €. V(10/02) = 4.000 + 6.000 =
**10.000** prima e dopo.

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
  verifyReadOnly(credentials): Promise<KeyCheck>;   // read-only | write | unknown-flag | unverifiable
  fetchHoldings(credentials, now): Promise<HoldingsSnapshot>;
  // conti esterni, perimetro letto (prodotti, complete), cassa, posizioni con prezzo e fonte,
  // totale nella valuta del conto
  fetchFlows(credentials, cursor): Promise<{
    events: ProviderEvent[];      // eventi con gambe, id esterno stabile
    cursor: FlowCursor;           // per stream: { stream, until, lastIds }
    coverage: CoverageWindow[];   // finestre lette, complete o con lacuna
  }>;
}
```

Il pass di un provider di investimento:

1. `withJobLock("investments-sync:<connectionId>")` (V9): un secondo chiamante riceve `busy`.
2. Fuori transazione: legge credenziali (`readCredentials`), chiama `verifyReadOnly` (SEC-01, dove
   `readOnlyCheck = api`), poi `fetchHoldings` e `fetchFlows`. Se `verifyReadOnly` non dà
   `read-only`, il pass si ferma prima di ogni lettura (5.2).
3. In transazioni brevi (V6): upsert della lettura del giorno con perimetro e stato (R5), upsert degli
   eventi con `linkExternal` nello stesso `tx`; il cursore e la copertura di ogni stream sono salvati
   **nella stessa transazione** dei dati (A7); ricalcolo dei punti `portfolio` dai giorni toccati.
4. `recordRun` → `finishRun` per ogni kind, con esiti separati per `holdings` e `flows` (A8); un
   `401/403` porta `markConnection(…, "revoked")`; un `429`/`418` porta `refused` con backoff che
   rispetta `Retry-After` (SEC-09).
5. Gli errori salvati e scritti in console passano dalla mappatura a allowlist di 5.1 (SEC-04).

Lo scheduler PERS-60 resta invariato: minimo 15 minuti, `busy` non avanza la schedule, errori
isolati per connessione. Default per i nuovi provider: regola `times` 07:30 e 22:30 (due letture al
giorno bastano per un valore EOD e restano lontane dai rate limit). Mattia la cambia dall'editor.
"Sincronizza ora" e "Verifica" hanno un cooldown di 60 s per connessione (SEC-09).

### 3.2 Crypto via ccxt

- Pacchetto `ccxt` pinnato a versione esatta (V11), installato con `npm ci`, in
  `serverExternalPackages` di `next.config.ts` (70 MB, fuori dal bundle) e importato in modo dinamico
  solo nel client ccxt. Dove il packaging lo permette, si importa solo la classe dell'exchange
  (`ccxt/js/src/binance.js`): lo spike della fase 0 lo verifica (SEC-06).
- Opzioni costruite in modo esplicito (SEC-03): `apiKey`, `secret` e, dove serve, `password`/`uid`;
  `enableRateLimit: true`, `timeout`, `verbose: false`. Mai `urls`, `hostname`, `*Proxy` né lo
  spread delle credenziali. L'id dell'exchange viene da `ccxtId` del catalogo.
- Un'istanza per pass, mai in cache. Niente `paginate` (sperimentale): paginazione esplicita per
  finestre.
- Exchange iniziali [D5]: Binance e Kraken in fase 4; Coinbase, Bitvavo, Crypto.com quando servono
  (stesso adapter, solo voce di catalogo e test di mapping).

Dati letti:

| Dato | Metodo ccxt | Note |
|---|---|---|
| Saldi | `fetchBalance()` per ogni prodotto in `products` | Binance: `spot`, `{ type: "funding" }` ed Earn (`sapiGetSimpleEarnFlexiblePosition`, `sapiGetSimpleEarnLockedPosition`) [D18 · B4]. Solo le quantità > 0: `fetchBalance` riempie tutte le valute a 0 (B6) |
| Perimetro | `sapiGetAssetWalletBalance` | valore in BTC di ogni wallet (Spot, Funding, Margin, Futures, Earn, Options, Trading Bots, Copy Trading): un wallet non letto con valore > 0 rende la lettura `partial` e la pagina dice quale manca [D18 · B4] |
| Prezzi | `fetchTickers()` delle coppie `X/K` (`K` = valuta del conto), poi `X/USDT` + `USDT/K` | regola 1.8, prezzo e timestamp salvati per posizione |
| Flussi | `fetchLedger` (Kraken, Coinbase, Bitvavo, Crypto.com) | cursore per stream (sotto) |
| Flussi Binance | `fetchDeposits` / `fetchWithdrawals` a finestre di 90 giorni (senza `since` si legge solo l'ultima), `fetchMyTrades` per simbolo (`since`, `limit` 1000, `fromId`) | scoperta dei simboli: sotto [D18 · B7] |
| Flussi Binance, altri stream [D18 · B2] | `sapiGetFiatOrders` (`transactionType` 0/1), `sapiGetFiatPayments` (`transactionType` 0), `sapiGetConvertTradeFlow` (finestre ≤ 30 gg), `sapiGetAssetAssetDividend` (finestre ≤ 180 gg) | stream `fiat_orders`, `fiat_payments`, `convert`, `dividends`; `timeout` ccxt ≥ 35 s per le chiamate fiat. Senza questi stream la conservazione delle quantità (A6) fallisce |
| Identità | `GET /api/v3/account` → `uid` | id del conto esterno [D18 · B7]. `canTrade`/`canWithdraw` sono capacità del conto, non permessi della chiave: mai usarli per 5.2 |

**Cursori e completezza (A7).**

- Ogni stream ha un cursore `{ until, lastIds }`. Ogni pass rilegge una finestra di sovrapposizione
  (24 h) prima di `until` e scarta gli id già visti: eventi nello stesso millisecondo o arrivati in
  ritardo non si perdono. La deduplica è sull'id esterno dell'evento.
- Scoperta delle coppie per `fetchMyTrades` (Binance): asset con saldo e asset di **tutti** gli stream
  (depositi, prelievi, dividend, convert, fiat payment) [D18 · B3], più le coppie con quote EUR, USDT,
  USDC, BTC di quegli asset.
  Un mercato comprato e venduto per intero senza depositi né prelievi non è scopribile: lo stream
  `trades` di Binance resta `partial` con motivo `pair_not_discovered`. È una lacuna dichiarata:
  nessun import di file la colma [D16].
- Lo storico oltre il limite dell'API (24 mesi [D11]) è una lacuna dichiarata (`api_limit_24m`), non
  un periodo vuoto.

**Quantità (A6).** Per un conto sincronizzato la quantità corrente di ogni posizione è quella della
lettura (`quantity_basis = reported`). Le quantità ricostruite dalle operazioni (`reconstructed`)
servono solo allo storico e al P/L. All'inizio dello storico disponibile il modulo crea per ogni
asset un `opening_position` `inferred` = quantità riportata oggi − flussi netti della finestra. Se il
risultato è negativo, la copertura dello stream è `partial` e la pagina lo segnala. Test: per ogni
asset, apertura + Σ gambe = quantità riportata.

Mappatura sugli eventi:

| Evento ccxt | Evento e gambe |
|---|---|
| deposito fiat | `deposit` nella valuta del deposito (gamba `main`), convertito nella valuta del conto se diversa |
| deposito crypto da wallet esterno | `deposit` (gamba `main`, valorizzato al cambio del giorno); proposta di `transfer_group_id` se un altro conto di Mattia ha un prelievo uguale (2.4) |
| prelievo fiat o crypto | `withdrawal` (gamba `main`) |
| trade `BTC/EUR` buy | `buy` BTC (`base`) + uscita EUR (`quote`) |
| trade `ETH/BTC` buy | `buy` ETH (`base`) + `sell` BTC (`quote`), controvalore nella valuta del conto al prezzo del trade |
| commissione del trade | gamba `fee` con asset e quantità della commissione (es. BNB) |
| ledger `reward`, `staking`, `interest` | `income` con quantità dell'asset |
| Binance fiat order (`fiat_orders`) | `deposit` / `withdrawal` in EUR [D18 · B2] |
| Binance fiat payment (`fiat_payments`) | `buy` dell'asset (`base`) + gamba `quote` in EUR |
| Binance Convert (`convert`) | evento come un trade: `buy` dell'asset ricevuto + `sell` dell'asset ceduto |
| Binance dividend (`dividends`: reward, staking, airdrop, Launchpool) | `income` con quantità dell'asset |
| ledger `transfer` interno (spot ↔ earn) | ignorato solo se entrambi i prodotti sono nel perimetro dell'adapter; altrimenti `withdrawal`/`deposit` interni con `transfer_group_id` verso la posizione manuale del prodotto |

Idempotenza: un trade è un solo evento con id esterno = id del trade; un retry riscrive tutte le
gambe o nessuna.

**Prezzi Binance [D18 · B5].** `USDT/EUR` non esiste: al passo 3 di 1.8 si usa la coppia inversa
`EUR/USDT` (prezzo = 1 / ticker). Un asset senza mercato (es. `ETHW`) ha `value_cents = null`. Polvere:
una posizione con valore stimato < 1 centesimo all'ultimo prezzo noto, o senza alcun mercato e con
quantità < 0,001, resta visibile ma non rende la lettura `partial`. I ticker Binance hanno `timestamp`.

**Conto vuoto Binance [D18 · B6].** Con sola polvere la lettura non è `confirmed_zero`.

### 3.3 Online Broker: eToro

PERS-69 non trova un aggregatore adatto a un singolo utente in UE: si parte da eToro con l'API
nativa. SnapTrade Personal è scartato: copre solo eToro, IBKR e Degiro, e su Degiro le credenziali
passano a terzi. Se in futuro si valuta un aggregatore, il design deve indicare dove transitano
credenziali e dati (regione, DPA, sub-processori), se usa OAuth del broker (accettato) o salva la
password (rifiutato), e come si revoca l'accesso (PERS-73).

- Credenziali sigillate: `api_key` (`x-api-key`) e `user_key` (`x-user-key`); `x-request-id` è un
  UUID nuovo per ogni chiamata.
- Chiave **propria di Ledgerly**, Real + Read: il rate limit è per chiave e non va condiviso con Pluto.
  In pratica la stessa coppia di chiavi funziona su demo e real e cambia solo il path `/demo/`
  (verificato in Pluto): l'adapter usa solo path real fissi, mai `/demo/`.
- **Permessi verificabili [D17 · E1].** `GET /api/v1/me` restituisce `gcid`, `realCid` e gli scope
  OAuth della chiave: eToro ha `readOnlyCheck = api` e la verifica gira a ogni pass (5.2). La conferma
  "solo lettura" del dialog non serve.
- Lettura per pass (`holdings`, sotto 60/min):

| Dato | Endpoint |
|---|---|
| Permessi e identità | `GET /api/v1/me` |
| Totale e conti nella valuta del conto (USD di default) | `GET /api/v1/balances?displayCurrency=<valuta del conto>&includeZeroBalances=true` [D17 · E7, E8] |
| Posizioni e copy trading | `GET /api/v1/trading/info/real/pnl`: lo stesso `clientPortfolio` di `/trading/info/portfolio` (`positions[]`, `mirrors[]`) con `unrealizedPnL` per posizione, che dà il valore della posizione [D17 · E3] |
| Nomi degli strumenti | `GET /api/v1/market-data/instruments?instrumentIds=…` (scope `market-data:read`), a lotti di 50; se non risponde, l'asset prende il nome dall'id e la lettura è `partial` |

- Flussi (`flows`):

| Stream | Endpoint | Paginazione |
|---|---|---|
| `trades` | `GET /api/v1/trading/info/trade/history?minDate=…` | `page`/`pageSize` ≤ 500 fino a una pagina vuota o più corta di `pageSize`; `minDate` obbligatorio; nessun limite di 1 anno [D17 · E4] |
| `deposits` | `GET /api/v1/money/accounts/cash/{accountId}/transactions` (eToro Money) | cursore `pageToken`, `pageSize` ≤ 500, `hasNext` [D17 · E5] |
| `balance_history` (solo al primo collegamento) | `GET /api/v1/balances/{accountType}/{accountId}/history` | ≤ 365 giorni per chiamata, retention 12 mesi, snapshot giornalieri fino a ieri [D11] |

- **Perimetro [D17 · E2, E6].** Un conto esterno per utente con chiave `gcid` (mai l'`accountId`, che
  cambia tra endpoint per il conto Cash). Prodotti per `accountType`: `trading` (USD), `cash` (eToro
  Money), `crypto` (un conto per coin) e `copy` (i mirror). I tipi che l'adapter non legge in
  dettaglio (`Options`, `MoneyFarm`, `Spaceship`, `Plaee`, …) entrano nel totale ma con perimetro
  `complete = false`. Le letture sono `complete` solo se totale e posizioni hanno risposto entrambi.
- **Copy trading [D17 · E3].** Le posizioni dei mirror si leggono da `mirrors[]` come prodotto `copy`;
  i trade figli (`socialTradeId`, `parentPositionId`) entrano nello storico come trade normali.
- **Depositi e prelievi in parte esposti [D17 · E5].** Lo stream `deposits` legge i movimenti di eToro
  Money: i bonifici in entrata e in uscita sono eventi `deposit`/`withdrawal`; i trasferimenti con la
  piattaforma di trading (`counterparty.name` = `eToro Trading Platform DPT`/`WDL`) sono trasferimenti
  interni tra i prodotti `cash` e `trading`. I depositi fatti direttamente sul conto Trading non ci
  sono: prima del primo movimento la copertura è `partial` (`before_first_movement`), e per quel
  periodo restano il collegamento ai movimenti bancari (il `transaction_id` di oggi) o l'inserimento
  manuale (2.4).
- **Conto vuoto [D17 · E7].** Sempre `includeZeroBalances=true`: senza, un conto vuoto e un conto
  senza conti attivi danno la stessa risposta. Lettura zero (R5) quando tutti i conti elencati hanno
  `balance = 0` e il portfolio è vuoto.
- **Valuta [D17 · E8].** `displayCurrency` accetta EUR, USD, GBP, CHF: il dialog propone solo queste
  come valuta del conto. Un codice sconosciuto dà 400 `UNSUPPORTED_DISPLAY_CURRENCY`, mappato su un
  errore fisso (5.1). Il conto eToro legacy della fase 2 è in EUR: eToro restituisce il totale in EUR
  senza conversioni lato Ledgerly.
- **Endpoint instabili e rate limit [D17 · E9].** L'adapter non usa
  `/api/v1/data/positions/closed-events/history` (503 dopo 15 s) né `/api/v1/sub-accounts/me/accounts`
  (403 con una chiave Read). Gli header `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`
  guidano il backoff (SEC-09).
- Dividendi: nessun endpoint, già inclusi nel valore. Non si creano `income`.
- L'API è beta e cambia spesso: il client valida le risposte con zod e fallisce in modo esplicito,
  senza scrivere letture parziali. Il messaggio salvato è quello fisso di 5.1, mai il dettaglio zod.
- Storico iniziale [D11, aggiornata da D17 · E4]: lo storico dei **trade** è completo (nessuna
  lacuna). Il limite di 12 mesi vale solo per lo **storico dei saldi**: prima di quella data i punti di
  valore non esistono e la copertura è una lacuna dichiarata (`api_limit_12m`).
- Termini eToro: Ledgerly salva una lettura al giorno per lo storico del valore [D10]. Il marchio
  eToro accompagna i dati nella pagina del servizio.

Prossimo broker dopo eToro: IBKR Flex Web Service (token read-only, IP restrict), fuori da questo
piano.

## 4. UI

Tutte le schermate: i18n `en` + `it`, doppia vista tabella / lista mobile con gli stessi controlli,
target ≥ 24 px, voci in `navigation.ts` e `icons.ts`, presenza in `tests/e2e/a11y.spec.ts` e
`keyboard.spec.ts` nello stesso commit che le aggiunge, con dati seed per l'utente `layout` (V12).

### 4.1 Home Investments (`/investments`)

- KPI: valore totale, versato netto, guadagno, XIRR, nella valuta di visualizzazione (1.8). Guadagno
  e XIRR solo dove la copertura è completa; altrimenti "dati attendibili dal <data>" (2.4).
- Grafico valore vs versato (36 mesi, come oggi), da `balance_entries` dei conti di investimento.
  Le conversioni e i collegamenti sono marker, non guadagni.
- Tabella dei servizi: nome, categoria, origine (manuale / sincronizzato), stato sync, ultimo
  aggiornamento, valore nella valuta del conto e controvalore nella valuta di visualizzazione,
  variazione 30 giorni, peso (sul controvalore). Avvisi: conflitto R4 aperto, `pending_zero`,
  prezzi mancanti, chiave da verificare. Ogni riga apre la pagina del servizio.
- Allocazione per classe di asset (stock, etf, crypto, …) e per servizio.
- Sezione "Fondi" in sola lettura con link a `funds`.
- Pulsante "Aggiungi servizio" → catalogo.

### 4.2 Catalogo (`/investments/catalog`)

- Tre sezioni: **Conti**, **Online Broker**, **Crypto**.
- Card per provider: nome, stato (collegato / disponibile / in arrivo), link "Apri sito" (URL del
  catalogo), azione:
  - `apikey` → dialog "Collega": guida passo passo per creare una chiave **read-only** sul servizio
    (permessi esatti da lasciare spenti per provider, 5.2), suggerimento facoltativo dell'IP whitelist
    con l'IP pubblico di uscita dell'homelab dove il servizio la supporta [D7], campi write-only,
    **conto di destinazione** ("Crea un conto nuovo", con la valuta del conto, oppure "Usa il conto
    esistente X", 1.3), verifica permessi, primo sync;
  - `manual` → dialog "Crea conto manuale" (nome, categoria, valuta del conto, modo
    `assets`/`total`, URL);
  - già collegato → "Apri" (pagina del servizio).
- Le card delle integrazioni di investimento non compaiono più in Settings → Integrazioni come card
  dedicate: Settings mostra la connessione nell'elenco con link al catalogo (E7). Schedule, test e
  sync ora riusano le Server Action esistenti; collegamento e sostituzione della chiave passano solo
  da `connectInvestmentProvider` (SEC-05, 5.3).

### 4.3 Pagina del servizio (`/investments/[accountId]`)

- Header: nome, provider, stato sync e ultima lettura (con perimetro letto), valore attuale nella
  valuta del conto con il controvalore nella valuta di visualizzazione se diversa, link
  "Apri servizio", "Sincronizza ora" (cooldown 60 s).
- KPI: valore, versato netto, prelievi, guadagno, rendimento semplice e XIRR, con la regola di
  completezza di 2.4.
- Grafico: valore nel tempo vs versato; marker su depositi, prelievi, rettifiche, conversioni e
  riconciliazioni.
- **Asset**: nome, classe, prodotto, quantità, prezzo (con data e fonte), valore, peso, P/L (con la
  parte da cambio), origine (provider / manuale). Avvisi: conflitto R4 con "Riconcilia", prezzo
  mancante. Azioni per riga manuale: Valuta, Vendi, Chiudi.
- **Operazioni**: tabella filtrabile per tipo e periodo, raggruppata per evento con le sue gambe;
  collegamento ai movimenti bancari e ai trasferimenti tra conti; cronologia delle revisioni.
- **Letture, copertura e rettifiche** (solo sincronizzati): ultime letture con stato, copertura per
  stream con lacune dichiarate, rettifiche aperte con scadenza, "Aggiungi rettifica" (delta, dal,
  al, motivo).
- **Impostazioni**: modo con conversione esplicita (2.5), flag del conto, stato della chiave
  (ultima verifica, `ip_restricted`, conferme), sostituzione chiave (5.3), disconnessione.
  Disconnettere applica la conversione sincronizzato → manuale (2.5) e mostra i passi per revocare la
  chiave presso il provider (SEC-07).

### 4.4 Inserimento manuale degli asset

Dialog "Aggiungi asset" (solo in modo `assets`, 2.1):

1. Ricerca nel catalogo `investment_assets` (combobox con filtro per classe, ricerca per nome, ISIN o
   simbolo). Se manca: "Nuovo asset" (classe, nome, ISIN/simbolo, valuta).
2. Prodotto (default `custody` per i conti manuali; sui conti sincronizzati la lista mostra quali
   prodotti il provider copre già, per evitare conflitti R4).
3. Acquisto: data, quantità e prezzo unitario **oppure** importo totale (per BTP e fondi),
   commissioni, valuta (cambio BCE verso la valuta del conto proposto, modificabile, salvato con la
   fonte).
4. Salvataggio: evento `buy` con le sue gambe + punti `portfolio` ricalcolati.

Valutazione intermedia (opzionale): data + prezzo unitario o controvalore. Chiusura: data + prezzo o
ricavato + commissioni.

## 5. Sicurezza delle credenziali

**Rischio residuo (PERS-73).** Le credenziali sono sigillate a riposo (dump e backup). Il processo
`ledgerly` che parla con ccxt ed eToro ha in memoria `APP_ENCRYPTION_KEY`, `DATABASE_URL` e i segreti
OIDC: un'esecuzione di codice nell'app legge tutte le chiavi. Per questo i controlli che contano sono
5.2 (una chiave rubata può solo leggere) e 5.4 (supply chain). Mattia ha accettato questo rischio
residuo e scartato il worker separato [D15]. Effetto combinato con [D7]: per i provider
`unverifiable` senza IP whitelist (Kraken, Bitvavo, Crypto.com; eToro non più, D17), se una chiave è
creata per errore con permessi di scrittura, chi la ruba può usarla da qualsiasi IP. La conferma
"solo lettura" è l'unico vincolo: rischio accettato da Mattia il 27/10/2026.

### 5.1 Regole

- Solo `saveConnection` / `readCredentials` con il keyring AES-256-GCM esistente
  (`src/platform/crypto.ts`, `APP_ENCRYPTION_KEY`). Nessuna tabella o chiave di cifratura nuova.
- **Unico punto di scrittura (SEC-05).** `connectInvestmentProvider(ctx, provider, credentials,
  target)` nel service: valida con lo schema strict del provider (SEC-03), esegue `verifyReadOnly` e
  una lettura di prova, poi chiama `saveConnection` e scrive `investment_key_checks`. Se il provider
  non risponde, il collegamento fallisce: per queste chiavi l'eccezione di Wallet
  (`connectWalletAction`, `actions.ts:115-133`) non vale. Un test di architettura vieta altre
  chiamate a `saveConnection` con id del catalogo Investments.
- Campi write-only nella UI: dopo il salvataggio non si rileggono mai. La UI mostra solo "chiave
  impostata il …" e l'esito dell'ultima verifica.
- Nessun segreto in log, errori, `sync_runs.error`, API, MCP, export:
  - il tipo `Connection` non contiene `credentials` (già oggi);
  - **mappatura degli errori a allowlist (SEC-04).** Oggi `syncErrorText` (`rules.ts:119`) taglia
    solo la lunghezza e `redactForLog` (`auth/logger.ts:6-11`) toglie solo query string e `params:`:
    non bastano. Per i provider di investimento si salva solo `{ provider, classe, status HTTP }`
    (classi ccxt: `AuthenticationError`, `PermissionDenied`, `RateLimitExceeded`,
    `ExchangeNotAvailable`, `RequestTimeout`, `NetworkError`, `BadResponse`; per eToro: classi
    equivalenti e `schema_mismatch`) con un testo fisso i18n. Mai `error.message`, URL, body o
    dettagli zod del provider. `console.error` riceve la stessa forma ridotta;
  - test con chiavi "canary" su tutti i rami d'errore (rete, 401, 429, zod, timeout): il test
    fallisce se il canary appare in `last_error`, `sync_runs.error` o nell'output della console;
  - l'export non include `integration_connections` né `investment_key_checks`.
- Istanze ccxt create per pass e scartate: le chiavi non restano in memoria tra un pass e l'altro.

### 5.2 Solo chiavi read-only

`verifyReadOnly` gira al collegamento, a ogni sostituzione della chiave e **a ogni pass** per i
provider con `readOnlyCheck = api` (SEC-01). La regola è un'**allowlist**: la chiave è accettata solo
se l'unico permesso attivo è la lettura. Un flag sconosciuto o nuovo è un rifiuto (`unknown-flag`).

| Provider | Verifica | Accettata solo se |
|---|---|---|
| Binance [D18 · B1] | `GET /sapi/v1/account/apiRestrictions` | `enableReading = true`; `enableFixReadOnly` può essere `true` (è un permesso di lettura); i 9 flag noti di trading, prelievo e trasferimento `false` (`enableSpotAndMarginTrading`, `enableWithdrawals`, `enableFutures`, `enableMargin`, `enableInternalTransfer`, `permitsUniversalTransfer`, `enableVanillaOptions`, `enablePortfolioMarginTrading`, `enableFixApiTrade`). Un flag `enable*`/`permits*` sconosciuto `true` → `unknown-flag`; `false` → accettato e registrato nel log. `ipRestrict = false` → avviso. Mai `canTrade`/`canWithdraw` di `GET /api/v3/account` (capacità del conto, `true` anche con una chiave read-only) |
| Coinbase (CDP) | `GET /api/v3/brokerage/key_permissions` | `can_view = true`, `can_trade`, `can_transfer`, `can_receive` `false` |
| eToro [D17 · E1] | `GET /api/v1/me` → `scopes[]` | ogni scope finisce con `:read`. Uno scope `:write` → `write`; ogni altro suffisso (es. `etoro-public:money:transfer`) → `write` anch'esso: nella fase 3 tutto ciò che non finisce con `:read` è trattato come scrittura. Lista vuota → `unknown-flag` |
| Kraken, Bitvavo, Crypto.com | nessun endpoint noto per leggere i permessi | `unverifiable`: regole sotto |

- Se una verifica durante un pass dà `write` o `unknown-flag`: connessione `refused`, nessuna lettura
  salvata, notifica Gotify con il permesso trovato. Si sblocca solo con una nuova verifica riuscita.
- Gli endpoint e i nomi dei flag sono verificati nello spike (fase 0, `investments-spike.md`) per
  Binance ed eToro con una chiamata reale e una chiave read-only; Coinbase va verificato quando
  diventa `available`. Se un endpoint non esiste più, il provider passa a `unverifiable`.
- **`unverifiable` [D7], accettate con la conferma "solo lettura", senza IP whitelist obbligatoria:**
  1. il dialog mostra i permessi esatti da lasciare accesi e spenti (Kraken: Query Funds e Query
     Ledger Entries accesi; Deposit, Withdraw, Trade spenti);
  2. conferma obbligatoria "solo lettura", salvata con data e versione del testo in
     `investment_key_checks` (`attested_read_only_at`). Senza conferma il collegamento non parte;
  3. dove il servizio la supporta (`ipWhitelist = supported`), il dialog **suggerisce** l'IP whitelist
     sull'IP pubblico di uscita dell'homelab come opzione consigliata. Se l'utente la imposta, può
     confermarlo (`attested_ip_at`); se non la imposta, il collegamento procede;
  4. Ledgerly non prova mai una chiamata di scrittura per testare i permessi, nemmeno "validate-only"
     (es. `AddOrder validate=true` di Kraken).

  **Rischio accettato da Mattia (27/10/2026, supera la raccomandazione SEC-02 di PERS-73).** Senza
  whitelist obbligatoria, una chiave `unverifiable` creata per errore con permessi di scrittura e poi
  rubata è usabile da qualsiasi IP. Restano le altre misure di questa sezione: allowlist con verifica
  a ogni pass dove l'API lo permette (Binance, Coinbase, eToro), permessi esatti nel dialog, conferma salvata,
  nessuna chiamata di scrittura di prova, revoca guidata (5.3).

### 5.3 Rotazione e revoca

- "Sostituisci chiave": passa da `connectInvestmentProvider` (nuova chiave → validazione strict →
  `verifyReadOnly` → lettura di prova → `saveConnection`). Se fallisce, la chiave vecchia resta.
- Dopo una sostituzione, una disconnessione o un `revoked` per 401/403, la UI mostra il link
  `revokeUrl` e i passi per revocare la chiave vecchia presso il provider e chiede la conferma
  "revocata" (`revoked_at_provider_at`) (SEC-07).
- Promemoria nella pagina del servizio dopo 90 giorni per tutti i provider (raccomandazione eToro,
  esteso a Binance e Kraken) o alla scadenza dichiarata dal servizio.
- Rotazione della chiave di cifratura: già coperta dal keyring (`k2:…,k1:…`).

### 5.4 Supply chain di ccxt (SEC-06)

- Versione esatta pinnata, `npm ci`, `npm audit signatures` e `npm audit` (o osv-scanner) nel gate
  della fase 4 e di ogni aggiornamento.
- Aggiornamento solo dopo almeno 7 giorni dalla release e dopo la lettura del changelog. Niente
  aggiornamenti automatici senza review.
- Import della sola classe dell'exchange dove il packaging lo permette (3.2).
- ccxt gira nel processo di Ledgerly [D15]. Il worker di sync separato (senza segreti OIDC e auth,
  con le sole credenziali della connessione) è scartato da Mattia; il rischio residuo descritto
  all'inizio della sezione 5 è accettato.

### 5.5 Esposizione via MCP e API (SEC-08)

- Nuovo scope `investments:read`, separato da `read`, in `src/platform/auth/scopes.ts`. Non concesso
  di default ai client DCR; la pagina di consenso lo nomina.
- Le risposte non contengono `last_error`, id esterni (`provider_links.external_id`), stato della
  chiave né campi delle connessioni. Un test lo verifica.

## 6. Aggiornamento automatico dei prezzi (nice to have)

**Decisione [D9]: fase 6 separata, fatta solo per ciò che si può fare bene.** Le fasi 1–5
funzionano senza prezzi automatici. Motivi:

- Per i conti sincronizzati i prezzi arrivano già dal provider (eToro, ticker degli exchange).
- Per gli asset manuali una fonte ha senso solo se la copertura è verificata sugli ISIN reali di
  Mattia: EODHD su Borsa Italiana e sui BTP non è confermato (PERS-69 §4).

Quando si fa (fase 6):

| Classe | Fonte | Note |
|---|---|---|
| Cambi | Frankfurter (BCE) | già in fase 1 (`fx_rates`) e usato dalla fase 1b |
| Crypto | CoinGecko Demo | prezzo giornaliero in EUR, portato nella valuta del conto con 1.8; attribuzione obbligatoria nella UI |
| Azioni ed ETF | EODHD | Free (20 chiamate/giorno) se bastano; €19,99/mese solo dopo un test con gli ISIN reali |
| Fondi, BTP | manuale | nessuna fonte gratuita con licenza chiara |

Regole: tabella `asset_prices` (`asset_id`, `on`, `price`, `currency`, `source`, `fetched_at`), un
prezzo di chiusura al giorno, mai intraday, righe immutabili. Un `valuation` manuale dello stesso
giorno vince sempre. Un prezzo più vecchio di 5 giorni lavorativi rende l'asset "stale" nella
pagina. `price_source = market` si attiva asset per asset.

Criterio "fare bene o non fare": la fase 6 parte solo se il test copre ≥ 90% del valore degli asset
manuali di Mattia; altrimenti resta manuale.

## 7. Piano a fasi

Rollback comune (`docs/scheduler.md:130-152`): prima del deploy tag `ledgerly:pre-<fase>` e
`ledgerly-cron:pre-<fase>` + dump `backups/ledgerly/pre-<fase>.dump`. Per tornare indietro: retag,
`docker compose up -d --no-build`, SQL inverso scritto nel doc della fase, riga cancellata da
`drizzle.__drizzle_migrations`. Gate di ogni fase: `npm run format && npm run lint && npm run
typecheck && npm run format:check && npm test`, `npm run test:integration`, `npm run e2e`.

**Regole del piano (A9).**

- Le migrazioni sono additive fino alla fase 5: un rollback non cancella mai tabelle che contengono
  scritture fatte dopo il deploy. L'immagine precedente ignora le tabelle nuove.
- Un solo percorso di scrittura per volta: nello stesso deploy che attiva il motore nuovo, la UI
  vecchia sparisce e le tabelle legacy diventano di sola lettura (trigger che rifiuta
  `INSERT`/`UPDATE`/`DELETE`).
- Tutte le regole di `V = P − C + M + R` (R1–R6, conversioni, eventi a data) entrano nella fase 2,
  prima del primo provider.

| Fase | Perimetro | Migrazioni | Test | Rollback |
|---|---|---|---|---|
| **0 · Spike** | Script usa e getta fuori dal repo, chiavi read-only reali di eToro, Binance, Kraken. Verifica: endpoint e flag dei permessi (5.2), perimetro e prodotti, risposta a conto vuoto, paginazione, prezzi mancanti, identità dei conti esterni, import per singolo exchange di ccxt, valori ammessi da `displayCurrency` di eToro (1.8). Output: fixture anonimizzate e note nel doc della fase 3/4. Elenco proposto `conto ↔ servizio/piattaforma` [D4] (2.3), con conferma di Mattia solo sugli abbinamenti ambigui (es. Fideuram, conto di un fondo) | nessuna | — | niente da ripristinare (nessun deploy) |
| **1 · Fondamenta** | Registro dei pass al posto dell'`if/else` (stesso comportamento); fonte `portfolio` in `BALANCE_SOURCES` e `SOURCE_RANK`; filtro di `rebuildDerivedBalances`; tabella `fx_rates` + job Frankfurter giornaliero per tutte le valute BCE + backfill dal primo `balance_entries.on`; `serverExternalPackages` pronto | `0035_portfolio_source_fx`: CHECK di `balance_entries.source`, tabella `fx_rates` | unit: registro, `SOURCE_RANK` con `portfolio`; itest: `jobs.itest.ts` invariato per Wallet/Trek/Paperless, `rebuildDerivedBalances` esclude i conti non Wallet; job FX e backfill con risposta finta, righe immutabili (un secondo fetch non cambia un cambio salvato) | SQL inverso: drop `fx_rates`, CHECK originale (nessuna riga `portfolio` esiste ancora) |
| **1b · Valuta di visualizzazione** [D1] (Accounts F1) | `display_currency` nelle preferenze (Settings → Profilo, default EUR, solo EUR o valute BCE); funzione pura `convertCents(cents, from, to, on, rates)` e lettura `ratesOn` da `fx_rates` (1.8); conversione per conto prima della somma in `accountsView` (serie del patrimonio netto, bucket, totale corrente e precedente), report mensile, snapshot, `/api/v1/summary`, MCP `get_summary` e home; cambio mancante → totale `partial`, mai 1:1; formattazione con la valuta al posto del simbolo `€` fisso (`src/platform/format.ts:33`, `:66`); pagina Accounts e dettaglio conto con valore nativo e controvalore; valuta di un conto con entry non più modificabile; changelog API. Nessun dato di saldo convertito o riscritto | `0036_display_currency`: `user_preferences.display_currency text not null default 'EUR'` con CHECK `^[A-Z]{3}$`; `snapshot_runs.total_currency text not null default 'EUR'` con lo stesso CHECK. Solo colonne con default, nessuna riscrittura di righe | unit: `convertCents` (identità senza cambio, cross via EUR, ultimo fixing ≤ d nel weekend, cambio mancante → `partial`, arrotondamento per conto prima della somma); formattazione per EUR, USD, GBP, CHF in `en` e `it`. itest: **non regressione**: con tutti i conti in EUR e valuta EUR, `accountsView`, bucket, snapshot, report e summary danno gli stessi valori di prima sul seed (golden); conti misti EUR + USD con valuta EUR e USD, serie mensile al cambio di fine mese; snapshot salva `total_currency`; summary API/MCP con `currency`; cambio di valuta di un conto con entry → rifiuto. e2e: cambio della valuta in Settings, home e Accounts nella nuova valuta; a11y e keyboard sul campo nuovo | retag dell'immagine; SQL inverso: drop delle due colonne (contengono solo la preferenza e la valuta dello snapshot, nessun saldo). `fx_rates` resta (fase 1). Se si torna indietro con conti non EUR, i totali tornano alla somma senza conversione di oggi |
| **2 · Motore, conti manuali e UI** (un solo deploy, A9) | Tabelle 1.3–1.6; motore puro completo (sezione 2, comprese R4 con perimetro, R5, conversioni 2.5, stato a data, revisioni); passaggio di autorità (1.3); Server Action; home, catalogo (solo provider manuali), pagina del servizio, dialog asset/valutazione/chiusura/rettifica/conversione/riconcilia; migrazione dei conti `investment`/`crypto` esistenti e delle 2 piattaforme con l'elenco confermato in fase 0 [D4]; rimozione della UI vecchia; tabelle legacy in sola lettura | `0037_investments_v2`: tabelle nuove; `investment_accounts` (periodo `total`) per i conti esistenti; ogni piattaforma unita al conto abbinato o trasformata in un `accounts` nuovo; `investment_movements` → eventi `deposit`/`withdrawal`, `investment_valuations` → `account_valuation`; archivio `investment_superseded_entries`; trigger di sola lettura sulle tabelle legacy | unit: tutte le formule ed esempi numerici della sezione 2 come casi, compresi 2b e 5; ricalcolo da `d` lascia invariati i giorni < `d`; ordinamento intragiornaliero; conversioni con invariante V prima = V dopo. itest: migrazione dati su copia seed, idempotenza dei punti `portfolio`, patrimonio netto senza doppi conteggi, uguaglianza servizio/Accounts/patrimonio al giorno di passaggio. e2e: flusso conto manuale completo; a11y e keyboard sulle schermate nuove | Retag dell'immagine + script inverso: le scritture nuove rappresentabili nel modello vecchio (eventi `deposit`/`withdrawal`, `account_valuation`) vengono copiate nelle tabelle legacy; drop del trigger; le tabelle nuove **restano** (additive) e conservano le scritture non rappresentabili (asset); le entry archiviate tornano in `balance_entries` e i punti `portfolio` vengono cancellati |
| **3 · eToro** | Adapter `etoro` (3.3, D17 prevale sul testo precedente), catalogo attivo, `connectInvestmentProvider`, dialog di collegamento con conto di destinazione e valuta del conto (USD di default; EUR, USD, GBP, CHF), verifica degli scope a ogni pass (`readOnlyCheck = api`, nessuna conferma "solo lettura" per eToro) e IP whitelist suggerita, non obbligatoria [D7], una lettura al giorno salvata [D10], storico dei saldi 12 mesi e dei trade completo [D11, D17], depositi da eToro Money, copy trading, letture con perimetro (`gcid`, prodotti per `accountType`) e stato, esiti separati `holdings`/`flows`, copertura, mappatura errori a allowlist, cooldown e backoff, revoca guidata | `0038_investment_sync`: `holdings`, `flows` in `SYNC_KINDS`, nuovi `ENTITY_TYPES`, `investment_key_checks`, `investment_sync_coverage` | unit: mapping eToro con le fixture dello spike; allowlist degli scope; errori → messaggi fissi. itest: pass con client finto, lock, `revoked` su 401, `refused` su 429, conto vuoto `confirmed_zero`/`pending_zero`, flows falliti con holdings aggiornato; canary su tutti i rami d'errore; test di architettura su `saveConnection` | disabilitare la voce di catalogo, revocare la chiave su eToro, retag; tabelle 0038 lasciate (additive), SQL inverso dei kind solo se nessuna connessione li usa |
| **4 · ccxt** | Adapter `ccxt:binance` (Kraken escluso: Mattia non ha un conto); schema strict e opzioni esplicite; verifica allowlist a ogni pass per Binance (B1); stream fiat, convert e dividend (B2); scoperta delle coppie da tutti gli stream (B3); Spot, Funding ed Earn nel perimetro con `sapiGetAssetWalletBalance` (B4); soglia della polvere (B5); prezzi nella valuta del conto con stablecoin reali; eventi con gambe e fee in asset; cursori con sovrapposizione; scoperta delle coppie; storico 24 mesi con lacune dichiarate [D11]; quantità `reported`/`inferred` | nessuna (tabelle già presenti) | unit: mapping per exchange con fixture dello spike, percorso di conversione 1.8 (USDT ≠ USD), conservazione delle quantità, idempotenza del trade completo, `httpsProxy` nelle credenziali → `invalid_credentials`, flag sconosciuto → rifiuto. itest: pass con exchange finto, finestre 90 gg Binance, eventi nello stesso millisecondo, commit atomico dati + cursore, verifica `write` durante un pass → `refused` senza lettura. build: dimensione immagine e `mem_limit`; `npm audit signatures` | rimuovere le voci di catalogo; le connessioni restano ma non hanno pass; retag |
| **5 · Esposizione e rendimento** | Rendimento con completezza e XIRR (2.4), trasferimenti interni, tool MCP `list_investments` e `get_investment_holdings`, endpoint `/api/v1/investments`, scope `investments:read`, export aggiornato, drop delle tabelle legacy | `0039_drop_legacy_investments` (dopo dump, almeno 30 giorni dopo la fase 2) | itest MCP/API: scope `investments:read` obbligatorio, nessun segreto né id esterno nelle risposte; unit XIRR (nessuna soluzione, più soluzioni) | restore delle tabelle legacy dal dump `pre-5` |
| **6 · Prezzi automatici** [D9] | Sezione 6, solo se il test copre ≥ 90% del valore degli asset manuali | `0040_asset_prices` | unit: priorità manuale > market, stale; itest con fonte finta | disattivare `price_source = market`, drop tabella |

Ogni fase è una PR separata, rilasciabile da sola. La fase 2 non dipende dai provider: Mattia può
usare i conti manuali con gli asset prima di eToro e ccxt.

**Perché la fase 1b sta tra la fase 1 e la fase 2.** Ha bisogno di `fx_rates` (fase 1) e deve esserci
prima che esista il primo conto in una valuta diversa da EUR: la fase 2 crea il conto eToro legacy
(USD) e la fase 3 i conti eToro sincronizzati. Oggi tutti i conti sono in EUR, quindi con valuta EUR
la fase 1b non cambia nessun numero: il test golden lo dimostra e il rischio del deploy è basso. È
una fase di Accounts F1, indipendente da Investments: si può rilasciare e tornare indietro da sola.

## 8. Decisioni prese

Mattia ha risposto alle 16 decisioni aperte nei commenti di PERS-68 il 27/10/2026 e ha approvato le
proposte dello spike (E1–E9, B1–B7 di `investments-spike.md`) nei commenti di PERS-79 il 28/10/2026
(D17, D18). Il documento le applica tutte.

| # | Decisione | Data | Sezioni |
|---|---|---|---|
| D1 | **Valuta nativa per conto, totali nella valuta di visualizzazione** scelta in Settings (default EUR), al cambio BCE del giorno (`fx_rates`, Frankfurter). Supera la raccomandazione "saldi sempre in EUR". Tocca Accounts F1: fase 1b | 27/10/2026 | 0.5, 1.3, 1.5, 1.6, 1.8, 2, 2.3, 2.4, 4, 7 |
| D2 | Un provider per exchange (`ccxt:binance`, `ccxt:kraken`). Limite: un solo account per exchange | 27/10/2026 | 1.2 |
| D3 | Fonte `portfolio`, unico scrittore del conto da `managed_since`, con passaggio di autorità esplicito | 27/10/2026 | 0.2, 1.3, 1.7 |
| D4 | Ogni conto esistente `investment`/`crypto` diventa un servizio; le 2 piattaforme legacy si uniscono al conto che le rappresenta, senza doppio conteggio. La fase 0 produce l'elenco proposto, Mattia conferma solo gli abbinamenti ambigui. **Nota tecnica:** l'unico conto `investment` di oggi è il conto di valutazione di un fondo e non può diventare un servizio senza sciogliere il fondo; nessun conto rappresenta le 2 piattaforme, che diventano conti nuovi (2.3) | 27/10/2026 | 2.3, 7 (fasi 0 e 2) |
| D5 | Exchange iniziali: Binance e Kraken (fase 4). Coinbase, Bitvavo, Crypto.com restano `planned` | 27/10/2026 | 1.1, 3.2 |
| D6 | Bitpanda e Young Platform rimossi dal catalogo, nemmeno come voce manuale | 27/10/2026 | 1.1 |
| D7 | Chiavi non verificabili (Kraken, eToro…) accettate con la conferma "solo lettura" salvata in `investment_key_checks`, **senza IP whitelist obbligatoria**; il dialog la suggerisce come opzione. Rischio accettato da Mattia, supera SEC-02. Restano le altre misure di 5.2 | 27/10/2026 | 1.1, 1.2, 4.2, 5, 5.2 |
| D8 | Rendimento semplice + XIRR, mostrati solo con storico completo; niente TWR | 27/10/2026 | 2.4 |
| D9 | Prezzi automatici in fase 6, solo con copertura ≥ 90% del valore degli asset manuali | 27/10/2026 | 6, 7 |
| D10 | eToro: una lettura al giorno salvata per lo storico | 27/10/2026 | 3.3 |
| D11 | Storico iniziale: eToro 12 mesi (limite API), ccxt 24 mesi, lacune dichiarate. **Aggiornata da D17 (E4, 28/10/2026):** il limite di 12 mesi resta solo per lo storico dei saldi eToro; lo storico dei trade eToro è completo | 27/10/2026, 28/10/2026 | 1.6, 3.2, 3.3 |
| D12 | Catalogo dei provider statico nel codice | 27/10/2026 | 1.1 |
| D13 | Tipi di conto `investment` (broker e conti) e `crypto` (exchange), nessun tipo nuovo | 27/10/2026 | 1.3 |
| D14 | Asset manuali nello stesso conto sincronizzato, con prodotto e riconciliazione di perimetro (R4) | 27/10/2026 | 1.4, 2.2 |
| D15 | ccxt nel processo di Ledgerly con le mitigazioni di 5.4; rischio residuo accettato, worker separato scartato | 27/10/2026 | 5, 5.4 |
| D16 | Niente import CSV: bastano i 24 mesi scaricati in automatico; le lacune restano dichiarate | 27/10/2026 | 1.5, 1.6, 3.2, 4.3, 7 |
| D17 | Proposte eToro dello spike E1–E9: scope verificabili via `/api/v1/me` (`readOnlyCheck = api`, ogni scope non `:read` è scrittura, niente conferma "solo lettura"); un conto esterno per `gcid` con prodotti `trading`/`cash`/`crypto`/`copy`, gli altri tipi `complete = false`; copy trading da `mirrors[]`; storico dei trade completo con paginazione per pagina; depositi da eToro Money con copertura `partial` prima del primo movimento; `includeZeroBalances=true` sempre; valute EUR/USD/GBP/CHF; niente endpoint instabili, backoff dagli header `ratelimit-*` | 28/10/2026 | 1.6, 2.4, 3.3, 5, 5.2, 7 |
| D18 | Proposte Binance dello spike B1–B7: allowlist esplicita dei flag (`enableFixReadOnly` ammesso, flag sconosciuto `true` → rifiuto); stream `fiat_orders`, `fiat_payments`, `convert`, `dividends`; scoperta delle coppie da tutti gli stream; perimetro Spot, Funding, Earn con `sapiGetAssetWalletBalance`; coppia inversa `EUR/USDT` e soglia della polvere; filtro delle quantità > 0; finestre di 90 gg, `fromId`, id esterno = `uid` | 28/10/2026 | 3.2, 5.2, 7 |

## 9. Esito delle review (PERS-74)

| ID | Gravità | Esito | Sezioni modificate |
|---|---|---|---|
| A1 · Identità dell'asset ≠ sovrapposizione | Critica | Accolta: perimetro per lettura (conto esterno + prodotto), conflitto solo sullo stesso prodotto, `C` mantiene il totale fino alla riconciliazione, copertura parziale per quantità | 0.3, 1.4, 1.6, 2.2 R2/R4, es. 2/2b, 4.4, D14 |
| A2 · Stato corrente ≠ storico | Alta | Accolta: stato a data da eventi, riconciliazioni con decorrenza, ordine `(on, occurred_at, seq)`, revisioni delle operazioni | 0.4, 1.4, 1.5, 1.7, 2, test fase 2 |
| A3 · Aperture e transizioni | Alta | Accolta: periodi di modo/origine, conversioni esplicite con V prima = V dopo, niente transizione al primo acquisto, regola per asset senza quantità | 1.3, 1.5, 2.1, 2.5, 4.3, 4.4 |
| A4 · Adozione per nome | Alta | Accolta: mappatura esplicita, conti già sincronizzati esclusi, passaggio di autorità atomico con archivio delle entry | 0.2, 1.3, 1.7, 2.3, 4.2, D3, D4 |
| A5 · Conversione e stablecoin | Alta | Accolta: niente parità USDT=USD, provenienza di prezzo e cambio per posizione, `fx_rates` immutabile, prezzo mancante = parziale, costo vs valore | 0.5, 1.4, 1.5, 1.6, 1.8 |
| A6 · Trade, fee, quantità | Alta | Accolta: eventi con gambe stabili, fee come gamba con asset, quantità `reported`/`reconstructed`/`inferred` con aperture | 1.2, 1.5, 3.2 |
| A7 · Completezza dei flussi | Alta | Accolta: copertura per stream, cursori con sovrapposizione e commit atomico, scoperta delle coppie, lacune dichiarate (import di file scartato, D16) | 1.6, 3.1, 3.2, D11, D16 |
| A8 · Risposte vuote | Alta | Accolta: esiti errore/parziale/zero, `confirmed_zero` vs `pending_zero`, esiti separati holdings/flows | 1.2, 1.6, 2.2 R5, es. 5, 3.1 |
| A9 · Fasi e rollback | Alta | Accolta: fase 0 spike, fase 2 unica (motore + UI + legacy in sola lettura), tutte le regole prima del primo provider, migrazioni additive, rollback che conserva le scritture | 7 |
| A10 · Rendimenti | Media | Accolta: valore di apertura, trasferimenti interni, deduplica, guadagno nascosto senza copertura, XIRR non calcolabile | 1.5, 2.4, 4.1 |
| SEC-01 · Read-only solo al collegamento | Alta | Accolta: allowlist, verifica a ogni pass, `refused` + Gotify, avviso `ipRestrict` | 0.6, 1.2, 3.1, 5.2 |
| SEC-02 · Chiavi `unverifiable` | Alta | Accolta in parte: permessi esatti, conferma "solo lettura" in `investment_key_checks`, mai chiamate di scrittura. IP whitelist solo suggerita, non obbligatoria: rischio accettato da Mattia (D7, PERS-76) | 1.1, 1.2, 4.2, 5.2, D7 |
| SEC-03 · Opzioni ccxt dalle credenziali | Media | Accolta: schema strict, opzioni esplicite, `ccxtId` dal catalogo, test `httpsProxy` | 1.1, 3.2, fase 4 |
| SEC-04 · Redazione degli errori | Media | Accolta: frase di 5.1 corretta, mappatura a allowlist, test canary | 3.1, 5.1, fase 3 |
| SEC-05 · Verifica solo nella UI | Media | Accolta: `connectInvestmentProvider` unico punto di scrittura, test di architettura | 4.2, 5.1, 5.3 |
| SEC-06 · ccxt nel processo esposto | Media | Accolta per pin, `npm ci`, audit, attesa di 7 giorni, import per exchange; worker separato scartato da Mattia, rischio residuo accettato (D15) | 3.2, 5, 5.4, D15 |
| SEC-07 · Chiave valida dopo la disconnessione | Bassa | Accolta: passi di revoca e conferma, promemoria 90 giorni per tutti | 1.1, 1.2, 4.3, 5.3 |
| SEC-08 · Scope MCP/API | Bassa | Accolta: scope `investments:read`, niente id esterni né stato chiave nelle risposte | 5.5, fase 5 |
| SEC-09 · Cooldown | Bassa | Accolta: cooldown 60 s, backoff su `429`/`418` con `Retry-After` | 3.1, 4.3 |

Alternative di PERS-72: "primo rilascio solo manuale + snapshot provider" è coperta dalla regola di
completezza (2.4) e dall'ordine delle fasi; "asset esterni in un conto separato" è la D14 (b);
"import di file per lo storico" è scartata (D16).

Fuori perimetro del design, segnalati da PERS-73: `ledgerly-cron` riceve tutto `.env.homelab`
(gli serve solo `CRON_SECRET`); `seal` non lega il blob alla riga (AAD senza `user_id` /
`connection_id`). Da trattare in issue separate.
