# F2 — Integrazioni, Wallet, Expenses

> Piano pensato per l'**esecuzione in parallelo**: un orchestratore distribuisce le attività ad agenti
> che lavorano su file disgiunti e si coordinano solo dove serve. Chi lo esegue non ha il contesto
> della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

Leggere **prima di toccare qualunque cosa**, in quest'ordine:

1. `CLAUDE.md` alla radice — convenzioni vincolanti del repository.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — §4.2 (anatomia di un modulo), §4.3 (convenzioni
   obbligatorie), §6 (tabelle), §7.2 (Expenses), §9.1 (Wallet), §9.4 (servizi), §10 (job), §11 (test).
3. `docs/plans/2026-09-13-f1-accounts-overview.md` — cosa ha già fatto F1 e con quali scelte.
4. Il modulo `src/modules/accounts/` come modello: è la forma che F2 deve imitare.

La specifica vince sempre su questo piano. Questo piano non ripete le regole di §7.2 e §9.1: le
**decompone**. Se una regola qui sembra contraddire la specifica, vale la specifica — e va segnalato.

## 1. Obiettivo

F2 secondo §12: **cassaforte delle credenziali, motore di sincronizzazione, Settings › Integrations;
Wallet; §7.2 per intero; categorie ed etichette in Settings › Data.**

Fuori perimetro, da non anticipare: budget (F3), pockets (F3), abbonamenti (F3), interessi (F4),
fondi (F4), importazioni e payroll (F5–F6), ferie e Trek (F7), Admin e `/api/v1` (F8).

## 2. Punto di partenza

- Repository: `/home/mattia/docker/projects/ledgerly`, branch **`dev-0.1`**.
- Sviluppo: `npm run dev:services && npm run db:migrate && npm run dev:seed && npm run dev`.
- L'app è già distribuita nel homelab (`docker-compose.yml`, `.env.homelab`): **non ridistribuire**
  finché F2 non è chiusa e verificata.
- `Fondo Cometa/`, `Payroll/`, `UI Recreation and branding decisions/` sono materiale locale del
  proprietario: in sola lettura, mai committati. Il prototipo del design sta nella terza.
- Implementazione di riferimento della versione precedente, **solo da leggere, mai da copiare**
  (§14, D16): sul branch `main`, sotto `dashboard-app/src/lib/clients/wallet.ts`,
  `dashboard-app/src/lib/jobs/wallet-*.ts`, `dashboard-app/src/modules/expenses/`.
  Il branch `main` esiste **solo sul remoto**: si consulta con `git show origin/main:<percorso>`,
  non con `git show main:…`, che fallisce.

### Cosa esiste già e va riusato, non riscritto

| Serve a | Dove | Nota |
|---|---|---|
| Cifratura AES-256-GCM con chiave ruotabile | `src/platform/crypto.ts` | `parseKeyRing`, `seal`, `open`, `sealJson`, `openJson` |
| Adozione/rinomina/sparizione dei conti del provider | `src/modules/accounts/service.ts` → `applyProviderAccounts` | Le regole pure stanno in `rules.ts` → `reconcileProviderAccounts` |
| Scrittura di un saldo del provider | `src/modules/accounts/service.ts` → `saveBalanceEntry` | Attenzione: oggi scrive `source: "manual"`. F2 aggiunge la variante `provider` |
| Notifiche con anti-ripetizione | `src/platform/notifications/service.ts` → `notifyOnce` | Usare per "sincronizzazione fallita" (§10.4) |
| Job, lock, tick, `job_runs` | `src/platform/jobs/` | Un job nuovo si registra in `registry.ts` |
| Soldi, date, formati | `src/platform/money.ts`, `dates.ts`, `format.ts` | `parseCents` accetta solo decimali semplici |
| Controlli link/URL, tooltip dei grafici | `src/modules/accounts/ui/controls.tsx`, `src/ui/chart-hover.tsx` | Riusare per i filtri e i grafici di Expenses |

## 3. Contratti decisi in anticipo

Servono perché gli agenti **non debbano negoziare** mentre lavorano. Chi li cambia in corsa avvisa
l'orchestratore, che avvisa gli altri (§7).

### 3.1 Collocazione

```
src/platform/integrations/        piattaforma: cassaforte, collegamenti, provider_links, sync
  schema.ts  service.ts  rules.ts
  wallet/client.ts                HTTP di Budget Makers Wallet, nessun accesso al database
  wallet/mapping.ts               funzioni pure: tipi, importi, finestre
  wallet/sync.ts                  motore: chiama i service dei moduli, mai le loro tabelle
src/modules/transactions/         modulo di dominio (§4.2)
  schema.ts  rules.ts  taxonomy.ts  service.ts  queries.ts  actions.ts  jobs.ts  ui/
```

`wallet/sync.ts` sta in `platform/` perché coordina **due** moduli (accounts e transactions)
attraverso i loro `service.ts`. Non importa mai lo `schema.ts` di un modulo: è un errore di lint
verificato da `src/architecture.test.ts`.

### 3.2 Tabelle

Colonne essenziali; il resto segue §6 e le convenzioni di §4.3 (uuidv7, `created_at`, `updated_at`,
`user_id`, centesimi in `bigint`, date civili in `date`, istanti in `timestamptz`, FK reali).

- `integration_connections` — `user_id`, `provider`, `credentials bytea` (sigillata con
  `sealJson`), `state` (`active|error|revoked`), `last_ok_at`, `last_error`. Unica su
  `(user_id, provider)` finché un provider ammette un solo collegamento per utente.
- `provider_links` — **la forma è dettata da §4.3 e non si discute**:
  `(user_id, provider, entity_type, entity_id, external_id, metadata, first_seen_at, last_seen_at,
  missing_since)`, unica su `(user_id, provider, entity_type, external_id)` **e** su
  `(user_id, provider, entity_type, entity_id)`.
- `sync_jobs` — stato per `(connection_id, kind)`: `cursor jsonb`, `next_run_at`, `last_run_at`.
- `sync_runs` — una riga per esecuzione: `connection_id`, `kind`, `state`, `started_at`,
  `finished_at`, `counts jsonb`, `error`.
- `categories` — `name`, `group`, `type`, `color`, `archived_at`.
- `labels` — `name`, `color`.
- `transactions` — `account_id`, `occurred_at timestamptz`, `amount_cents` con segno, `currency`,
  `type` (`income|expense|transfer`), `state`, `category_id`, `payee`, `note`,
  `transfer_group_id`, `hidden_at`, `removed_upstream_at`, `locally_edited text[]`.
- `transaction_labels` — `(transaction_id, label_id)`.
- `recurring_patterns` — §7.2: chiave beneficiario normalizzato + valuta + segno, intervallo medio,
  importo mediano, prossima data attesa, numero di occorrenze.

### 3.3 Firme che gli altri agenti chiamano

Da rispettare alla lettera; il corpo è libero.

```ts
// platform/integrations/service.ts
saveConnection(ctx, input: { provider: string; credentials: Record<string, string> }): Promise<Connection>
readCredentials(ctx, connectionId: string): Promise<Record<string, string>>
listConnections(ctx): Promise<Connection[]>
deleteConnection(ctx, connectionId: string): Promise<void>
recordRun(ctx, input: { connectionId: string; kind: SyncKind }): Promise<SyncRun>
finishRun(ctx, runId: string, outcome: { counts: Record<string, number>; error?: string }): Promise<void>
linkExternal(ctx, input: ProviderLink): Promise<void>
resolveExternal(ctx, provider: string, entityType: string, externalIds: string[]): Promise<Map<string, string>>

// platform/integrations/wallet/client.ts — nessun accesso al database, nessuna transazione
createWalletClient(token: string): {
  accounts(): Promise<WalletAccount[]>
  balances(): Promise<WalletBalance[]>
  transactions(window: { from: CivilDate; to: CivilDate }): Promise<WalletTransaction[]>
}

// modules/transactions/service.ts
upsertFromProvider(ctx, accountId: string, incoming: IncomingTransaction[]): Promise<{ created: number; updated: number; skipped: number }>
updateTransaction(ctx, id: string, patch: TransactionPatch): Promise<Transaction>   // marca locally_edited
hideTransaction(ctx, id: string): Promise<void>
markRemovedUpstream(ctx, ids: string[]): Promise<void>

// modules/transactions/taxonomy.ts
listCategories(ctx): Promise<Category[]>
adoptOrCreateCategory(ctx, name: string): Promise<Category>   // collegamento → nome esatto → creazione
```

### 3.4 Due trappole già pagate in F1

1. **Niente `$` nei valori d'ambiente**: Compose interpola anche il contenuto di `env_file` e
   troncherebbe il valore. Vale per il token Wallet e per `APP_ENCRYPTION_KEY`.
2. **`Field` e `Input` sono componenti client.** Una pagina server che li usa senza il loro
   `"use client"` rompe la build, e il test non se ne accorge: solo `npm run build` lo vede.

## 4. Grafo delle attività

```
        ┌──────────────────────────── T0 fondamenta (sequenziale, blocca tutto)
        │
        ├── gruppo A (in parallelo) ──┬── T1 cassaforte e collegamenti
        │                             ├── T2 client Wallet
        │                             ├── T3 regole delle transazioni
        │                             └── T4 categorie ed etichette
        │
        ├── gruppo B (in parallelo) ──┬── T5 servizio e letture delle transazioni   (dipende da T3)
        │                             ├── T6 interfaccia Expenses                   (dipende da T5*)
        │                             └── T7 Settings › Integrations                (dipende da T1)
        │
        ├── T8 motore di sincronizzazione            (dipende da T1, T2, T3, T5)
        │
        └── T9 integrazione e cancello               (orchestratore)
```

`*` T6 può partire insieme a T5 lavorando **contro le firme di §3.3**, e chiude quando T5 consegna.

### T0 — Fondamenta (un solo agente, nessun parallelismo)

Blocca tutto, quindi va fatta bene e in fretta.

1. Le tabelle di §3.2 in `platform/integrations/schema.ts` e `modules/transactions/schema.ts`.
2. `APP_ENCRYPTION_KEY` nello schema di `src/platform/env.ts` (**oggi non c'è**) e in tutti i file
   d'ambiente: `.env.example`, `.env`, `.env.homelab`, `vitest.config.ts`, `tests/e2e/env.ts`.
   Formato `id:base64[,vecchie…]` (§9.4), letto da `parseKeyRing`.
3. Registrazione in `src/platform/db/tables.ts`.
4. **Una sola** migrazione: `npm run db:generate`, poi rinominarla `drizzle/0003_<nome>.sql` e
   allineare il `tag` in `drizzle/meta/_journal.json`. Nessun altro agente esegue `db:generate`.
5. **Semina del catalogo dei messaggi**: tutte le chiavi `expenses.*`, `settings.integrations.*`,
   `settings.data.*` in `messages/en.json` **e** `messages/it.json`, con testi definitivi. Senza
   questo passo ogni agente dell'interfaccia rompe il typecheck, perché `next-intl` tipizza le
   chiavi. È il vero sblocco del parallelismo: vale la pena spenderci tempo.
6. Voce di menu Expenses in `src/app/(app)/navigation.ts`, tipo in `nav-types.ts`, icona in
   `src/ui/shell/icons.ts`, e aggiornamento di `navigation.test.ts`.

Fatta quando: `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run test:integration` passano
(le migrazioni girano da database vuoto) e la migrazione è una sola.

### T1 — Cassaforte e collegamenti

`platform/integrations/service.ts` + `rules.ts`. Credenziali sigillate con `sealJson` e mai
restituite in chiaro fuori da `readCredentials`. `provider_links` con le due chiavi uniche.
`sync_runs`/`sync_jobs`. Test di integrazione **compreso l'isolamento fra utenti** (§11).
Mai loggare una credenziale, nemmeno redatta.

### T2 — Client Wallet

`platform/integrations/wallet/client.ts` + `mapping.ts`. Da §9.1, senza inventare:
mappatura dei tipi di conto; letture con 5 tentativi e attesa esponenziale che rispetta
`Retry-After`; scritture con un solo tentativo; 401/403 falliscono subito con "token rifiutato";
paginazione a finestre di date che **divide la finestra invece di fallire** quando una pagina è
piena; primo collegamento che recupera 12 mesi per finestre mensili di `recordDate`.
Gli importi passano dalla **stringa decimale**, mai da `number` (§4.3).
Nessun accesso al database. Test unitari con `fetch` finto e fixture sintetiche in `tests/fixtures/`.

### T3 — Regole delle transazioni

`modules/transactions/rules.ts`, funzioni pure con test unitari. Da §7.2, con le soglie **esatte**:
abbinamento dei giroconti solo per riferimento del movimento opposto (chiave = coppia ordinata degli
id esterni, id del gruppo = il più piccolo id locale), mai per importo e data; rilevamento ricorrenze
con le fasce di intervallo e il ±10 % sulla mediana; merge che rispetta `locally_edited`; semantica
di `hidden_at` e `removed_upstream_at`.

### T4 — Categorie ed etichette

`modules/transactions/taxonomy.ts` + la sezione in Settings › Data. Crea, rinomina, colore,
archivia. Attenzione: `src/app/(app)/settings/data/page.tsx` **esiste già** e appartiene a F1 (il
registro degli snapshot). T4 non lo riscrive: mette la propria interfaccia in componenti sotto
`settings/data/categories/` e chiede all'orchestratore, nel rapporto finale, la riga che li innesta
nella pagina. `adoptOrCreateCategory` segue §9.1: collegamento, altrimenti nome esatto,
altrimenti creazione.

### T5 — Servizio e letture delle transazioni

`modules/transactions/service.ts` + `queries.ts` + `actions.ts`. `upsertFromProvider` idempotente,
che non sovrascrive mai un campo in `locally_edited`. Letture con filtri, intervallo date,
raggruppamento per mese e aggregato per categoria. Ogni elenco con `ORDER BY` deterministico, ogni
query con `userScoped(ctx)`.

### T6 — Interfaccia Expenses

`modules/transactions/ui/` + `src/app/(app)/expenses/`. La schermata del design: filtri, intervallo
con preset, ricerca beneficiario, azioni multiple (imposta categoria, nascondi), "Show hidden",
gruppi per mese, card "By category". **I controlli statici del prototipo devono funzionare**
(§8.4 punto 2): riusare `LinkTabs`/`PeriodStepper` di `modules/accounts/ui/controls.tsx` e tenere
lo stato nell'URL, così la pagina la rende il server.

### T7 — Settings › Integrations

Pagina del collegamento: inserimento del token, prova della connessione, stato, "Sync now" (§10.3),
scollegamento. Il token non torna mai al browser dopo il salvataggio.

### T8 — Motore di sincronizzazione

`platform/integrations/wallet/sync.ts` + il job orario in `registry.ts` (tier `hourly`, §10.2).
Conti e saldi via `applyProviderAccounts` e la variante `provider` di `saveBalanceEntry`;
transazioni via `upsertFromProvider`. **Nessuna chiamata di rete dentro una transazione**: si
recupera fuori e si applica in una transazione breve. Sincronizzazione fallita o obsoleta →
`notifyOnce`. Ogni esecuzione in `sync_runs`.

### T9 — Integrazione (orchestratore)

Unione delle richieste sui file condivisi, percorso end-to-end di Expenses a 1440 px e 400 px,
aggiornamento di `README.md`, cancello completo, commit.

## 5. Mappa di proprietà dei file

Un file ha **un solo proprietario**. Chi non è proprietario non lo tocca, nemmeno per una riga.

| Proprietario | File |
|---|---|
| T1 | `src/platform/integrations/{schema,service,rules}.ts` + test |
| T2 | `src/platform/integrations/wallet/{client,mapping}.ts` + test + `tests/fixtures/wallet/**` |
| T3 | `src/modules/transactions/rules.ts` + test |
| T4 | `src/modules/transactions/taxonomy.ts` + test, `src/app/(app)/settings/data/categories/**` |
| T5 | `src/modules/transactions/{service,queries,actions}.ts` + test |
| T6 | `src/modules/transactions/ui/**`, `src/app/(app)/expenses/**` |
| T7 | `src/app/(app)/settings/integrations/**` |
| T8 | `src/platform/integrations/wallet/sync.ts`, `src/modules/transactions/jobs.ts` |

**Solo l'orchestratore** scrive questi, perché ogni agente li vorrebbe toccare:

`messages/en.json`, `messages/it.json`, `src/platform/db/tables.ts`, `src/platform/jobs/registry.ts`,
`src/app/(app)/navigation.ts`, `src/ui/shell/nav-types.ts`, `src/ui/shell/icons.ts`, `drizzle/**`,
`src/platform/env.ts`, `.env*`, `vitest.config.ts`, `tests/e2e/env.ts`, `package.json`, `CLAUDE.md`,
`README.md`, `docs/**`.

Un agente che ha bisogno di una riga in uno di questi **non la scrive**: la mette nel proprio
rapporto finale, testuale e pronta da incollare, e l'orchestratore la applica in T9. Le chiavi dei
messaggi sono l'eccezione già risolta: le semina T0, quindi durante il lavoro non servono.

## 6. Protocollo dell'orchestratore

1. Esegue T0 da solo, o lo affida a un agente e aspetta. **Non distribuisce nulla prima che T0
   sia verde**: senza tabelle e senza chiavi dei messaggi ogni altro agente fallisce il typecheck.
2. Distribuisce il gruppo A in parallelo, poi il gruppo B, poi T8. Dentro un gruppo gli agenti
   partono insieme.
3. A ogni agente consegna: il proprio blocco di §4, la mappa di §5, le firme di §3.3 e il cancello
   di §8. Niente di più: un agente che legge tutto il piano si distrae.
4. Fra un gruppo e l'altro esegue il cancello completo e **committa**. Un gruppo non parte su un
   albero rotto.
5. Tiene il **lucchetto del database di integrazione** (§7).
6. In T9 unisce le richieste sui file condivisi, aggiunge il percorso end-to-end, chiude il cancello.

Se un agente restituisce lavoro che non rispetta un contratto di §3, l'orchestratore **non lo
aggiusta in silenzio**: lo rimanda indietro con il contratto citato, oppure cambia il contratto e
avvisa tutti quelli che lo usano.

## 7. Comunicazione fra agenti

Poca e con uno scopo. Tre casi soltanto:

- **Lucchetto del database.** `test/integration-setup.ts` fa `DROP SCHEMA public CASCADE` prima di
  ogni corsa: due agenti che eseguono `npm run test:integration` insieme si distruggono i dati a
  vicenda. Chi vuole eseguirli lo chiede all'orchestratore, aspetta il via, e avvisa quando ha
  finito. Durante il lavoro gli agenti usano `npx tsc --noEmit` e i test unitari, che non toccano
  il database.
- **Contratto da cambiare.** Chi scopre che una firma di §3.3 non regge scrive **all'orchestratore**,
  non agli altri. L'orchestratore decide e propaga. Evita che due agenti concordino una modifica che
  un terzo non conosce.
- **Consegna anticipata.** Chi finisce una firma che sblocca qualcun altro glielo dice direttamente
  (T2 → T8, T3 → T5, T5 → T6), così l'altro smette di lavorare contro un contratto e passa al codice
  vero.

Tutto il resto passa dal rapporto finale. Un agente **non chiede permesso** per decisioni dentro i
propri file: decide, e le motiva nel rapporto.

## 8. Cancello

Per ogni agente, prima di consegnare, sui propri file:

```bash
npx tsc --noEmit && npx eslint <i propri file> && npx vitest run --project unit-node <i propri test>
```

Per l'orchestratore, fra un gruppo e l'altro e alla fine:

```bash
npm run format && npm run lint && npm run typecheck && npm run format:check \
  && npm test && npm run test:integration && npm run e2e
```

`npm run e2e` esegue anche `npm run build`: è l'unico passo che vede gli errori "componente client
usato in una pagina server" (§3.4). Non saltarlo.

Il cancello di fase di §11 chiede anche il **confronto visivo con il design** e una **revisione
divisa per aree**: sono passaggi del proprietario, l'orchestratore li chiede, non li dichiara fatti.

## 9. Fatto quando

- §7.2 funziona per intero sulle transazioni sincronizzate: modifica locale che vince, nascondi,
  sparite dal provider, giroconti, ricorrenze, categorie ed etichette.
- Un collegamento Wallet si crea in Settings › Integrations, il primo recupero prende 12 mesi, quello
  orario rilegge gli ultimi 7 giorni, e nessuna modifica locale viene sovrascritta.
- Le credenziali stanno cifrate a riposo e non tornano mai al browser.
- Tutto il cancello di §8 è verde, la migrazione è una sola e parte da database vuoto.
- Il piano è aggiornato con l'esito: cosa è stato deciso, cosa è stato rimandato e perché.

## 10. Dipendenza che nessun agente può risolvere

Il **token di Budget Makers Wallet** è del proprietario. Senza, T2 e T8 si costruiscono e si testano
contro fixture sintetiche e il contratto documentato in §9.1, ma il primo collegamento vero e il
recupero dei 12 mesi restano da fare a mano. Non è un motivo per fermarsi: è un motivo per tenere il
client onesto sulle fixture e chiedere il token quando F2 è pronta da collaudare.
