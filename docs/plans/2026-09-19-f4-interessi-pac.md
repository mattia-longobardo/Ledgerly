# F4 — Interessi e PAC

> Piano eseguito **in linea**, lotto dopo lotto, come F2.5 e F3. Chi lo riprende in mano non ha il
> contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — §4.2–4.3, §6 (righe interessi e fondi), §7.1
   (patrimonio, saldi ricostruiti, eliminazione dei conti), §7.4 (interessi del conto di appoggio),
   **§7.6**, **§7.7 parte PAC**, §8, §9.1 (Wallet, pubblicazione degli interessi), §10, §11, §12.
   **La spec vince sul piano.**
3. `docs/plans/2026-09-19-f3-budget-pockets-abbonamenti.md` §8–9 — cosa esiste e cosa è cambiato.
4. `src/modules/pockets/` e `src/modules/subscriptions/` come modello di modulo recente.
5. Il design (`UI Recreation and branding decisions/Finance Dashboard.dc.html`, sola lettura):
   Interests 602–615 e modale della regola 1071–1086; Funds 457–486; Fund detail 487–600 (Overview
   495–534, Deposits 551–564, Valuations 567–576, Settings 578–598); modali Fund settings 1113–1122
   e Valuation 1123–1131; dati `data.js` (`INTEREST_RULES` 105, `FUNDS` 59, `FUND_VALUATIONS` 66,
   `FID_DEPOSITS` 195).
6. Riferimento della versione precedente, **solo da leggere, mai da copiare** (D16):
   `git show origin/main:dashboard-app/src/modules/interests/domain/accrual.ts`,
   `…/domain/reconciliation.ts`, `…/infrastructure/wallet-interest-posting-adapter.ts`,
   `…/src/lib/clients/wallet.ts` (`postRecords`, `findPostedRecord`).

## 1. Obiettivo

F4 secondo §12: **§7.6 per intero; la parte PAC di §7.7; la lista Funds e la struttura di Fund
detail** (le quattro schede, con quello che F6 aggiungerà al fondo pensione). Con i riflessi già
promessi: "Interessi sul conto di appoggio" dei pocket (§7.4, `null` da F3) e la riga "Interest
rule" di Account detail.

Fuori perimetro: fondo pensione e Cometa (F6), importazioni (F5), `/api/v1` (F8), email di avviso.

## 2. Punto di partenza (2026-09-19)

- Branch `dev-0.1`, F3 consegnata ma **non committata** (il proprietario decide i commit): F4 parte
  sopra quell'albero. Ultima migrazione `0007_budget_accounts`.
- Nessun server di sviluppo: ogni lotto si verifica su `https://dash.longobardo.me`, e2e con
  utenti `@example.test`.

### Cosa esiste già e va riusato

| Serve a | Dove |
|---|---|
| Saldo di un conto giorno per giorno (letture + movimenti; manuale tenuto fra due saldi) | `accounts/service.ts` → `dailyBalancesOf` |
| Ultimo saldo a una data | `accounts/queries.ts` → `balancesOn` |
| Saldo manuale (scrittura, cancellazione, ricostruzione dei `derived`) | `accounts/service.ts` → `saveBalanceEntry`, `deleteBalanceEntry` |
| Impostazioni del conto (patrimonio, snapshot, hold/interpolate, promemoria) | `accounts/service.ts` → `updateAccountSettings` |
| Conto referenziato → archiviato | FK `on delete no action` + `removeAccount` (F3) |
| Client Wallet, id Wallet dei conti | `platform/integrations/wallet/client.ts` (`WRITE_ATTEMPTS = 1` già definito, nessuna scrittura ancora); `accounts.provider_account_id` |
| Id esterni | `platform/integrations/service.ts` → `linkExternal`, `resolveExternal` (`provider_links`) |
| Movimenti candidati | `transactions/queries.ts` → `chargeCandidates` (F3) |
| Job dopo `wallet-sync`, per utente | `platform/jobs/registry.ts` (ordine = esecuzione), `modules/users/jobs.ts` → `forEachUser` |
| Grafici | `src/ui/chart.tsx` → `AreaLine`, `Bars`, `MiniBars`; `NetWorthCard` come modello di card |
| Formati | `platform/format.ts` → `formatWholePercent`, `formatAmountInput`, `formatPercent` |

## 3. Contratti decisi in anticipo

### 3.1 Collocazione

```
src/modules/interests/  schema.ts rules.ts service.ts queries.ts actions.ts jobs.ts ui/
src/modules/funds/      schema.ts rules.ts service.ts queries.ts actions.ts jobs.ts ui/
src/platform/integrations/wallet/client.ts   + createRecord, recordsWithNote (scrittura, 1 tentativo)
src/app/(app)/interests/  interests/[id]/  funds/  funds/[id]/
```

### 3.2 Tabelle — una migrazione `drizzle/0008_interests_funds.sql`

Colonne comuni come sempre (`id` uuidv7, `user_id` cascade, `created_at`, `updated_at`). Tassi e
aliquote `numeric(10,6)` come frazioni, stringhe decimali in TypeScript (§4.3). FK verso `accounts`
sempre `on delete no action` (il conto si archivia, F3).

**`interest_rules`** (§6, §7.6)
- `account_id`; `tax_rate` default `0.26` (0–1); `day_basis` `365 | 360`;
- `settlement` `monthly | quarterly | annual`; `valid_from date`, `valid_to date` null,
  CHECK `valid_to >= valid_from`;
- `mode` `analyze_only | post_to_provider`, default `analyze_only`; `state` `active | paused`;
- `payee_match text` null — **nuova**, §3.6.1: come riconoscere l'interesse pagato dalla banca.

**`interest_rule_tiers`** — `rule_id` cascade, `position smallint` (0, 1, …), `up_to_cents bigint`
null solo sull'ultimo (CHECK con un indice parziale: un solo `null` per regola), `annual_rate`
`numeric(10,6)` ≥ 0; UNIQUE `(rule_id, position)`.

**`interest_accruals`** — una riga per regola e giorno:
- `on date`, UNIQUE `(rule_id, on)`;
- `balance_cents` null (saldo sconosciuto quel giorno);
- `gross numeric(24,12)`, `net_cents bigint`, `carry numeric(24,12)` (il resto);
- `status` `accrued | negative_balance | no_balance` (i giorni saltati sono visibili, §7.6);
- `entry_id` FK `interest_entries` null: la liquidazione in cui è finita.

**`interest_entries`** — la liquidazione di un periodo (§7.6 "Liquidazione"):
- `rule_id`, `period_from`, `period_to`, `settle_on` (il giorno dopo la fine), UNIQUE
  `(rule_id, period_from)`;
- `gross_cents`, `tax_cents`, `net_cents`;
- `posting` `none | claimed | posted | indeterminate` (`none` in `analyze_only`), `posted_at`,
  `posting_error`. L'id del record Wallet sta in `provider_links` (`entity_type =
  "interest_entry"`, §4.3), non qui.

**`funds`** (§6, §7.7)
- `name`, `type` `pac | pension` (in F4 si crea solo `pac`: §3.6.10), `provider`, `isin` null
  (CHECK formato), `compartment` null;
- `valuation_account_id` NOT NULL UNIQUE (il conto dove sta il valore, §7.7);
- `debit_account_id` null, `debit_day smallint` null (1–31), `ter numeric(10,6)` null;
- `start_on date`, `state` `active | archived`;
- **nuove, dal design** (§3.6.4): `monthly_cents` null (l'importo addebitato ogni mese),
  `deposit_fee_cents` null (la commissione fissa per versamento).

**`fund_valuations`** — `fund_id` cascade, `balance_entry_id` FK `balance_entries` **cascade**
UNIQUE, `units numeric(18,6)` null, `note` null, `source` `manual | import`. **Il valore non si
ripete qui** (§3.6.3): sta nel saldo del conto di valorizzazione, una sola fonte (§4.3, §7.7).

**`fund_deposits`** — `fund_id` cascade, `on date`, `charged_cents` > 0, `fee_cents` ≥ 0 null
(sconosciuta), `invested_cents` **generata** `charged − fee` (null se la commissione è
sconosciuta), `transaction_id` FK `transactions` `set null` UNIQUE, `source` `manual | rule`.

**`fund_deposit_rules`** — `fund_id` cascade UNIQUE (una per fondo), `payee_match text`,
`account_id` null (qualunque conto), `active boolean`.

### 3.3 Firme

```ts
// modules/interests/rules.ts — puri, in virgola fissa (bigint, scala 1e12), mai float
grossOfDay(balance: Cents, tiers: Tier[], basis: 365 | 360): Fixed          // per scaglione, poi somma
accrueDay(input: { balance: Cents | null; tiers; basis; taxRate: string; carryBefore: Fixed | null }):
  { status; grossFixed; netCents; carryAfter }                              // §7.6, half-up, mai < 0
settlementPeriods(frequency, from: CivilDate, to: CivilDate): { from; to; settleOn }[]
reconcile(accruedNet: Cents | null, paidNet: Cents | null, flags): ReconciliationStatus
validateRule(input): …                                                      // rifiuta, mai ignora

// modules/interests/service.ts
createRule, updateRule, setRuleState
accrueRule(ctx, ruleId, through: CivilDate)      // da valid_from o dall'ultimo giorno, ricostruendo i periodi non liquidati
settleDue(ctx, today)                            // scrive le liquidazioni dei periodi chiusi
postEntry(ctx, entryId)                          // "prenota", cerca il marcatore, POST, esito — rete fuori transazione
markPosted(ctx, entryId) / retryPosting(ctx, entryId)
accruedInterest(ctx, accountId, from, to): Promise<Cents | null>   // per i pocket (§7.4)

// modules/funds/service.ts
createFund(ctx, input)  // crea o collega il conto di valorizzazione
updateFund, archiveFund
recordValuation(ctx, fundId, { on, cents, units?, note? })  // saveBalanceEntry + fund_valuations
updateValuation, deleteValuation
addDeposit, updateDeposit, deleteDeposit
saveDepositRule(ctx, fundId, input), matchDeposits(ctx, fundIds?)
// modules/funds/rules.ts — puri
fundMetrics(deposits, valueCents): { paidIn; fees; invested; value; gain; gainFraction }
simpleDietz(vPrev, v, flows): number | null ; monthlyReturns(monthEnds, depositsByMonth)
```

### 3.4 Regole sottili, decise qui una volta sola

1. **Saldo del giorno** = `dailyBalancesOf` del conto (sincronizzato: letture e movimenti; manuale:
   tenuto fra due saldi). `null` → giorno `no_balance`; negativo → `negative_balance`. Entrambi senza
   interesse, visibili, **senza recupero** e senza resto (§7.6: il resto si usa solo se la
   maturazione precedente è del giorno prima).
2. **Scaglioni**: il primo tasso fino alla soglia, il successivo sulla parte eccedente, fino
   all'ultimo senza soglia. Lordo = somma dei lordi di scaglione in virgola fissa; netto =
   lordo × (1 − aliquota) + resto; arrotondamento half-up al centesimo; mai negativo.
3. **Fino a quando si matura**: fino a ieri (il saldo di oggi non è chiuso), dal `valid_from`, al più
   fino a `valid_to`. **Recupero dei giorni mancanti** se il job non è girato (backfill ordinato: il
   resto resta coerente). **Modificare una regola** ricalcola le maturazioni dal primo periodo **non
   ancora liquidato**; i periodi liquidati restano come sono (il design: "accrual recalculated from
   the start date" → §3.6.9).
4. **Liquidazione**: a periodo di calendario chiuso (mese, trimestre, anno) si scrive
   `interest_entries` con la somma dei netti; la "Next payout" è il `settle_on` del periodo in corso.
5. **Riconciliazione** di una liquidazione (su lettura): `no_data` senza maturazioni; `indeterminate`
   se la pubblicazione è incerta; altrimenti il pagato del periodo (§3.6.1) contro il maturato:
   `matched` (|differenza| ≤ 1 cent), `missing` (nulla pagato), `delayed` (pagato meno del maturato e
   la finestra di tolleranza non è chiusa…), `anomalous` (pagato più del maturato, o pagato senza
   maturato). La finestra del pagato: dal `settle_on` a `settle_on + 10 giorni` (§3.6.1).
6. **Pubblicazione su Wallet** (§7.6, §9.1), solo in `post_to_provider` e solo per netto > 0:
   (a) in una transazione breve la liquidazione passa a `claimed`; (b) fuori da ogni transazione si
   cercano i record del conto Wallet nel giorno di `settle_on` con il marcatore
   `ledgerly-interest:<entryId>` nella nota — se c'è, si collega e basta; (c) altrimenti un POST, un
   solo tentativo; (d) esito → `posted` (+ `provider_links`) oppure `indeterminate` con l'errore.
   `indeterminate` **non si ripete da solo**: la pagina offre "Riprova" (rifà b–d) e "Segna come
   pubblicato". Il movimento pubblicato torna con la sincronizzazione come entrata: è giusto così
   (il saldo Wallet lo contiene).
7. **Valore del fondo** = saldo del conto di valorizzazione (`balancesOn`); registrare una
   valorizzazione scrive un saldo `manual` in quella data (vince su tutto, §7.1) e la riga di
   `fund_valuations` con quote e nota, in una transazione. Cancellare il saldo da Account detail porta
   via la valorizzazione (cascade): nessuna seconda verità.
8. **Metriche PAC**: versato = Σ addebitato; commissioni = Σ commissioni note; investito = Σ investito
   (parziale se una commissione è sconosciuta: detto, non nascosto); guadagno = valore − **versato**,
   % = guadagno ÷ versato (§3.6.5). Rendimento mensile Simple Dietz `(V − Vprec − F) / (Vprec + F)`
   con V = valore a fine mese (serie tenuta del conto), F = addebitato nel mese; `null` se manca un
   estremo. Migliore, peggiore, mesi positivi sui 12 mesi con valore; "Ultimi 12 mesi" **composto**
   (∏(1+r) − 1) (§3.6.11).
9. **Abbinamento dei versamenti** (regola attiva): movimenti `expense` o `transfer` negativi, visibili,
   sul conto della regola (qualunque se nullo), dal `start_on` del fondo, con il beneficiario che
   contiene il testo (senza spazi né maiuscole, come gli abbonamenti), non già collegati → versamento
   `rule` con addebitato = |importo|, commissione = `deposit_fee_cents` del fondo (null se non
   impostata). Idempotente (UNIQUE `transaction_id`); un versamento modificato a mano non si tocca
   più. Gira dopo `wallet-sync`, dopo "Sync now" e al salvataggio della regola.
10. **Interessi del conto di appoggio** (§7.4): Σ netti maturati dal conto negli ultimi 12 mesi ×
    (saldo del pocket ÷ saldo del conto), "stima"; `null` se il conto non ha regole, non ha saldo o
    il saldo è ≤ 0; `standalone` resta `null`.

### 3.5 Pubblicazione su Wallet: rischio dichiarato

Il POST dei record di Wallet **non è mai stato verificato** con un token vero, nemmeno su `main`
(il suo client lo dice). Quindi: la modalità predefinita è `analyze_only`; il client accetta per la
risposta sia `{ records: [...] }` sia un array; un esito illeggibile è `indeterminate`, mai
"riuscito"; il primo POST vero si fa **insieme al proprietario**, su una regola scelta da lui, prima
di dichiarare chiuso il lotto L2 (§7).

### 3.6 Dove spec, design e codice divergono — proposte da confermare

1. **Come si riconosce l'interesse pagato dalla banca** (per `matched/missing/delayed`): né la spec
   né il design lo dicono. → campo della regola "Il beneficiario o la categoria contiene" (es.
   "interessi", "interest"), cercato fra le **entrate** del conto nella finestra `settle_on … +10
   giorni`; in `post_to_provider` il pagato è la liquidazione pubblicata stessa. Senza testo, la
   riconciliazione dice `no_data`.
2. **Modale della regola**: il design ha "Basis: Daily balance / Monthly average / Quarterly
   average", un'ora di inizio, e niente data di fine, 365/360, modalità di pubblicazione. → spec:
   solo saldo giornaliero (le medie sono impostazioni non supportate, §7.6 "rifiutate, mai
   ignorate"); niente ora; aggiunti "Valida fino al", "Base giorni 365/360", "Pubblica su Wallet".
3. **Valore della valorizzazione** solo nel saldo del conto (§3.4.7), non ripetuto in
   `fund_valuations` come dice §6. Il campo "Deposited to date" della modale del design si **ricava**
   dai versamenti invece di chiederlo.
4. **Campi del fondo dal design** che §6 non ha: importo mensile e **commissione per versamento**
   (senza, un versamento abbinato avrebbe l'investito sconosciuto). → due colonne. Il "capitale
   iniziale" del design diventa il primo versamento (manuale, alla data d'inizio), non un campo.
5. **Base del guadagno**: il design scrive "on invested" nel dettaglio e "gain ÷ paid in" nella
   lista. → versato (le commissioni sono un costo); l'investito resta un KPI a sé, con le commissioni.
6. **Opzioni del design senza fondamento in spec** che non si fanno: "Valuation source: Provider
   sync · daily" (nessun provider di valori in F4), "Also record the expense on the paying account"
   (i movimenti vengono solo da Wallet, §7.2), tolleranza e "Invested amount: ask each time" della
   regola, "Expense category: Exclude from spending".
7. **Avviso "versamento non trovato"** (banner del design sulla lista): → in app, come gli
   abbonamenti: fondo attivo con regola attiva, `debit_day + 3` passato nel mese, nessun versamento
   nel mese. Niente email.
8. **Impostazioni "Valuations" della scheda Settings** (promemoria, hold/interpolate, patrimonio,
   snapshot) sono già del conto di valorizzazione (§7.1): la scheda le scrive lì, niente copie.
9. **Ricalcolo dopo una modifica della regola**: dal primo periodo non liquidato (§3.4.3), non "dalla
   data di inizio" come il toast del design: i periodi liquidati (magari pubblicati su Wallet) non
   cambiano sotto i piedi.
10. **Fondi pensione**: il tipo esiste nello schema; in F4 si crea solo `pac` (la scheda "Contributions"
    e il resto arrivano con F6). La lista mostra le colonne PAC; quelle pensione (azienda, TFR)
    arrivano con F6.
11. **"Last 12 months"**: il design somma i rendimenti mensili; → composto, con l'etichetta che lo dice.
12. **Dove si vede il dettaglio di una regola**: il design ha solo la tabella. → pagina
    `/interests/[id]` con le liquidazioni (stato di riconciliazione, pubblicazione, "Riprova") e il
    registro giornaliero (giorni saltati compresi); la riga della tabella porta lì, "Edit" apre la
    modale.

## 4. Lotti

```
L0 fondamenta ── L1 Interessi: maturazione e liquidazione ── L2 Pubblicazione su Wallet
             └── L3 Fondi: fondi, valorizzazioni, versamenti ── L4 Regola dei versamenti, riflessi, chiusura
```

Ogni lotto: test prima (unit per `rules.ts`, integrazione per servizi e query con **isolamento fra
utenti per ogni tabella nuova**, e2e a 1440 e 400 px), cancello (§5), deploy, e2e sul sito.

### L0 — Fondamenta
Schemi, migrazione `0008` (drizzle-kit; due passaggi se chiede una rinomina), `tables.ts`; voci
Funds (`TrendingUp`) e Interests (`Percent`) dopo Budgets, come nel design; registro dei job; test
dei CHECK (scaglioni, date, ISIN, commissione ≥ 0, investito generato) e di `removeAccount` che
archivia un conto con una regola o un fondo.

### L1 — Interessi: maturazione e liquidazione (§7.6, senza pubblicazione)
- `rules.ts`: virgola fissa, scaglioni, `accrueDay`, periodi, riconciliazione, validazione.
  **Test**: esempi a mano (1 giorno, 365 vs 360, due scaglioni al confine, aliquota 0 e 26 %, resto
  che fa scattare un centesimo, saldo negativo, saldo sconosciuto, resto non usato dopo un buco);
  riconciliazione ai confini (1 cent sì, 2 cent no).
- `service.ts`: regole, `accrueRule` (backfill, rilancio sicuro nello stesso giorno), `settleDue`.
- Job `interests-accrual`, tier `daily` (12:00, §10.2).
- Pagine: `/interests` come il design (tabella con scaglioni, "Accrued YTD", "Next payout", stato,
  footer), modale (§3.6.2), `/interests/[id]` (§3.6.12). Account detail: riga "Interest rule" con
  "Manage".
- **Test** d'integrazione: backfill da `valid_from`, idempotenza, ricalcolo dopo una modifica che
  non tocca i periodi liquidati, periodi `no_data`, isolamento. e2e: crea regola a due scaglioni su
  un conto con saldi seminati, controlla l'importo maturato di un periodo calcolato a mano.

### L2 — Pubblicazione su Wallet (§3.4.6, §3.5)
- Client: `createRecord` (1 tentativo, importo dalla stringa decimale), `recordsWithNote` (lettura con
  i 5 tentativi); fixture sintetiche per le due forme di risposta.
- `postEntry`, `retryPosting`, `markPosted`; job: dopo `settleDue`, le liquidazioni `none` delle
  regole `post_to_provider`.
- **Test**: con `fetch` finto — marcatore già presente (nessun POST), POST riuscito, POST fallito →
  `indeterminate` e nessun secondo POST al passaggio dopo, risposta illeggibile → `indeterminate`;
  integrazione della prenotazione (due esecuzioni insieme non pubblicano due volte).
- **Collaudo con il proprietario** (§7) prima di chiudere il lotto.

### L3 — Fondi: fondi, valorizzazioni, versamenti (§7.7 PAC)
- `rules.ts`: metriche, Simple Dietz, rendimenti mensili, composto. **Test** con i numeri del design
  (5.000 + 250/mese, commissione 1 €).
- `service.ts`: fondo con conto di valorizzazione (nuovo `investment` manuale, oppure uno esistente
  manuale non già usato), valorizzazioni (§3.4.7), versamenti manuali, archiviazione.
- Pagine: `/funds` (KPI, grafico "Combined value vs paid in", tabella con "This month", totale),
  `/funds/[id]` con le schede Overview · Deposits · Valuations · Settings come il design, modali
  "New fund" / "Fund settings" e "Record valuation".
- **Test** d'integrazione: la valorizzazione è un saldo del conto (patrimonio e Overview la vedono),
  cancellarla da Account detail la toglie dal fondo, metriche, isolamento. e2e: crea un PAC, due
  versamenti, due valorizzazioni, controlla guadagno e rendimento del mese.

### L4 — Regola dei versamenti, riflessi, chiusura
- `fund_deposit_rules`, `matchDeposits` (§3.4.9), job `funds-deposits` hourly dopo `wallet-sync`,
  hook in "Sync now"; card "Linked expense rule" e sezione di Settings; avviso §3.6.7.
- Pocket: "Interest earned on backing" (§3.4.10). ⌘K: fondi e regole per nome. Mobile: liste al
  posto delle tabelle, foglio "More".
- Documentazione: README, spec (righe *(F4)* per le decisioni di §3.6), esito del piano.

## 5. Cancello

```
npm run format && npm run lint && npm run typecheck && npm run format:check && npm test && npm run test:integration
docker compose build && docker compose up -d && curl -fsS https://dash.longobardo.me/api/health
npm run e2e
```
In più alla fine: `db:generate` → "No schema changes"; `src/ui` senza `next-intl` né `@/modules/`.

## 6. Fatto quando

- §7.6 e la parte PAC di §7.7 hanno codice e test; ogni decisione di §3.6 confermata è una riga
  *(F4)* della spec.
- Il cancello è verde su ogni lotto; il sito mostra Interests, la regola, Funds e il PAC.

## 7. Resta al proprietario

- Confermare §3.6 (soprattutto 1, 3, 4, 5).
- **Il primo POST vero su Wallet** (L2): scegliere il conto e la regola su cui provarlo, e guardare
  in Wallet che il record sia giusto.
- I commit (di F3 e di F4).

## 8. Esito (2026-09-19)

Il proprietario ha confermato il piano com'era, §3.6 compreso. Consegnati L0, L1, L3, L4 e la parte
di codice di L2; resta il collaudo del primo POST vero su Wallet (§8.4). Sull'ultimo stato:

| Controllo | Esito |
|---|---|
| `format`, `lint`, `typecheck`, `format:check` | verdi |
| `npm test` | 821/821 (base 796) |
| `npm run test:integration` | 284/284 (base 256) |
| deploy + `/api/health` | `ok`; `0008_interests_funds` e `0009_provider_link_interest_entry` applicate |
| `npm run e2e` sul sito | 33/33: `interests`, `funds` e i due passi a 400 px nuovi |

### 8.1 Contratti cambiati in corsa

1. **Migrazione `0009`**: `interest_entry` fra gli `entity_type` di `provider_links` (il CHECK li
   elenca), per l'id del record Wallet di una liquidazione pubblicata.
2. **`chargeCandidates`** accetta i tipi (`expense` di default, anche `transfer` per i versamenti
   PAC) e prende solo movimenti negativi. `incomeCandidates` nuova, per il pagato degli interessi.
3. **La scheda Settings del fondo, sezione Valorizzazioni**, porta alle impostazioni del conto di
   valorizzazione invece di copiarne i campi (§3.6.8 diceva "le scrive lì"): una sola maschera.
4. **Un versamento abbinato non si cancella** (`linked`): la regola lo ricreerebbe; si nasconde il
   movimento in Spese.
5. Il capitale iniziale è un versamento con commissione 0.
6. Pocket: `interestReason` guadagna `estimate`.

### 8.2 Difetti trovati verificando

1. **Si liquidava il mese in corso**: `settleDue` tagliava i periodi a ieri, quindi il periodo in
   corso "finiva" ieri e scadeva oggi. Lo ha visto l'e2e; il test d'integrazione passava a vuoto
   (pending 0 × 2 = 0). Ora i periodi si tagliano solo con la fine della regola, e il test afferma
   che nessuna liquidazione cade nel mese corrente — verificato che fallisce senza la correzione.
2. Il catalogo rifiuta i messaggi vuoti: due chiavi segnaposto tolte.
3. `jobs.itest.ts` elenca i job del livello `daily`: aggiornato.
4. Un'aspettativa sbagliata nel test degli interessi dei pocket (364 giorni maturati, non 365: oggi
   non è ancora maturato).

### 8.3 Deviazioni consapevoli

- Il grafico del fondo con una sola valorizzazione è un punto: la linea del valore compare dalla
  seconda.
- Fondo pensione: solo il tipo nello schema; la creazione e le colonne pensione sono di F6.
- La palette cerca i fondi; le regole di interesse no (non hanno un nome).

### 8.4 Resta al proprietario

- **Il primo POST vero su Wallet** (L2, §3.5): scegliere un conto sincronizzato e una regola,
  attivare "Pubblica ogni liquidazione su Wallet", e dalla pagina della regola usare "Pubblica ora"
  su una liquidazione chiusa; poi guardare in Wallet che il record ci sia, con importo, data e nota
  giusti. Se l'esito è "Incerta", controllare Wallet e usare "Riprova" o "Segna come pubblicata".
- I commit (di F3 e di F4) e la revisione di fase.

## 9. Modifica chiesta dopo la consegna (2026-09-19)

**Liquidazione giornaliera.** `SETTLEMENTS` guadagna `daily` (migrazione
`0010_interest_daily_settlement.sql`, solo il CHECK): il periodo è il giorno stesso, liquidato il
giorno dopo. Perché le finestre di pagamento, ora sovrapposte ogni giorno, non contino due volte lo
stesso pagamento, il riscontro legge le entrate una volta sola e le assegna in ordine di data
(`assignPayments`): una liquidazione di periodo prende i pagamenti della sua finestra non già presi,
una giornaliera il primo della sua finestra (dal giorno ai due successivi). La pagina della regola
mostra le ultime 90 liquidazioni.

## 10. Modifica chiesta dopo la consegna (2026-09-20)

**L'ora in cui gira una regola.** `interest_rules` guadagna `run_hour smallint null` (migrazione
`0013_preferences_and_interest_hour.sql`, con il CHECK 0–23): `null` vuol dire mezzogiorno, cioè
quello che l'app faceva finora. Il job `interests-accrual` passa dal livello **giornaliero** a quello
**orario** e a ogni passaggio tratta solo le regole la cui ora effettiva (`run_hour ?? 12`) coincide
con l'ora dell'orologio **nel fuso dell'utente**, mai in quello del server; la maturazione resta una
per regola e per giorno (unico `(rule_id, on)`), quindi un passaggio in più non matura due volte.
`postPending` gira ora solo nei passaggi in cui qualcosa è maturato, non una volta al giorno a vuoto.

Due frasi della specifica restano da aggiornare, e sono **del proprietario**, quindi non le ho
riscritte io:

- **§10.2** elenca la maturazione degli interessi sotto «Ogni giorno alle 12:00»: ora è oraria.
- **§7.6** dice «Il design non ha medie mensili o trimestrali né un'ora d'inizio: non si fanno».
  La richiesta del proprietario (2026-09-20) la supera; per inciso il suo stesso mock ha un campo
  «At time» nella modale della regola, quindi la frase nasceva da una lettura parziale del design.
