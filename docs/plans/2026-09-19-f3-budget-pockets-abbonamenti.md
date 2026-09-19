# F3 — Budget, Pockets, Abbonamenti

> Piano eseguito **in linea**, in una sola sessione, lotto dopo lotto, come F2.5: i tre moduli sono
> nuovi e disgiunti, ma condividono i file di registro (`tables.ts`, `registry.ts`, `navigation.ts`,
> messaggi, migrazione) e le letture nuove di `modules/transactions/queries.ts`. Chi lo riprende in
> mano non ha il contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — §4.2–4.3, §6 (righe budget, pockets, abbonamenti),
   §7.2 (giroconti e netto), §7.3, §7.4, §7.5, §8, §10, §11, §12. **La spec vince sul piano.**
3. `docs/plans/2026-09-16-f2-integrazioni-wallet-expenses.md` §11 e
   `docs/plans/2026-09-17-f2-5-correzioni-f2.md` §9 — cosa esiste e quali contratti sono cambiati.
4. `src/modules/accounts/` e `src/modules/transactions/` come modello di modulo.
5. Il design: `UI Recreation and branding decisions/Finance Dashboard.dc.html`, Budgets (righe
   425–455), Subscriptions (617–668), Pockets (671–722), modali Move/Withdrawal/Pocket/Subscription
   (1036–1108), logica della vista (1242–1432); dati in `data.js` (`BUDGETS` 53, `POCKETS` 112,
   `SUBSCRIPTIONS` 146). Sola lettura, mai committato.

§0 della spec mette il design **sopra** questo documento e sotto la spec funzionale del
proprietario; per le regole di §7.3–7.5, scritte dopo il design, questo piano segue la spec e il
design dà la forma della schermata. Ogni punto in cui i due divergono è in §3.6 con una proposta.

## 1. Obiettivo

F3 secondo §12: **§7.3 Budget, §7.4 Pockets, §7.5 Abbonamenti**, con le loro schermate, i job, i
riflessi su Overview (quarto KPI "Pockets", card "Budgets") e su Account detail (righe "Pockets" e
"Subscriptions"), le voci della palette ⌘K (§8.2).

Fuori perimetro: interessi (F4, ma §7.4 li usa: §3.5), fondi, payroll, ferie, `/api/v1` (F8), le
email di avviso (§3.6.6).

## 2. Punto di partenza (2026-09-19)

- Branch `dev-0.1` su `915304b`, albero pulito salvo `.vscode/` (non si tocca).
- Nessun server di sviluppo: ogni lotto si verifica su `https://dash.longobardo.me`
  (`docker compose build && docker compose up -d`, poi `/api/health`), e2e da lì con utenti
  `@example.test`. Le migrazioni girano all'avvio del container.
- Commit e push solo su richiesta del proprietario: ogni lotto chiude con un "commit suggerito".

### Cosa esiste già e va riusato, non riscritto

| Serve a | Dove | Nota |
|---|---|---|
| Ricorrenze rilevate | `transactions/schema.ts` → `recurring_patterns`; `transactions/jobs.ts` → `refreshRecurrences` (job `wallet-sync`) | Salva `payeeKey`, segno, `intervalDays`, mediana, prossima data. **Non** salva beneficiario leggibile, conto, categoria, cadenza (F2 §11.4) |
| Fasce delle cadenze | `transactions/rules.ts` → `RECURRENCE_BANDS`, `payeeKeyOf` | La cadenza si ricava da `intervalDays` |
| Categorie a due livelli | `transactions/taxonomy.ts` → `listCategories` (ordine d'albero, `depth`) | Una figlia ha il colore del gruppo |
| Scelta della categoria | `transactions/ui/category-picker.tsx` | Con ricerca |
| Saldi dei conti a oggi | `accounts/queries.ts` → `balancesOn`, `accountsView` | Per "Libero" e per la proiezione |
| Saldi giornalieri | `accounts/service.ts` → `dailyBalancesOf` | Non serve in F3 (vedi §3.4) |
| Grafici | `src/ui/chart.tsx` → `Bars`, `StackedArea` | `Bars` riceve una linea di obiettivo (lotto P4) |
| Barra di avanzamento | `src/ui/progress-bar.tsx` | Diventa anche tratteggiata (§8.3 la prevede): pocket senza obiettivo |
| Controlli | `src/ui/url.ts` (`withParams`), `accounts/ui/controls.tsx` (`PeriodStepper`, `LinkTabs`), `src/ui/segmented.tsx`, `modal.tsx`, `table.tsx` (`TotalRow`), `kpi-tile.tsx`, `badge.tsx`, `states.tsx` | |
| Job | `platform/jobs/registry.ts`; `runTier` esegue i job di un livello **nell'ordine della lista** | Il controllo abbonamenti va dopo `wallet-sync` |
| Iterazione sugli utenti | `accounts/jobs.ts`, `transactions/jobs.ts` (`everyone`, `contextFor`, `forEachUser`) | Stessa forma; niente astrazione nuova per un terzo uso |

## 3. Contratti decisi in anticipo

### 3.1 Collocazione

```
src/modules/budgets/        schema.ts rules.ts service.ts queries.ts actions.ts ui/
src/modules/pockets/        schema.ts rules.ts service.ts queries.ts actions.ts jobs.ts ui/
src/modules/subscriptions/  schema.ts rules.ts service.ts queries.ts actions.ts jobs.ts ui/
src/app/(app)/budgets/ pockets/ subscriptions/   (+ subscriptions/export.csv/route.ts)
```

Nessun modulo nuovo legge le tabelle di `transactions` o `accounts`: passa dalle funzioni nuove di
§3.3. Gli `schema.ts` nuovi importano `accounts`, `categories` e `transactions` **solo** per le FK
(l'esenzione di `architecture.test.ts`).

### 3.2 Tabelle — una sola migrazione `drizzle/0006_budgets_pockets_subscriptions.sql`

Colonne comuni: `id uuid default uuidv7()`, `user_id` FK `users` `on delete cascade`,
`created_at`, `updated_at`. Importi `bigint` in centesimi, mesi `date` con giorno 1 (CHECK).

**`budget_limits`** (§6, §7.3)
- `category_id` FK `categories` **`on delete cascade`** (una categoria non si cancella, si archivia;
  la cascata serve solo alla cancellazione dell'utente);
- `from_month date` (CHECK giorno 1);
- `amount_cents bigint` nullable, `stopped boolean not null default false`,
  CHECK `(stopped and amount_cents is null) or (not stopped and amount_cents > 0)`;
- UNIQUE `(user_id, category_id, from_month)`.

Il limite di una categoria nel mese M è la riga con il `from_month` più grande ≤ M; se è `stopped`,
o non esiste, la categoria non ha budget in M. `stopped` esiste perché §7.3 versiona i limiti e
"togli il budget da questo mese" è anch'essa una versione (§3.6.2); `null` qui non vuol dire
"sconosciuto", per questo c'è la colonna esplicita.

**`pockets`** (§6, §7.4)
- `name` (1–60, UNIQUE `(user_id, name)`), `color`;
- `backing_account_id` FK `accounts` nullable, **`on delete restrict`** (§3.6.9);
- `target_cents` nullable (> 0), `monthly_cents` nullable (> 0: `null` = "Manually", §3.6.4);
- `start_month date` (giorno 1);
- `state` `active | paused | archived`, `archived_at` (CHECK coerente come `accounts`).

**`pocket_movements`**
- `pocket_id` FK `pockets` `on delete cascade`;
- `kind` `accrual | deposit | withdrawal | adjustment`;
- `amount_cents` con segno: CHECK `accrual`/`deposit` > 0, `withdrawal` < 0, `adjustment` ≠ 0;
- `on date`, `reason text` (obbligatorio per `withdrawal` e `adjustment`, CHECK);
- CHECK `kind <> 'accrual' or extract(day from on) = 1`;
- UNIQUE parziale `(pocket_id, on) where kind = 'accrual'` → **un solo accrual per pocket e mese**,
  l'idempotenza la garantisce il database (`on conflict do nothing`).

**`subscriptions`** (§6, §7.5)
- `name` (1–80), `category_id` FK `categories` nullable `on delete set null`;
- `utility smallint` CHECK 1–10, default 5;
- `price_cents` > 0, `currency` `EUR`;
- `cycle` `weekly | monthly | quarterly | yearly`;
- `next_charge_on date` — la data di un addebito, detta dall'utente; è l'**ancora** del calendario
  degli addebiti (§3.4.3), il "prossimo addebito" mostrato si ricava (§3.6.5);
- `payment_account_id` FK `accounts` nullable, **`on delete restrict`**;
- `payee_match text` nullable (senza, il controllo non gira: §3.4.4);
- `tolerance numeric(10,6)` CHECK 0–1, default `0.05`;
- `state` `active | paused | cancelled`, `cancelled_at`.

**`subscription_charges`**
- `subscription_id` FK `subscriptions` `on delete cascade`;
- `due_on date` (l'addebito atteso), `period_from date`, `period_to date` (la finestra, §3.4.3);
- `transaction_id` FK `transactions` nullable `on delete set null`, **UNIQUE** (un movimento paga
  al più un addebito, anche fra abbonamenti diversi con lo stesso beneficiario);
- `expected_cents` (fissato alla prima scrittura della riga), `actual_cents` nullable;
- `state` `paid | amount_differs | due | not_found`;
- UNIQUE `(subscription_id, due_on)`.

Tutte registrate in `src/platform/db/tables.ts`. Indici sui percorsi di lettura:
`budget_limits (user_id, from_month)`, `pocket_movements (pocket_id, on)`,
`subscription_charges (subscription_id, due_on desc)`.

### 3.3 Firme

Da rispettare alla lettera; il corpo è libero.

```ts
// modules/transactions/queries.ts — le sole porte nuove verso i movimenti
expenseByCategory(ctx, month: MonthKey): Promise<{ categoryId: string | null; cents: Cents }[]>
//   §7.3: somma dei valori assoluti dei movimenti `expense` del mese (fuso dell'utente), non
//   nascosti, non spariti, mai giroconti. Una riga per categoria, positiva.
chargeCandidates(ctx, input: { accountId: string | null; from: CivilDate; to: CivilDate }):
  Promise<{ id: string; accountId: string; on: CivilDate; cents: Cents; payee: string | null }[]>
//   §7.5: movimenti `expense` visibili nella finestra, sul conto (o su tutti se null), `cents`
//   positivo; ORDER BY on, id.
payeeSamples(ctx, payeeKeys: readonly string[]):
  Promise<Map<string, { payee: string; accountId: string; categoryId: string | null; on: CivilDate }>>
//   per ogni chiave il movimento più recente (visibile, non giroconto): nome, conto e categoria
//   da proporre in "Suggest".
listRecurringPatterns(ctx): Promise<RecurringPattern[]>   // ORDER BY next_expected_on, id

// modules/accounts/service.ts
removeAccount(ctx, id)   // invariata; un 23503 (FK restrict) sulla DELETE → archivia (§3.6.9)

// modules/budgets
rules.ts:   limitFor(versions, month): Cents | null
            budgetStatus(spent, limit): "over" | "near" | "on_track"      // interi, niente float
            familyTotals(rows, categories): …                               // §3.4.1
service.ts: setLimit(ctx, { categoryId, month, cents }), stopLimit(ctx, { categoryId, month })
queries.ts: budgetsView(ctx, month): Promise<BudgetsView>

// modules/pockets
rules.ts:   pocketBalance, etaMonths(target, balance, monthly): number | null,
            freeBalance(accounts, pockets): Cents | null, monthEndSeries(movements, months)
service.ts: createPocket, updatePocket, archivePocket, restorePocket,
            addToPocket(ctx, id, { cents, on, reason? }), recordWithdrawal(ctx, id, { cents, on, reason }),
            adjustPocket(ctx, id, { cents, on, reason }),
            accrueMonth(ctx, month, pocketIds?): Promise<{ written: number }>   // idempotente
queries.ts: pocketsView(ctx), pocketsTotal(ctx) (per Overview), pocketsOnAccount(ctx, accountId)
jobs.ts:    pocketsAccrualJob  (tier "monthly")

// modules/subscriptions
rules.ts:   monthlyEquivalent, yearlyEquivalent, dueDates(anchor, cycle, from, to),
            periodOf(due, cycle), matchCharges(subs, candidates, today), withinTolerance,
            suggestionsFrom(patterns, samples, subscriptions)
service.ts: createSubscription, updateSubscription, setUtility, cancelSubscription, pause/resume,
            checkSubscriptions(ctx, now?): Promise<{ checked: number; written: number }>
queries.ts: subscriptionsView(ctx), projectionByAccount(ctx, horizon: "month" | "year"),
            subscriptionsOnAccount(ctx, accountId), suggestions(ctx)
jobs.ts:    subscriptionsCheckJob (tier "hourly", registrato **dopo** walletSyncJob)
```

### 3.4 Regole sottili, decise qui una volta sola

1. **Budget e sottocategorie.** Un limite si mette su una categoria `expense`, gruppo o figlia.
   Lo speso di un **gruppo** comprende le figlie (come il filtro di §7.2 F2.5); quello di una figlia
   solo sé stessa. La tabella è in ordine d'albero: gruppo, poi le figlie con un limite. I **totali**
   (sottotitolo e card "Total this month") sommano solo le categorie con limite il cui gruppo non ha
   limite: una figlia sotto un gruppo con budget è già dentro il gruppo, contarla due volte gonfierebbe
   speso e limite. Movimenti senza categoria e categorie senza limite non entrano in nessun budget; la
   card ne mostra la somma come "Non a budget" (mai nei totali).
2. **Stato del budget** in centesimi interi: `over` se speso > limite; `near` se `speso × 100 ≥
   limite × 85` (spec: "≥ 85 %"; il design scrive `> 85`, vale la spec); altrimenti `on_track`. La
   percentuale mostrata è `round(speso / limite)` e può superare 100 %.
3. **Calendario di un abbonamento.** Le date di addebito sono l'ancora `next_charge_on` più o meno
   multipli del ciclo: settimanale ±7 giorni; mensile/trimestrale/annuale ±1/3/12 mesi **dal giorno
   dell'ancora**, riportato all'ultimo del mese quando manca (31 → 28 febbraio → 31 marzo). La
   **finestra** di un addebito `D` (il "periodo" di §7.5): per i cicli a mesi è il **mese di
   calendario** di `D` (come il design: "any day of the month" / "renewal month"); per il settimanale
   `[D − 3, D + 3]`.
4. **Controllo pagamenti** (`checkSubscriptions`, per ogni abbonamento `active` con `payee_match`):
   - periodi controllati: dal primo il cui `D` è ≥ la data di creazione meno un ciclo, fino
     all'ultimo con `D ≤ oggi + 7`; al massimo gli ultimi 24;
   - candidati: `chargeCandidates` sul conto di pagamento (tutti i conti se non c'è) nella finestra,
     con `payeeKeyOf(payee)` che **contiene** `payeeKeyOf(payee_match)`;
   - fra più candidati: importo più vicino all'atteso, poi data più vicina a `D`, poi id; un
     movimento già preso da un altro addebito (qualunque abbonamento) è escluso — assegnazione in
     ordine di `due_on`, poi id dell'abbonamento, così è deterministica;
   - stato: trovato e `|effettivo − atteso| ≤ atteso × tolleranza` → `paid`; trovato fuori → 
     `amount_differs`; non trovato, finestra aperta e `D − oggi ≤ 7` → `due`; non trovato e finestra
     chiusa → `not_found`; altrimenti nessuna riga (in interfaccia "Not due");
   - `expected_cents` si fissa alla prima scrittura (un aumento di prezzo non riscrive il passato),
     gli stati si ricalcolano **tutti** a ogni passata (un movimento arrivato tardi trasforma un
     `not_found` in `paid`); le righe fuori dai periodi controllati si cancellano. Nessun I/O di rete.
   - Gira: nel job orario dopo `wallet-sync` (§10.2), dopo "Sync now", dopo ogni salvataggio di un
     abbonamento (solo quello).
5. **Equivalenti** (§7.5), half-up al centesimo: mensile = prezzo × {52/12, 1, 1/3, 1/12}, annuale =
   prezzo × {52, 12, 4, 1}. Utilità bassa = ≤ 5.
6. **Proiezione per conto**: ultimo saldo (`balancesOn` a oggi) − somma degli atteso degli addebiti
   degli abbonamenti attivi pagati da quel conto con `D` in `(oggi, oggi + 30]` ("Month") o
   `(oggi, oggi + 365]` ("Year") e non già `paid`. `null` se il conto non ha saldo. Gli abbonamenti
   senza conto di pagamento sono elencati a parte ("Senza conto").
7. **Suggerimenti** (§7.5): `recurring_patterns` con `sign = -1`, cadenza (da `RECURRENCE_BANDS`)
   settimanale/mensile/trimestrale/annuale, **non coperti** (nessun abbonamento, in qualunque stato,
   il cui `payeeKeyOf(payee_match)` sia contenuto nel `payeeKey`). Precompilano la modale: nome e
   `payee_match` = beneficiario leggibile, prezzo = |mediana|, ciclo, `next_charge_on` =
   `nextExpectedOn`, conto e categoria dal movimento più recente (`payeeSamples`). Accettare = salvare
   la modale. Nessun "scarta" (§3.6.8).
8. **Saldo del pocket** = somma dei movimenti; un prelievo o una rettifica che lo porterebbe sotto
   zero è rifiutato (`insufficient`). ETA = `ceil((obiettivo − saldo) / mensile)` mesi; `0` se
   raggiunto; `null` senza obiettivo o senza accantonamento. La data dell'ETA è il 1° del mese
   corrente + N mesi.
9. **Accantonamento.** `accrueMonth(ctx, M)` scrive l'`accrual` di M per ogni pocket `active` con
   `monthly_cents` e `start_month ≤ M` (on conflict do nothing). Lo chiama il job del 1° del mese
   (00:05, §10.2) per il mese corrente, e lo chiamano la creazione e la ripresa di un pocket per il
   solo pocket e il mese corrente: un pocket creato il 19 con inizio questo mese accantona subito,
   invece di restare vuoto fino al 1°. **Nessun recupero** dei mesi passati (un inizio nel passato
   non genera arretrati: si usa "Add to pocket"), e i mesi in pausa restano senza accrual.
10. **Libero (non accantonato)** (§7.4) = Σ ultimi saldi dei **conti di appoggio distinti** dei pocket
    non archiviati − Σ saldi di quei pocket; `null` se uno di quei conti non ha saldo. Anche per
    conto, nella modale "Add to pocket" ("Free on …").
11. **Storico del pocket** (grafico "Earmarked · 12 months"): saldo a fine mese dai movimenti, 12
    mesi fino al corrente; `null` prima del primo movimento.

### 3.5 Interessi sul conto di appoggio (§7.4) — in F3 è `null`

§7.4 li definisce come "interessi maturati dal conto nel periodo × (saldo pocket ÷ saldo conto)",
e le maturazioni (`interest_accruals`) arrivano con F4. In F3 `pocketsView` restituisce
`interestCents: null` con `interestReason: "no_interest_data"` per ogni pocket; la stat "Interest
earned on backing" mostra "—" con il suggerimento "Disponibile quando gli interessi del conto sono
configurati". **Mai 0** (§4.3): zero direbbe che il conto non rende, che è falso. F4 sostituisce il
`null` senza cambiare la forma. Per un pocket senza conto di appoggio resta `null` per sempre, con
motivo `standalone`.

### 3.6 Dove spec, design e codice divergono — proposte da confermare

1. **Tolleranza.** Spec: percentuale, 5 %. Design: "Amount tolerance (± €)", 1,00. → **spec**
   (`numeric` frazione, campo in % nella modale).
2. **Budget: creazione e rimozione.** Il design ha solo un toast "Budget form would open here".
   → modale "Add budget" (categoria `expense` senza limite nel mese, importo) che crea la versione dal
   mese visualizzato; menu di riga "Remove from this month" che scrive una versione `stopped`.
   **Versioni successive:** §7.3 dice "dal mese visualizzato in avanti"; lo leggo alla lettera — la
   nuova versione **sostituisce** quelle con `from_month` successivo (le cancella nella stessa
   transazione). Alternativa: tenerle. Da confermare.
3. **Mese dei budget.** Il design lo finge ("October has no data yet"). → stepper funzionante
   (§8.4.2) dal mese del primo limite fino al mese corrente + 12; un mese futuro mostra speso 0.
4. **Pocket, "Accrues on".** Design: "1st of month · Payday (27th) · Manually". Spec: job del 1° del
   mese. → "1st of month" = `monthly_cents` valorizzato; "Manually" = nessun accantonamento
   (`monthly_cents` null); **"Payday (27th)" non si fa** (nessuna regola in spec, nessuna fonte per il
   giorno di paga prima di F5).
5. **"Prossimo addebito".** Spec §6 lo mette fra le colonne; un valore salvato invecchia il giorno
   dopo. → la colonna resta, ma è l'**ancora** del calendario (§3.4.3); "Next charge" in interfaccia
   si ricava: il primo `D ≥ oggi` il cui periodo non è già `paid`.
6. **Avvisi degli abbonamenti.** §7.5 "alimentano gli avvisi", §10.4 non elenca email per gli
   abbonamenti, il design ha "If not found: Alert in app · Alert + email · Ignore". → in F3 **solo in
   app**: i banner in testa a Subscriptions per `not_found`, `amount_differs`, `due` (testi del
   design). Niente campo "If not found" e niente email: servirebbero una colonna e una riga di §10.4
   che la spec non ha. Da confermare (oppure: colonna `on_missing alert|ignore` subito, email in F8).
7. **Cicli.** Design: Monthly/Yearly; spec: weekly/monthly/quarterly/yearly. → spec. Di
   conseguenza la colonna "Monthly" mostra l'**equivalente** mensile di ogni piano (il design mette
   0 ai piani annuali) e il KPI "Monthly total" è la somma degli equivalenti; la sottoriga dice
   "equivalente, tutti i piani". Il campo "Renewal month (yearly only)" sparisce: il mese lo dà
   `next_charge_on`.
8. **"Suggest from recurring payments"** non è nel design. → bottone secondario in cima a
   Subscriptions che apre un pannello (modale) con i suggerimenti, ciascuno con "Add" che apre la
   modale precompilata. Senza "scarta": servirebbe una tabella che §6 non ha; un suggerimento sparisce
   quando un abbonamento lo copre (anche `cancelled`: così "non mi interessa" = crearlo e annullarlo).
   Da confermare.
9. **Eliminare un conto referenziato.** §7.1 vuole l'archiviazione se il conto è referenziato da
   pockets/abbonamenti, ma `removeAccount` ha `references = 0` fisso e non può leggere le tabelle di
   altri moduli. → FK `on delete restrict` e `removeAccount` che, alla violazione 23503, archivia
   (riconosciuta risalendo la catena delle `cause` senza `instanceof`, come `isUniqueViolation` in
   F2.5 §9.2.7). Nessun import incrociato, e vale da sé anche per interessi e fondi in F4.
10. **Export CSV** di Subscriptions: nel design non è collegato; §8.4.2 vuole che ogni controllo
    funzioni. → route `GET /subscriptions/export.csv` (sessione richiesta), colonne della tabella.
11. **Palette ⌘K.** Il design elenca solo pagine; §8.2 vuole anche pockets e abbonamenti. → spec:
    una ricerca per nome su pockets e abbonamenti accanto ai beneficiari (i conti mancano anche oggi:
    restano fuori, non sono F3).
12. **Mobile.** Il design ha solo un segnaposto per queste pagine; §8.2 dice "tabelle come elenchi".
    → sotto 768 px: KPI a due colonne, tabelle Budgets e Subscriptions come elenchi di card, in
    Pockets l'elenco sopra il dettaglio; voci nel foglio "More".
13. **Overview.** Il design ha la card "Budgets · <mese>" (prime 5 per percentuale, "View all") e il
    quarto KPI "Pockets" (saldo, "+accantonamento mensile · per month", "N pockets"). → entrambi.
    Account detail: righe "Pockets" e "Subscriptions" (N attivi · equivalente mensile).
14. **"Backing balances"** nel design somma due conti fissi; qui sono i conti di appoggio distinti
    (§3.4.10), con i nomi nella sottoriga.
15. **Categoria dell'abbonamento**: il design ha una lista fissa; qui è una categoria `expense`
    dell'utente con il `CategoryPicker`. La card "By category · yearly" raggruppa per gruppo, nel
    colore del gruppo (§7.2 F2.5).

## 4. Lotti

```
L0 fondamenta ── L1 Budget ── L2 Pockets ── L3 Abbonamenti ── L4 palette, mobile, chiusura
```

Ogni lotto chiude con: test scritti **prima** del codice (unit per `rules.ts`, integrazione per
servizi e query con l'isolamento fra utenti di ogni tabella nuova, e2e a 1440 e 400 px), il cancello
del §5, `docker compose build && docker compose up -d`, `/api/health`, `npm run e2e` sul sito.

### L0 — Fondamenta

**File:** `modules/{budgets,pockets,subscriptions}/schema.ts` + costanti in `rules.ts`,
`platform/db/tables.ts`, `drizzle/0006_*` + snapshot + journal, `navigation.ts` (+ `nav-types.ts`,
`navigation.test.ts`), `ui/shell/icons.ts` (`PieChart`, `WalletCards`, `Repeat`), messaggi,
`accounts/service.ts` (§3.6.9).

- Una migrazione con `npm run db:generate`; se chiede una rinomina in modo interattivo, due
  passaggi come la 0004. Rilettura a mano (indice parziale, CHECK).
- Voci Budgets · Pockets · Subscriptions nel gruppo `finance` dopo Expenses, `mobile: false` (vanno
  nel foglio "More").
- Semina di `budgets.*`, `pockets.*`, `subscriptions.*`, `nav.*` in `en.json` **e** `it.json` con i
  testi del design tradotti.

**Test:** integrazione — migrazioni da vuoto; CHECK di `pocket_movements` (segni, accrual al giorno 1,
doppio accrual rifiutato), di `budget_limits` (`stopped`), di `subscriptions` (utilità, tolleranza);
`removeAccount` archivia un conto con un pocket o un abbonamento e cancella uno senza; unit —
`navigation.test.ts`, `messages.test.ts` (già esistente, vede le chiavi nuove).

**Commit suggerito:** `feat(f3): tabelle di budget, pockets e abbonamenti`

### L1 — Budget (§7.3)

**File:** `transactions/queries.ts` (`expenseByCategory`), `modules/budgets/*`,
`app/(app)/budgets/page.tsx`, card in `app/(app)/page.tsx`, messaggi, `scripts/seed-e2e.ts`,
`tests/e2e/budgets.spec.ts`.

- `budgetsView(ctx, month)`: versioni valide in M, speso per categoria da `expenseByCategory`,
  famiglie (§3.4.1), stato (§3.4.2), totali, "Non a budget". Mese nell'URL (`?month=AAAA-MM`).
- Pagina: intestazione con sottotitolo "{speso} of {limite} · {%}" e `PeriodStepper`; card "Total this
  month"; tabella Category · Progress · Spent · Limit (cella modificabile: Enter salva, Esc annulla,
  ≤ 0 ripristina) · Remaining · Status; menu di riga "Remove from this month"; modale "Add budget";
  stato vuoto del design.
- Overview: card "Budgets · <mese>" con le prime 5 per percentuale e "View all".

**Test:** unit — `limitFor` (versione più recente ≤ M, `stopped`, nessuna), `budgetStatus` ai
confini (84,99 %, 85 %, 100 %, 100 % + 1 cent), famiglie senza doppio conteggio; integrazione — speso
che esclude giroconti, nascosti, spariti, entrate, altri mesi e il fuso (movimento alle 00:30 del 1°
a Roma = mese nuovo); gruppo che somma le figlie; `setLimit` che sostituisce le versioni successive;
isolamento (B non legge, non modifica, non referenzia una categoria di A); e2e — modifica del limite
inline e cambio di stato, cambio mese, 400 px.

**Commit suggerito:** `feat(budgets): limiti mensili per categoria`

### L2 — Pockets (§7.4)

**File:** `modules/pockets/*`, `platform/jobs/registry.ts`, `src/ui/progress-bar.tsx` (tratteggiata),
`src/ui/chart.tsx` (`Bars` con linea obiettivo), `app/(app)/pockets/page.tsx`, KPI in
`app/(app)/page.tsx`, riga in `app/(app)/accounts/[id]/page.tsx`, messaggi, seed e2e,
`tests/e2e/pockets.spec.ts`.

- Pagina come il design: 4 KPI (Earmarked, Backing balances, Free, Monthly accrual con "next accrual
  1 <mese>"); elenco dei pocket (selezione nell'URL `?pocket=<id>`) con barra piena o tratteggiata;
  dettaglio con obiettivo/ETA o striscia "Open-ended"; tre stat (Monthly accrual, Withdrawn · 12
  months, Interest — `null`, §3.5); grafico 12 mesi; tabella Withdrawals.
- Modali: "Add to <pocket>" (importo, libero sul conto, saldo dopo), "Record withdrawal" (importo,
  data ≤ oggi, motivo obbligatorio), "New/Edit pocket" (nome, conto di appoggio, obiettivo,
  accantonamento mensile, "Accrues on" a due voci, mese di inizio, colore; archivia/ripristina).
- Job `pockets-accrual`, tier `monthly`, dopo lo snapshot.

**Test:** unit — `etaMonths` (esatto, con resto, raggiunto, senza obiettivo/accantonamento),
`freeBalance` (conti condivisi contati una volta, `null` se un saldo manca), serie mensile;
integrazione — `accrueMonth` due volte = un accrual; pausa senza accrual, ripresa con accrual del
mese; inizio futuro senza accrual; prelievo oltre il saldo rifiutato; creazione con accrual del mese;
job su due utenti con uno che fallisce; isolamento (B non vede pocket e movimenti di A, non può
appoggiare un pocket su un conto di A né scrivere movimenti su un pocket di A); e2e — crea, aggiungi,
preleva, modifica, 400 px; KPI "Pockets" in Overview.

**Commit suggerito:** `feat(pockets): buste virtuali con accantonamento mensile`

### L3 — Abbonamenti (§7.5)

**File:** `transactions/queries.ts` (`chargeCandidates`, `payeeSamples`, `listRecurringPatterns`),
`modules/subscriptions/*`, `platform/jobs/registry.ts`, `settings/integrations/actions.ts` (dopo
"Sync now": ricorrenze e controllo — chiude anche la deviazione F2 §11.4 "«Sync now» non ricalcola le
ricorrenze"), `app/(app)/subscriptions/{page.tsx,export.csv/route.ts}`, riga in Account detail,
messaggi, seed e2e, `tests/e2e/subscriptions.spec.ts`.

- Pagina come il design: banner degli avvisi; 4 KPI (Monthly total, Yearly total, Low utility ≤ 5,
  Next 30 days con "charges due by <data>"); tabella ordinabile (URL `sort`/`dir`, predefinito
  Yearly desc) Name · Category · Utility · Price · Billing · Paid from · Monthly · Yearly · Paid this
  period · Edit, con riga "Grand total"; card "Projection by account" con Month/Year; card "By
  category · yearly"; abbonamenti in pausa e annullati in una sezione ripiegata sotto la tabella.
- Modale "New/Edit subscription": nome, categoria, conto, prezzo, ciclo, prossimo addebito,
  "Payment check" (testo da cercare, tolleranza %, "Last match: …"), scala dell'utilità 1–10 con la
  didascalia del design; "Cancel subscription", pausa/ripresa.
- "Suggest from recurring payments" (§3.4.7, §3.6.8); "Export CSV" (§3.6.10).
- Job `subscriptions-check`, tier `hourly`, subito dopo `wallet-sync`.

**Test:** unit — equivalenti per i quattro cicli e l'arrotondamento; `dueDates` (31 del mese,
febbraio bisestile, settimanale, ancora futura); `periodOf`; `matchCharges` (contiene senza
spazi/maiuscole, altro conto escluso, conto nullo = tutti, tolleranza al confine, due candidati,
stesso movimento conteso da due abbonamenti, `due` a 7 e a 8 giorni, `not_found` a finestra chiusa,
nessuna riga se "Not due"); `suggestionsFrom` (bisettimanale escluso, coperto escluso, entrate
escluse); integrazione — `checkSubscriptions` idempotente, `not_found` che diventa `paid` con un
movimento tardivo, `expected_cents` fermo dopo un cambio di prezzo, nascosti e giroconti mai
abbinati; proiezione per conto (`null` senza saldo); isolamento (B non vede abbonamenti e addebiti di
A, non li paga dal conto di A, non abbina movimenti di A); e2e — suggerimento accettato, modifica
dell'utilità, ordinamento, proiezione Month/Year, CSV scaricato, 400 px.

**Commit suggerito:** `feat(subscriptions): abbonamenti, controllo pagamenti e proiezione`

### L4 — Palette, mobile, chiusura

**File:** `app/(app)/layout.tsx`, `ui/shell/command-palette.tsx`, azioni di ricerca nei due moduli,
`tests/e2e/mobile.spec.ts`, `README.md`, spec (righe *(F3)* dove questo piano ha deciso), questo
piano (§8 Esito).

- Palette: pockets e abbonamenti per nome, con link alla pagina (e `?pocket=` per un pocket).
- Verifica a 400 px delle tre pagine e del foglio "More"; chiaro/scuro rapido.
- Spec aggiornata con le decisioni confermate di §3.6.

**Commit suggerito:** `feat(f3): palette, mobile e documentazione`

## 5. Cancello

A ogni lotto:

```
npm run format && npm run lint && npm run typecheck && npm run format:check && npm test && npm run test:integration
docker compose build && docker compose up -d && curl -fsS https://dash.longobardo.me/api/health
npm run e2e
grep -rn "next-intl\|@/modules/" src/ui        # vuoto
```

Alla fine, in più: `npm run db:generate` → "No schema changes"; i totali di Expenses invariati al
centesimo rispetto a Wallet (F3 non tocca le letture esistenti, e il test d'integrazione di F2.5 sul
netto resta verde). Il confronto visivo con il design e la revisione per aree di §11 sono del
proprietario.

## 6. Fatto quando

- §7.3, §7.4, §7.5 hanno ciascuno codice e test; le decisioni di §3.6 sono confermate e riportate
  nella spec come righe *(F3)*.
- Tre tabelle nuove per modulo con il test d'isolamento, una migrazione sola.
- Il cancello del §5 è verde su ogni lotto e il sito pubblicato mostra le tre schermate.

## 7. Resta al proprietario

- Confermare §3.6 (in particolare 2, 6 e 8) prima dell'implementazione.
- I commit.
- Il confronto visivo con il design sul sito.

## 8. Esito (2026-09-19)

Il proprietario ha confermato il piano così com'era, §3.6 compreso. Consegnati i cinque lotti
nell'ordine L0–L4, ciascuno con il cancello del §5, il deploy su `dash.longobardo.me` e l'e2e sul
sito. Sull'ultimo stato:

| Controllo | Esito |
|---|---|
| `format`, `lint`, `typecheck`, `format:check` | verdi |
| `npm test` | 794/794 (base 751) |
| `npm run test:integration` | 254/254 (base 227), migrazioni da database vuoto |
| deploy + `/api/health` | `ok`, `0006` applicata all'avvio |
| `npm run e2e` sul sito | 29/29: `budgets`, `pockets`, `subscriptions` a 1440 px e i tre passi nuovi di `mobile` a 400 px |

### 8.1 Contratti del §3 cambiati in corsa

1. **FK verso `accounts` `on delete no action`, non `restrict`.** `restrict` si verifica subito, e
   cancellare un utente poteva fallire secondo l'ordine delle cascate (conti prima dei pocket).
   `no action` si verifica a fine istruzione: la cancellazione dell'utente passa, quella del conto
   da solo no (23503), ed è ciò che `removeAccount` trasforma in archiviazione.
2. **`subscription_charges_actual_ck` vincola solo `actual_cents`.** Con anche `transaction_id` il
   `set null` di una transazione cancellata avrebbe violato il CHECK di una riga `paid`.
3. **Il controllo parte dal periodo in corso alla creazione**, non da un ciclo prima (§3.4.4): con
   la regola del piano un abbonamento annuale inserito oggi veniva confrontato con il rinnovo
   dell'anno scorso e dava un falso `not_found`. Trovato scrivendo il seed e2e.
4. **L'importo atteso si congela solo sui periodi chiusi.** Congelato anche sul periodo in corso,
   "Aggiorna il prezzo" non toglieva mai `amount_differs`: trovato dall'e2e.
5. **Il selettore del mese dei budget non va nel futuro** (§3.6.3 diceva "+12 mesi"): è il
   `PeriodStepper` di F1, e il design stesso dice "October has no data yet".
6. **I messaggi sono stati seminati lotto per lotto**, non tutti in L0: la semina anticipata
   serviva al lavoro in parallelo, e questa fase è stata eseguita in linea.
7. **`adjustPocket` non esiste.** Il tipo `adjustment` resta nello schema (§6), ma nessuna
   schermata lo usa; una funzione senza chiamante sarebbe codice morto.
8. **La palette ha una ricerca generica dei record** (`searchRecords`, `RecordMatch`) invece di una
   per entità, alimentata da `src/app/(app)/palette-actions.ts`, che attraversa due moduli.

Estratti o spostati perché avevano un secondo consumatore:

- `CategoryPicker` in `src/ui/category-picker.tsx` (Expenses, Budgets, Subscriptions), con
  "Senza categoria" facoltativo, `triggerId` per l'etichetta del campo e il popup sopra le modali;
- `forEachUser`/`contextFor` in `modules/users/jobs.ts` (quattro job ne avevano la copia);
- `hasPgError` in `platform/db/errors.ts` (`isUniqueViolation` e `removeAccount`);
- `formatAmountInput` e `formatWholePercent` in `platform/format.ts`;
- `categoryOptions` in `transactions/taxonomy.ts`;
- `MiniBars` e `ProgressBar` tratteggiata in `src/ui` (§8.3).

### 8.2 Difetti trovati verificando, non accettando i test verdi

1. **Il popup delle categorie stava sotto la modale** (`z-40` contro `z-50`): "Add budget" non
   si poteva usare. Ora `z-[60]`.
2. **Subscriptions andava in errore sul sito**: `newDraft` stava in un file `"use client"` e la
   pagina server la chiamava. Né typecheck né test lo vedono; lo ha visto l'e2e dopo il deploy.
3. **A 1440 px con la barra aperta la colonna Nome di Subscriptions era larga zero**: le colonne
   fisse sommavano più della tabella. Categoria e conto di pagamento sono passati in sottoriga
   (§8.4 punto 3) e le card laterali stanno accanto alla tabella solo oltre `@wide`. L'e2e ora
   misura la larghezza della colonna.
4. **Sul telefono "Add subscription" usciva dallo schermo**, spinto da "Export CSV" e dai
   suggerimenti; il controllo di overflow non se ne accorgeva perché la barra taglia il proprio
   contenuto. Trovato guardando gli screenshot a 400 px; l'e2e ora verifica che il bottone sia
   nello schermo.
5. `removeAccount` aveva `references = 0` fisso da F1: nessun riferimento avrebbe mai impedito
   la cancellazione di un conto.
6. Un test d'isolamento creava le promesse tutte insieme e ne lasciava rifiutare alcune senza
   gestirle ("Serialized Error"): ora sono funzioni chiamate una alla volta.
7. `wallet-card.test.tsx` (F2.5) falliva una volta su due sotto il carico di tutta la suite: il
   `findByRole` aspetta ora 5 s invece di 1.

### 8.3 Deviazioni consapevoli, da portare alla revisione di fase

- Dal design non si fanno: "Payday (27th)" e "If not found" (§3.6.4, §3.6.6), la striscia "Set a
  target" del pocket senza obiettivo (c'è "Edit pocket"), il bottone "Update price" nei banner
  (c'è "Check expenses"; il prezzo si cambia da "Edit"). Nessuna email per gli abbonamenti.
- Subscriptions non si ordina più per categoria e per conto: sono in sottoriga.
- Il colore di un pocket esiste nello schema ma non nella modale (il design non lo ha).
- I suggerimenti non si scartano (§3.6.8): spariscono quando un abbonamento li copre.
- La palette non cerca ancora i conti (§8.2): non è F3.

### 8.4 Resta al proprietario

- I commit (nulla è stato committato; lo spostamento di `category-picker` è in stage per via di
  `git mv`). Commit suggeriti, uno per lotto: `feat(f3): tabelle di budget, pockets e
  abbonamenti` · `feat(budgets): limiti mensili per categoria` · `feat(pockets): buste virtuali con
  accantonamento mensile` · `feat(subscriptions): abbonamenti, controllo pagamenti e proiezione` ·
  `feat(f3): palette, mobile e documentazione`.
- Il confronto visivo con il design sul sito e la revisione del branch divisa per aree (§11).

## 9. Modifiche chieste dopo la consegna (2026-09-19)

Quattro richieste del proprietario, ciascuna con test, cancello, deploy ed e2e sul sito:

1. **Il grafico di Overview anche in Accounts.** Il grafico "Net worth over time" è diventato un
   componente (`modules/accounts/ui/net-worth-card.tsx`) usato da tutte e due le pagine; in Accounts
   sostituisce il vecchio grafico a 24 mesi. Lì la sua grana giorno/mese si chiama `chart=`, perché
   `grain=` è già della tabella (mese/anno). Overview è rimasta com'era.
2. **Expenses: conti e tipi a scelta multipla**, come le categorie: `acc` e `type` nell'URL sono
   liste separate da virgole, i menu sono a caselle; i tipi si scrivono in un ordine fisso, così una
   selezione ha un solo indirizzo.
3. **Budget per categoria, per conto o per entrambi.** Migrazione `drizzle/0007_budget_accounts.sql`:
   `budget_limits.account_id` (FK `no action`, così un conto con un budget si archivia), `category_id`
   facoltativo, un CHECK "almeno uno dei due", la chiave unica su `(utente, categoria, conto, mese)`
   con i `null` uguali. `monthSpending` (categoria × conto) sostituisce `expenseByCategory`. Nei
   totali un budget contenuto in un altro non si somma al limite, e lo speso totale conta ogni
   movimento una volta. La modale "Add budget" chiede categoria (anche "Tutte") e conto (anche
   "Tutti").
4. **Settings usa lo spazio orizzontale.** Via il tetto di 960 px di F2.5: `SettingsSection` misura
   sé stessa (descrizione a 240 px, card per il resto) e `SettingsGrid` mette le sezioni brevi a due
   a due oltre `@wide`; tabelle (categorie, registro delle sincronizzazioni, sessioni) su tutta la
   larghezza. §8.2 della spec aggiornata; `wide.spec.ts` ora verifica le due colonne.

Nel frattempo: i test DOM aspettano 5 s invece di 1 nei `findBy…` (`test/setup-dom.ts`), perché due
test diversi fallivano ogni tanto sotto il carico della suite e mai da soli; la deroga per
`wallet-card` è stata tolta. Una corsa e2e subito dopo il riavvio del container ha visto una
modale di Pockets restare aperta oltre 5 s (la prima richiesta lenta); ripetuta due volte, è verde.

La domanda sui giroconti nel netto di Expenses è rimasta senza risposta: nulla è cambiato lì. I
giroconti restano fuori da spese, entrate, budget e abbonamenti, e dentro il netto come in Wallet.

Stato finale: `npm test` 796/796, `npm run test:integration` 256/256, e2e 29/29 sul sito.
