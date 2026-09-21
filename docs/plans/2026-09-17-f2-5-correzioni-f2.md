# F2.5 — Correzioni di F2: categorie, giroconti, date, patrimonio, spazio

> Piano eseguito **in linea**, in una sola sessione, lotto dopo lotto: i lotti toccano gli stessi file
> di lettura (`modules/transactions/queries.ts`, `app/(app)/expenses/page.tsx`, le pagine dei conti)
> e un'esecuzione parallela passerebbe più tempo a negoziare che a lavorare. Chi lo riprende in
> mano non ha il contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — le righe marcate *(F2.5)* in §6, §7.1, §7.2, §8.2,
   §8.3, §9.1 e §12 sono le regole che questo piano realizza. **La spec vince sul piano.**
3. `docs/plans/2026-09-16-f2-integrazioni-wallet-expenses.md` §11 — cosa ha consegnato F2 e con
   quali deviazioni.

## 1. Obiettivo

Cinque correzioni chieste dal proprietario il 2026-09-17, in quest'ordine di esecuzione:

| Lotto | Cosa | Perché |
|---|---|---|
| **B** | I giroconti non sono né spese né entrate | L'intestazione di Expenses e quelle dei mesi sommano i giroconti; filtrando un conto solo, una gamba sembra una spesa |
| **C** | Un solo DateRangePicker, anche in Overview e Account detail | Overview non ha un intervallo libero; Account detail ha due campi `type="month"` grezzi |
| **E** | Spazio orizzontale sugli schermi da 2K in su | Colonna fissa a 1440 px e griglie che smettono di rispondere a 1024 px di **finestra** |
| **A** | Categorie a due livelli | Wallet manda già `category.group`, F2 lo butta via |
| **D** | Storia Wallet e curva del patrimonio | Backfill fisso a 12 mesi; i conti sincronizzati hanno saldi solo dal giorno della prima sync |

Fuori perimetro: tutto ciò che §12 assegna a F3 e oltre.

## 2. Punto di partenza (2026-09-17)

- Branch `dev-0.1`, base verde: `npm run typecheck` ok, `npm test` 681/681, `npm run test:integration`
  226/226.
- Nel working tree ci sono modifiche del proprietario non committate (`README.md`,
  `docker-compose.yml`, D20 e §13 della spec): **non si toccano e non si committano** con questo
  lavoro.
- L'app è distribuita nel homelab: **non ridistribuire**.
- I commit li decide il proprietario: ogni compito chiude con un "commit suggerito", non con un
  commit.

## 3. Contratti decisi in anticipo

### 3.1 Migrazioni

Due, generate con `npm run db:generate` dopo aver cambiato gli `schema.ts`, rinominate e rilette a
mano (come F2):

- `drizzle/0004_category_hierarchy.sql` (lotto A) — gerarchia di `categories`, `category_group` fra
  gli `entity_type` di `provider_links`, travaso della colonna `group`.
- `drizzle/0005_balance_source_derived.sql` (lotto D) — `derived` fra le fonti di `balance_entries`.

Quello che drizzle-kit non sa esprimere si scrive a mano **nel file SQL**, lasciando lo snapshot come
drizzle-kit lo vede (così la prossima `db:generate` non trova differenze fantasma):

- `ON DELETE SET NULL ("parent_id")` — la lista di colonne (Postgres ≥ 15) serve perché la FK è
  composita e l'altra colonna è generata: un `SET NULL` su tutte e due fallirebbe.
- il travaso di `group` (§5, compito A1).

### 3.2 Forma della gerarchia (lotto A)

```sql
parent_id      uuid                                  -- null = gruppo (radice)
is_root        boolean GENERATED ALWAYS AS (parent_id IS NULL) STORED
parent_is_root boolean GENERATED ALWAYS AS (CASE WHEN parent_id IS NULL THEN NULL ELSE true END) STORED
UNIQUE (id, is_root)                                                    -- categories_id_root_uq
FOREIGN KEY (parent_id, parent_is_root) REFERENCES categories (id, is_root)
  ON DELETE SET NULL (parent_id)                                        -- categories_parent_fk
UNIQUE NULLS NOT DISTINCT (user_id, parent_id, name)                    -- categories_user_parent_name_uq
```

Il terzo livello è impossibile per costruzione: una figlia punta a `(id, true)`, e solo una radice ha
`is_root = true`. Dare un genitore a un gruppo che ha figlie fallisce anche nel database (la chiave
referenziata cambierebbe sotto le figlie); il servizio lo intercetta prima con un errore leggibile.

La coerenza del **tipo** fra genitore e figlia non la fa il database: la fa `taxonomy.ts` (la figlia
eredita sempre il tipo del genitore, un cambio di tipo di un gruppo scende alle figlie nella stessa
transazione).

### 3.3 Firme

Da rispettare alla lettera; il corpo è libero.

```ts
// modules/transactions/queries.ts (lotto B)
interface TransactionsSummary {
  count: number;                 // righe dell'intervallo, giroconti compresi (è la lista)
  incomeCents: Cents;            // type = 'income'
  expenseCents: Cents;           // type = 'expense'
  netCents: Cents;               // income + expense: MAI i giroconti
  transferCount: number;         // quante righe sono giroconti
  unpairedTransferCount: number; // di cui senza controparte (transfer_group_id nullo)
}
interface MonthTotal { month: MonthKey; count: number; netCents: Cents }       // era totalCents
interface MonthGroup { month: MonthKey; count: number; netCents: Cents; rows: TransactionRow[] }
interface Facets { accounts: …; categories: …; types: { type: TransactionType; count: number }[] }

// modules/transactions/queries.ts (lotto D)
dailyNetByAccount(ctx, accountIds: readonly string[]): Promise<Map<string, { on: CivilDate; cents: Cents }[]>>
//   somma per conto e giorno civile (fuso dell'utente), in ordine di data; nascosti e giroconti
//   COMPRESI (hanno mosso il saldo), spariti dal provider esclusi.

// src/ui/url.ts (lotto C) — spostati da modules/accounts/ui/controls.tsx, che li ri-esporta
type Params = Record<string, string | undefined>;
withParams(path: string, current: Params, changes: Params): Route;

// src/ui/date-range-picker.tsx (lotto C) — "use client", niente next-intl, niente moduli
DateRangePicker(props: {
  grain: "day" | "month";
  range: { from: string; to: string };  // day: AAAA-MM-GG; month: AAAA-MM-01 … AAAA-MM-GG (fine mese)
  text: string;                          // l'intervallo scritto, è il testo del bottone
  path: string;
  params: Params;                        // tutto ciò che va portato, TRANNE il periodo
  locale: UiLocale;
  labels: DateRangeLabels;               // stringhe già tradotte
  describe: (from: string, to: string) => string; // il suggerimento "dal … al … · N giorni/mesi"
})
// grain "day": l'URL riceve from/to = AAAA-MM-GG; grain "month": from/to = AAAA-MM.

// modules/accounts/ui/range.ts (lotto C) — puro
monthRange(raw: { from?: unknown; to?: unknown }, thisMonth: MonthKey): { from: MonthKey; to: MonthKey; months: number } | null
//   AAAA-MM validi, from ≤ to, `to` riportato al mese corrente se nel futuro; altrimenti null.

// modules/transactions/taxonomy.ts (lotto A)
interface CategoryInput { name: string; parentId?: string | null; type?: CategoryType; color?: string | null }
adoptOrCreateCategory(ctx, name: string, external?: ExternalCategoryRef,
                      group?: { name: string; externalId: string | null }): Promise<Category>
listCategories(ctx, options?): Promise<Category[]>   // in ordine d'albero: gruppo, sue figlie, gruppo…
type TaxonomyErrorCode = "not_found" | "duplicate" | "invalid" | "invalid_parent"

// modules/transactions/rules.ts (lotto A) — puro
treeOrder<T extends { id: string; parentId: string | null; name: string }>(rows: readonly T[]): (T & { depth: 0 | 1 })[]

// modules/accounts/rules.ts (lotto D) — puri
interface BalancePoint { on: CivilDate; cents: Cents; derived?: boolean }
deriveMonthEnds(observed: readonly BalancePoint[], daily: readonly { on: CivilDate; cents: Cents }[]): BalancePoint[]
estimatedMonths(points: readonly BalancePoint[], months: readonly MonthKey[]): boolean[]

// modules/accounts/service.ts (lotto D)
rebuildDerivedBalances(ctx, accountIds?: readonly string[]): Promise<{ written: number }>

// platform/integrations/wallet/sync.ts (lotto D)
requestWalletBackfill(ctx, connectionId: string, months: number): Promise<void>
```

### 3.4 Regole sottili, decise qui una volta sola

1. **Giroconti.** Esclusi da `incomeCents`, `expenseCents`, `netCents`, dai `netCents` dei mesi e dalla
   card (lo erano già). `count` resta il numero di righe, giroconti compresi: descrive la lista, non
   un importo.
2. **Gamba spaiata** = `type = 'transfer' AND transfer_group_id IS NULL`. Badge `unpaired` al posto
   di `transfer`.
3. **Il picker resta un `<details>` con un form GET**: niente portale. La containment di `<main>`
   rende `<main>` il blocco contenitore dei `fixed`, ma il pannello mobile ha `top:auto` e `inset-x-4`
   e `<main>` su mobile è largo quanto lo schermo: finisce dove finisce oggi. Il portale avrebbe
   tolto il funzionamento senza JavaScript.
4. **Intestazioni e KPI non seguono l'intervallo del grafico.** In Overview e in Account detail il
   saldo in testa, la variazione mensile e i KPI sono sempre "a oggi"; solo il grafico (e la tabella
   mensile di Account detail) seguono `from`/`to`. Oggi Account detail li mescola: è un difetto che
   il picker renderebbe visibile, e si corregge qui.
5. **Soglia larga.** `--container-wide: 100rem` (1600 px) in `@theme` di `globals.css`, variante
   `@wide:`. I vecchi `lg:` delle griglie di pagina diventano `@4xl:` (56 rem, 896 px di colonna:
   dove oggi scattano davvero, con la barra a icone).
6. **Adozione del genitore.** La sincronizzazione dà un genitore solo a una categoria che non ne ha,
   che non ha figlie, che ha lo stesso tipo del gruppo e il cui gruppo nessuno ha scelto a mano
   (`parent_set_locally`, scritto da `updateCategory` quando il gruppo cambia); un gruppo creato
   dalla sincronizzazione prende il tipo della figlia. Non sposta mai una categoria che un genitore
   ce l'ha già.
7. **Saldi ricostruiti.** Un mese riceve un `derived` all'ultimo giorno solo se non contiene
   **nessun** saldo osservato (`source` diverso da `system` e `derived`): `monthlyPoints` sceglie la
   data più recente del mese prima della fonte, quindi un `derived` a fine mese batterebbe una lettura
   reale di qualche giorno prima. Valore = saldo osservato successivo più vicino − movimenti nei giorni
   `(fine mese, data dell'osservazione]`. Mai prima dell'ultimo giorno del mese che precede il primo
   movimento importato. Si ricalcola **da capo** (cancella i `derived` del conto e li riscrive, in una
   transazione, senza I/O di rete).
8. **Solo la rilettura giudica.** Le finestre di recupero (primo collegamento o "Ri-scarica lo
   storico") importano senza dichiarare sparito nulla. Al primo collegamento non cambia niente (non
   c'è ancora niente di salvato); rende sicuro un recupero di 60 mesi.
9. **Nessun job nuovo.** La ricostruzione gira in coda a `walletPass` (dopo il tipo `transactions`) e
   dopo ogni saldo manuale salvato o cancellato su un conto sincronizzato. Un job registrato non
   aggiungerebbe niente che il registro di `sync_runs` non dica già.

## 4. Grafo delle attività

```
B ──┐
    ├── E ── A ── D ── cancello
C ──┘
```

B e C toccano file disgiunti; E ritocca le griglie delle pagine che B e C hanno appena cambiato; A
cambia lo schema e le letture della card; D usa `dailyNetByAccount` accanto alle query di B.

### B1 — Letture senza giroconti

**File:** `modules/transactions/queries.ts`, `queries.test.ts`, `service.itest.ts` (o un nuovo
`queries.itest.ts`).

- `transactionsSummary`: `count(*)`, somme condizionate per `income`/`expense`,
  `count(*) filter (where type = 'transfer')`, idem con `transfer_group_id is null`; `netCents`
  calcolato in TypeScript su `bigint`.
- `monthlyTotals`: `netCents = sum(case when type <> 'transfer' then amount_cents else 0 end)`.
- `monthGroups` e `MonthGroup` passano a `netCents`.
- `facetCounts`: terza dimensione `types`, contata senza il proprio filtro come le altre.

**Test (integrazione):** un giroconto appaiato (due gambe) più una spesa e un'entrata: `netCents` è
entrata + spesa; filtrando uno solo dei due conti il giroconto **non** compare in `expenseCents`;
una gamba spaiata conta in `unpairedTransferCount`; un mese con solo un giroconto ha `netCents = 0` e
`count = 1`.

**Commit suggerito:** `fix(expenses): i giroconti escono dai totali`

### B2 — Filtro per tipo e interfaccia

**File:** `modules/transactions/ui/filters.ts` (+ test), `ui/display.ts` (+ test), `ui/filter-bar.tsx`,
`app/(app)/expenses/page.tsx`, `messages/en.json`, `messages/it.json`.

- URL: `type=income|expense|transfer`; assente = tutti. `ExpensesQuery.type`, `ReadFilters.types`,
  compreso in `filtered`, in `params`, tolto da `clearedParams`.
- `LinkTabs` "Tutti · Entrate · Spese · Giroconti" nella barra dei filtri, con i conteggi della faccetta.
- `badgesOf`: `unpaired` al posto di `transfer` per una gamba spaiata; `ROW_BADGES` lo elenca.
- Intestazione: `count` movimenti · Entrate · Spese · Netto, più "N giroconti esclusi dai totali" (e
  "di cui M spaiati") quando ce ne sono. Le intestazioni di mese mostrano `netCents`.

**Test:** `parseExpensesQuery` legge, ignora un valore sconosciuto e cancella `type`; `badgesOf` di
una gamba spaiata e di una appaiata.

**Commit suggerito:** `feat(expenses): filtro per tipo e riepilogo entrate/spese/netto`

### C1 — Il picker in `src/ui`

**File:** crea `src/ui/url.ts`, `src/ui/date-range-picker.tsx`, `src/ui/date-range-picker.test.tsx`;
modifica `modules/accounts/ui/controls.tsx` (ri-esporta da `@/ui/url`),
`modules/transactions/ui/range-picker.tsx` (diventa l'involucro di Expenses: `useTranslations` +
`describe` con i giorni), `ui/display.ts` (`calendarCells` si sposta nel picker), i loro test.

- Stesso comportamento di oggi a `grain="day"`: primo clic apre, secondo chiude, due campi data, GET.
- `grain="month"`: la griglia sono i dodici mesi di due anni affiancati (quello del cursore e il
  precedente), i campi sono `type="month"`, l'invio scrive `from`/`to` = `AAAA-MM`.
- `src/ui` resta senza `next-intl` e senza import da `modules/` (verificato con un grep nel cancello).

**Test (DOM):** a grana mese, due clic selezionano l'intervallo e il form invia `AAAA-MM`; a grana
giorno i test del picker di oggi, spostati.

### C2 — Overview e Account detail

**File:** crea `modules/accounts/ui/range.ts` (+ test), `modules/accounts/ui/month-range-picker.tsx`
(involucro con `useTranslations("accounts.range")`); modifica `app/(app)/page.tsx`,
`app/(app)/accounts/[id]/page.tsx`, i messaggi.

- Overview: `from`/`to` accanto a `range`; con un intervallo valido il grafico legge
  `accountsView({ months, through })`, mentre intestazione, KPI e tabella leggono sempre la vista a
  oggi. I preset `3M · 1Y · All` tolgono `from`/`to`.
- Account detail: via il form con i due `type="month"`; il picker accanto agli span; intestazione e
  KPI dalla vista a oggi, grafico e tabella mensile dalla vista dell'intervallo.

**Test:** `monthRange` (valido, invertito, futuro riportato a oggi, spazzatura); e2e in
`accounts.spec.ts`: scelto un intervallo passato, l'intestazione mostra ancora il saldo di oggi.

**Commit suggerito (C1+C2):** `feat(ui): DateRangePicker unico, anche mensile, in Overview e Account detail`

### E1 — Colonna, soglia e griglie

**File:** `src/app/globals.css`, `src/ui/shell/page.tsx`, `app/(app)/page.tsx`,
`app/(app)/expenses/page.tsx`, `app/(app)/accounts/page.tsx`, `app/(app)/accounts/[id]/page.tsx`,
`modules/accounts/ui/balance-entries.tsx`, `modules/transactions/ui/transactions-table.tsx`,
`app/(app)/settings/layout.tsx`.

- `<main>`: `@container`, `max-w-[1920px]`.
- `lg:` → `@4xl:` sulle griglie di pagina elencate sopra (non sui form, che restano `sm:`).
- Oltre `@wide:` — Overview: grafico e tabella conti affiancati `7fr/5fr`; Expenses: tabella ·
  ripartizione · scorciatoie (la colonna destra diventa `@wide:contents`); Accounts e Account detail:
  grafico e tabella affiancati; tabella movimenti: i troncamenti di beneficiario (260 px) e categoria
  (140 px) si allargano.
- Settings: il contenuto sotto le schede ha `max-w-[960px]`.

**Test:** nuovo `tests/e2e/wide.spec.ts` a 1280, 1920 e 2560 px, barra aperta e chiusa (cookie
`sidebar`): larghezza di `<main>`, Expenses a tre colonne solo oltre la soglia (stessa `y`, `x`
crescenti), Overview con grafico e tabella affiancati a 2560 e impilati a 1280; niente scroll
orizzontale in nessun caso.

**Commit suggerito:** `feat(ui): container query e tre fasce sugli schermi larghi`

### A1 — Schema, migrazione, travaso

**File:** `modules/transactions/schema.ts`, `platform/integrations/rules.ts` (`ENTITY_TYPES`),
`drizzle/0004_category_hierarchy.sql` + snapshot + journal.

Il travaso, nel file SQL, **prima** di togliere `group` e il vecchio unico:

1. una categoria il cui nome è usato come `group` da un'altra dello stesso utente diventa una radice
   (il suo `group` si azzera), e così una che ha `group` uguale al proprio nome;
2. per ogni `(utente, btrim(group))` senza una categoria con quel nome si crea la radice, con il tipo
   della prima figlia in ordine di nome;
3. ogni categoria con `group` punta alla radice con quel nome **se ha lo stesso tipo**; altrimenti
   resta radice.

**Test (integrazione):** un terzo livello è rifiutato dal database; due figlie omonime sotto gruppi
diversi convivono; due radici omonime no; due figlie omonime sotto lo stesso gruppo no. Il travaso si
prova a mano su un database di prova migrato fino a 0003 (esito nel §9).

### A2 — Tassonomia e adozione

**File:** `modules/transactions/rules.ts` (`treeOrder` + test), `taxonomy.ts` (+ `taxonomy.itest.ts`),
`service.ts` (`ProviderIds`), `rules.ts` (`IncomingTransaction`),
`platform/integrations/wallet/mapping.ts` (+ test), `wallet/sync.ts` (+ test), `scripts/seed-dev.ts`,
`scripts/seed-e2e.ts`.

- Input: `parentId` al posto di `group`. Genitore inesistente, archiviato, non radice, sé stesso, o
  categoria con figlie che riceve un genitore → `invalid_parent`.
- La figlia prende il tipo del genitore; il cambio di tipo di un gruppo scende alle figlie.
- Archiviare un gruppo archivia le figlie attive con lo stesso istante; ripristinare ripristina solo
  lui.
- `adoptOrCreateCategory` con `group`: prima il gruppo (collegamento `category_group` → radice con
  quel nome esatto → creazione con il tipo della figlia), poi la figlia (collegamento → nome esatto
  sotto quel gruppo → nome esatto fra le radici, da attaccare secondo §3.4.6 → creazione sotto il
  gruppo).
- Wallet: `WalletTransaction` e `WalletCategory` portano `categoryGroupExternalId`/`Name`;
  `IncomingTransaction` anche; `toIncomingTransaction` prende il gruppo dal movimento, altrimenti
  dalla lista `/categories`.
- I seed danno un gruppo alle categorie, così lo sviluppo mostra la gerarchia.

**Test:** `treeOrder`; adozione con gruppo nuovo, con gruppo già collegato e rinominato in Wallet
(segue il collegamento), con una categoria F2 radice che viene attaccata, con tipo diverso che
**non** viene attaccata; archiviazione a cascata; cambio di tipo a cascata; `invalid_parent`.

### A3 — Letture e interfaccia

**File:** `queries.ts` (filtro per gruppo, `parentId` nelle fette), `ui/display.ts`
(`groupBreakdown` + test), `ui/breakdown-card.tsx`, `ui/filter-bar.tsx`, `ui/category-picker.tsx`,
`ui/view.ts`, `app/(app)/expenses/page.tsx`, `app/(app)/settings/data/categories/*`, messaggi.

- Filtro: un id di gruppo in `categoryIds` include le figlie, in SQL (`category_id in (…) or
  category_id in (select id from categories where parent_id in (…))`, con lo scope dell'utente).
- Card "By category": un `<details>` per gruppo con la sua somma e le figlie dentro; le categorie
  senza gruppo restano righe semplici.
- Menu dei filtri e selettore di riga: albero con le figlie rientrate; il conteggio di un gruppo è la
  somma delle figlie più il proprio.
- Settings › Data: tabella in ordine d'albero; nel dialogo "Gruppo" diventa un `Select` dei gruppi
  attivi (non sé stesso); con un genitore scelto il tipo è quello del genitore e il campo è
  disabilitato.

**Commit suggerito (A1–A3):** `feat(categories): gruppi e sottocategorie, anche da Wallet`

### D1 — Profondità del recupero

**File:** `platform/integrations/wallet/sync.ts` (+ `sync.test.ts`, `sync.itest.ts`),
`app/(app)/settings/integrations/actions.ts`, `wallet-card.tsx` (+ test), messaggi.

- `cursor.backfillMonths` (testo, 1–120, predefinito 12) decide quante finestre legge un recupero.
- `requestWalletBackfill`: riscrive il cursore senza `backfilledFrom`/`backfilledThrough` e con i
  mesi chiesti; l'azione poi lancia `syncWalletNow`.
- Solo `recentWindow` passa la finestra a `upsertFromProvider` (§3.4.8).
- Wallet card: un `Select` 12 · 24 · 36 · 60 · 120 mesi e "Ri-scarica lo storico".

**Test:** un recupero non marca sparito un movimento salvato che Wallet non restituisce più; la
rilettura sì; i mesi del cursore decidono il numero di finestre.

### D2 — Saldi ricostruiti

**File:** `modules/accounts/rules.ts` (+ test), `schema.ts`, `queries.ts`, `service.ts`
(+ `service.itest.ts`), `modules/transactions/queries.ts` (`dailyNetByAccount`),
`platform/integrations/wallet/sync.ts`, `drizzle/0005_balance_source_derived.sql`.

- `BALANCE_SOURCES` + `derived`; `SOURCE_RANK` esplicito: manual 0, import 1, provider 2, system 3,
  derived 4. `balancesOn({ observed })` esclude anche `derived`.
- `monthlyPoints` porta `derived` su ogni punto.
- `rebuildDerivedBalances` secondo §3.4.7, chiamata da `walletPass` e da `saveBalanceEntry` /
  `deleteBalanceEntry` sui conti sincronizzati.

**Test:** `deriveMonthEnds` (mese con lettura reale saltato; buco fra due letture riempito; nessun
mese prima di quello che precede il primo movimento; giroconti e nascosti contati; nessun movimento →
niente); integrazione: una seconda esecuzione non cambia nulla, un saldo manuale non viene mai
sovrascritto e sposta la ricostruzione dei mesi prima di lui.

### D3 — Tratteggio

**File:** `modules/accounts/rules.ts` (`estimatedMonths`), `queries.ts` (`AccountRow.estimated`,
`AccountsView.netWorthEstimated`), `src/ui/chart.tsx` (`AreaLine` + `estimated`), `chart.test.tsx`,
`app/(app)/page.tsx`, `app/(app)/accounts/[id]/page.tsx`, `balance-entries.tsx`, messaggi.

- Un tratto fra due mesi è tratteggiato se uno dei due è stimato; il tooltip aggiunge "stimato"; sotto
  il grafico una nota quando c'è almeno un mese stimato.
- Balance entries: badge "Ricostruito", nessuna azione di modifica (come `system`).

**Commit suggerito (D1–D3):** `feat(wallet): storico configurabile e patrimonio ricostruito dai movimenti`

## 5. Mappa dei file

| Zona | Lotti |
|---|---|
| `modules/transactions/queries.ts` | B1, A3, D2 |
| `modules/transactions/{rules,taxonomy,service,schema}.ts` | A1, A2 |
| `modules/transactions/ui/*` | B2, C1, A3 |
| `modules/accounts/{rules,queries,service,schema}.ts` | D2, D3 |
| `modules/accounts/ui/*` | C1, C2, E1, D3 |
| `platform/integrations/{rules.ts,wallet/*}` | A1, A2, D1, D2 |
| `src/ui/*` | C1, E1, D3 |
| `app/(app)/page.tsx`, `accounts/**`, `expenses/page.tsx` | B2, C2, E1, A3, D3 |
| `app/(app)/settings/**` | E1, A3, D1 |
| `messages/{en,it}.json` | tutti |
| `drizzle/*` | A1, D2 |

## 6. Cancello

Alla fine di ogni lotto: `npm run typecheck && npm test`, più `npm run test:integration` se il lotto
tocca il database. Alla fine di tutto, la lista di `CLAUDE.md` più il resto:

```
npm run format && npm run lint && npm run typecheck && npm run format:check && npm test
npm run test:integration
npm run build
npm run e2e
grep -rn "next-intl\|@/modules/" src/ui   # vuoto
```

## 7. Fatto quando

- Ogni riga *(F2.5)* della spec ha il suo codice e il suo test.
- Il cancello del §6 è verde.
- Il §9 qui sotto dice cosa è stato deciso in corsa, cosa è stato rimandato e perché.

## 8. Resta al proprietario

- Dividere e scrivere i commit (i messaggi suggeriti sono nei compiti).
- La ridistribuzione nel homelab: le due migrazioni girano all'avvio del container.
- Dopo la ridistribuzione, se si vuole più di un anno di storia: Settings › Integrations → "Ri-scarica
  lo storico".

## 9. Esito (2026-09-18)

Consegnati i cinque lotti, nell'ordine B, C, E, A, D. Cancello del §6, sull'ultimo stato:

| Controllo | Esito |
|---|---|
| `format`, `lint`, `typecheck`, `format:check` | verdi |
| `npm test` | 713/713 (base 681) |
| `npm run test:integration` | 252/252 (base 226) |
| `npm run build` + `npm run e2e` | 22/22, di cui 9 nuovi in `wide.spec.ts` e passi nuovi in `accounts` ed `expenses` |
| `src/ui` senza `next-intl` e senza `@/modules/` | vuoto |
| `db:generate` dopo le migrazioni | "No schema changes" |

### 9.1 Contratti del §3 cambiati in corsa

1. **`categories_parent_fk` non ha azione `ON DELETE`.** Postgres rifiuta qualunque azione su una
   chiave che contiene una colonna generata ("invalid ON DELETE action for foreign key constraint
   containing generated column"): trovato applicando `0004` a un database di prova. Non serve: una
   categoria si archivia e non si cancella (§7.2), e cancellare un utente porta via gruppi e figlie
   nella stessa istruzione (provato sullo stesso database). §3.1 e §3.2 dicevano `SET NULL`.
2. **`0004` è scritta a mano da due passaggi di drizzle-kit.** Togliere `group` e aggiungere
   `parent_id` nello stesso passaggio fa chiedere a drizzle-kit, in modo interattivo, se è una
   rinomina, e senza terminale si ferma. Primo passaggio con `group` ancora nello schema, secondo
   senza; i due file uniti in `0004`, riordinati (l'unico `(id, is_root)` prima della chiave che lo
   usa) e con il travaso nel mezzo. Lo snapshot `0004` è lo schema finale con `prevId` sul `0003`.
3. **`categories.parent_set_locally`, colonna in più dentro `0004`.** Senza, la sync rimetteva ogni
   ora nel suo gruppo Wallet una categoria che qualcuno aveva tolto a mano: esattamente la modifica
   locale che §7.2 dice non vada mai annullata (lo stesso difetto delle etichette, review B12).
   `updateCategory` la scrive quando il gruppo cambia; `attachToGroup` la rispetta. Spec §6 e §9.1
   aggiornate.
4. `listCategories` restituisce `TreeCategory` (con `depth`) e `CategoryWithUsage` ha `depth`.
5. Le profondità del recupero stanno in `platform/integrations/wallet/depth.ts`, non in `sync.ts`: la
   card di Settings le usa nel browser, `sync.ts` è `server-only` e `mapping.ts` porterebbe con sé
   tutto lo schema dei payload.
6. `TransactionsSummary.totalCents` (la somma con segno, giroconti inclusi) non esiste più: al suo
   posto `netCents`, e così `MonthTotal`/`MonthGroup`.

### 9.2 Difetti trovati verificando, non accettando i rapporti

1. **Overview e Account detail mescolavano oggi e finestra del grafico.** Lo YTD di Overview era "—"
   con il preset 3M (calcolato sulla finestra del grafico); in Account detail saldo in testa,
   variazione e "Year over year" seguivano la finestra, e con uno span sotto i 13 mesi lo YoY era
   sempre vuoto. Ora leggono sempre la vista a oggi (§3.4.4); l'e2e dei conti lo verifica con un
   intervallo che finisce a gennaio.
2. **Il pannello del picker usciva per metà dallo schermo sul telefono**: `-translate-x-1/2` restava
   attivo sotto `max-md:inset-x-4`. Dopo la correzione, misurato a 400 px: x = 16, larghezza 368.
3. La card di Wallet mostrava "Couldn't save" per i codici `busy` e `provider`.
4. Il titolo del grafico del conto diceva "1 months": ora è un plurale ICU (un intervallo di un mese
   col picker mensile lo rendeva visibile).
5. L'e2e non partiva: Playwright 1.63 vuole Chromium `1243` e la cache aveva il `1234`. Installato
   con `npx playwright install chromium`.
6. Un'attesa sbagliata nel test di `deriveMonthEnds` (3.020 €, non 2.520 €), trovata ricalcolando a
   mano prima di scrivere l'implementazione.

7. **In produzione, dopo la prima distribuzione (2026-09-18): ogni passaggio `transactions` falliva.**
   Due gruppi Wallet con id diversi arrivavano allo stesso gruppo locale ("Financial expenses"), e
   il secondo collegamento violava `provider_links_entity_uq`. `linkExternal` doveva trasformarlo in
   `link_conflict`, ma lo riconosceva con `instanceof DrizzleQueryError`: il bundle di produzione
   contiene più copie di drizzle-orm, l'errore veniva da un'altra copia, e il conflitto usciva grezzo.
   Lo Storico mostrava "Couldn't save" per questo. `isUniqueViolation` ora risale la catena delle
   `cause` senza `instanceof`, con un test che simula la classe estranea. Nei test non si vedeva:
   vitest carica una copia sola.

8. **La tabella di Expenses scorreva di lato con nomi reali**, a ogni larghezza (segnalato dal
   proprietario dopo la ridistribuzione). In layout automatico i tetti `max-w-*` delle celle
   diventano la larghezza della colonna invece di far troncare, e il lotto E li aveva pure alzati
   mentre la terza fascia restringeva la tabella. Ora la tabella è `table-fixed` con un
   `<colgroup>`, il testo tronca (nome intero al passaggio del mouse), e Expenses non ha più una
   terza fascia: Shortcuts sta sopra By category e la tabella prende 9/12 oltre la soglia larga.
   `wide.spec.ts` lo verifica con testi lunghi a 1280, 1920 e 2560 px.

### 9.3 Deviazioni consapevoli, da portare alla revisione di fase di §11

1. **Il picker resta un `<details>`, senza portale**: con la containment di `<main>` il pannello
   mobile resta dov'era, e un portale avrebbe tolto il funzionamento senza JavaScript. §8.3 corretta.
2. **Settings a 960 px, non 720**: a 720 il registro delle sincronizzazioni (sei colonne) non ci sta.
   §8.2 corretta.
3. **Ogni recupero è import-only, non solo il ri-scaricamento** (§3.4.8, §9.1): al primo collegamento
   non cambia niente, perché non c'è ancora niente di salvato.
4. **Nessun job registrato per la ricostruzione** (§3.4.9): gira in coda a `walletPass` e dopo ogni
   saldo manuale salvato o cancellato.
5. Il seed e2e non ha gruppi di categorie, perché il percorso verifica le righe della card una a
   una; la gerarchia è coperta da test d'integrazione (`taxonomy`, `sync`, `service`) e DOM
   (`categories-card`, `display`).
6. Il grafico multi-conto della pagina Accounts non è tratteggiato: solo Overview e Account detail.
7. La ricostruzione conta anche i movimenti `pending`. Se Wallet li lascia fuori dal saldo letto, i
   mesi ricostruiti possono differire di quegli importi finché non vengono liquidati.
8. Durante la verifica `ledgerly_e2e` è stato ricreato vuoto: aveva applicato una versione intermedia
   di `0004`, senza `parent_set_locally`. Nessun altro database l'ha mai vista.

### 9.4 Resta al proprietario

- I commit: niente è stato committato, e nel working tree ci sono anche `README.md`,
  `docker-compose.yml` e D20/§13 della spec, che sono del proprietario.
- In locale: `npm run db:migrate && npm run dev:seed` (le due migrazioni e il seed con gruppi e
  mesi ricostruiti).
- La ridistribuzione nel homelab; dopo, se si vuole più di un anno di storia, Settings ›
  Integrations › Storico › "Scarica di nuovo".
- Uno sguardo su un vero schermo 2K: l'e2e misura posizioni e larghezze, non il gusto.
