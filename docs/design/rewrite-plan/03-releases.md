# 3. Fasi e rilasci

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md). Niente date: solo ordine, dipendenze e dimensione relativa (S / M / L).

## 3.1 Regole comuni a ogni rilascio

**Git** (`git-policy` §1, §2, §3, §6):

- Default: commit diretti su `main`, piccoli, ognuno con i test verdi e senza cambi di comportamento in produzione.
- Branch + PR solo se il diff tocca un criterio §6. La colonna «Git» di ogni rilascio dice il criterio atteso; la
  valutazione vera si fa sul diff, prima del push.
- Un solo branch e una sola PR aperti per volta. Con i due filoni (da R2) il filone client lavora su `main`; solo il
  filone server apre PR, una per volta.
- Squash merge, nessun riferimento a issue in commit e PR, tag `vX.Y.Z` dopo ogni deploy riuscito.

**Prima del deploy:**

1. `docker tag` di ogni immagine che cambia: `ledgerly:pre-<id>` (e `ledgerly-cron`, `ledgerly-web`, plugin).
2. Dump `pg_dump -Fc` se il rilascio ha una migrazione o una modifica ai dati. Destinazione: [`06-data.md`](06-data.md) §6.3.
3. Fotografia dei numeri «prima» ([`06-data.md`](06-data.md) §6.4).

**Gate** (tutti i rilasci, salvo dove indicato). Il gate di un rilascio è: test, controlli automatici, verifica
dell'orchestratore. **Nessuna review del codice, in nessun rilascio** (decisione H6). La colonna «Serve a» dice quale
priorità o vincolo il gate protegge ([`10-modularity.md`](10-modularity.md) §10.1).

| Gate | Serve a | Comando o controllo |
|---|---|---|
| G4 Modularità | Priorità 1 | `src/architecture.test.ts` esteso: confini tra pacchetti e tra moduli, nessun import profondo, nessun ciclo, nessun accesso alle tabelle di un altro modulo, interfaccia pubblica esplicita, struttura dei file (M1-M10, Q1-Q4). Misura dei duplicati (M11). Rilascio di ingresso di ogni regola: [`10-modularity.md`](10-modularity.md) §10.6 |
| G1 Statico | Priorità 2 | `npm run format:check`, `npm run lint` (da R0 con dimensione, complessità e nomi: Q5-Q8, Q10), `npm run typecheck` (da R0 con il controllo del codice senza uso: Q9) |
| G9 Prestazioni | Priorità 3 | Da N0: `npm run perf` esteso contro i valori di partenza; numero di query per vista e per rotta ([`10-modularity.md`](10-modularity.md) §10.9). Nessuna misura peggiora di oltre il 10% |
| G2 Unit | Vincolo | `npm test`; `assertions-diff`: nessuna asserzione esistente adattata |
| G3 Integration | Vincolo | `npm run test:integration` sul database di test del filone |
| G5 Stessi numeri | Vincolo | Test di parità Overview = conti singoli = API = MCP; fotografia «prima» = fotografia «dopo»; risposte di riferimento di API e MCP uguali |
| G6 E2E | Vincolo | `npm run e2e` sulle specifiche toccate, dopo il deploy; comprende `a11y.spec.ts`, `keyboard.spec.ts`, `security.spec.ts` |
| G7 Verifica dell'orchestratore | Tutti | L'orchestratore legge gli esiti dei gate e la lista di controllo del rilascio, non il codice ([`08-agents.md`](08-agents.md) §8.5) |
| G8 Health | Rilascio | `GET /api/health` con versione attiva e database; un flusso reale del rilascio |

Da N0, G4 e G9 valgono per ogni rilascio, anche dove la riga «Test e gate» non li cita. Nei rilasci prima di R0 il
loro controllo è «non peggiora»: nessuna violazione nuova rispetto alle liste note.

**Rollback standard:** `docker tag ledgerly:pre-<id> ledgerly:latest && docker compose up -d --no-build`. Lo schema resta:
ogni migrazione è compatibile con l'immagine precedente ([`06-data.md`](06-data.md) §6.2). Il dump si ripristina solo
se una modifica ai dati è sbagliata.

**OK di Mattia:** sul singolo SHA, per ogni rilascio con un criterio §6. La richiesta contiene criterio, cosa cambia,
piano di recupero, SHA e comando.

---

## Fase A · lavoro «ora» sul codice attuale

Dettaglio tecnico: [`04-now.md`](04-now.md).

Prima di N0, fuori dai rilasci del piano: la correzione del difetto BUD-1 (stop di un budget per conto), come `fix` in
una sotto-issue separata (decisione H4). È in `main` a `86e3d43`, tag `v0.10.2`.

### N0 · Preparazione

| | |
|---|---|
| Obiettivo | Togliere gli ostacoli ai rilasci successivi |
| Contenuto | Cartella dei dump ([`06-data.md`](06-data.md) §6.3) e aggiornamento di `docs/operations.md`, `docs/RELEASE.md` e dell'`AGENTS.md` locale. Script della fotografia dei numeri. Misure di partenza delle tre priorità, senza cambi al codice di prodotto: liste note delle violazioni di modularità in `src/architecture.test.ts` (cicli, import tra moduli), prima misura dei duplicati, `npm run perf` esteso con il file dei valori di partenza, risposte di riferimento di API e MCP, script `assertions-diff` ([`10-modularity.md`](10-modularity.md); decisione I14). `package.json` alla versione del tag (oggi dichiara `0.2.0`). Manifest web e icone: Ledgerly si installa dal browser |
| Per l'utente | Icona e finestra propria su Android e Windows, dal browser |
| Git | `main` · commit `chore`, `docs`, `feat(web)` |
| Migrazioni | Nessuna |
| Rollback | Immagine `pre-n0` |
| Test e gate | G1, G2, G4, G6 (shell, a11y), G7, G8. Lo script della fotografia e la misura dei duplicati girano due volte di seguito con lo stesso risultato |
| Criteri di accettazione | La cartella dei dump esiste con i permessi previsti. Un dump di prova si crea e si verifica con `pg_restore --list`. Il browser offre «Installa». La fotografia dei numeri è stabile. I valori di partenza di modularità, duplicati e prestazioni sono nel repo e in [`10-modularity.md`](10-modularity.md) |
| OK di Mattia | Già dato il 14/11/2026: il percorso dei dump (decisione I1) |
| Dipende da | OK al piano |
| Dimensione | S |

### N1 · Runtime minimo dei plugin e plugin Enable Banking

| | |
|---|---|
| Obiettivo | Collegare una banca vera attraverso un plugin. Provare il contratto dei plugin su un caso reale |
| Contenuto | Passo 1: prova su una banca vera (S4). Poi: contratto v1 (`manifest`, `verify`, `auth/start`, `auth/complete`, `sync`), lato core che chiama il plugin, rete `ledgerly_plugins`, container `ledgerly-plugin-enablebanking`, credenziali Enable Banking per utente cifrate nel core, flusso di consenso con ritorno su `/api/v1/plugins/enablebanking/callback`, prima sync subito dopo il consenso, letture automatiche (3 al giorno), «Sincronizza ora» con header `Psu-*`, tab Plugin essenziale (admin), procedura guidata «Collega una banca». Campi grezzi della banca salvati sul movimento |
| Per l'utente | L'admin attiva il plugin. Ogni utente inserisce la sua applicazione Enable Banking e collega una banca. I conti della banca sono conti nuovi o conti manuali esistenti |
| Git | Branch + PR · `feat(plugins)` · criteri #1 (schema), #3 (rete nuova), #4 (rotta di ritorno legata alla sessione), #5 (segreto condiviso core-plugin) |
| Migrazioni | Additive: `integration_connections.instance_key` e `expires_at`, nuova chiave unica `(user_id, provider, instance_key)` accanto a quella vecchia; `plugins`; `plugin_user_credentials`; colonne grezze su `transactions`. Dettaglio: [`06-data.md`](06-data.md) §6.1 |
| Rollback | Immagine `pre-n1`; `docker compose stop` del plugin. Le tabelle nuove restano inutilizzate. I conti creati dalla banca restano come conti senza sorgente |
| Test e gate | G1-G9. Kit di test del contratto contro risposte registrate (fixture dalla sandbox e, anonime, dalla banca vera). Integration: consenso, `state` legato alla sessione, scadenza, 429 → attesa di 6 ore, idempotenza su `entry_reference` e sull'hash di riserva. E2E: procedura guidata contro la sandbox |
| Criteri di accettazione | 1) Un consenso reale va a buon fine dal browser senza copiare codici a mano. 2) Lo storico oltre 90 giorni è letto nella prima sync. 3) Due sync di seguito non creano doppioni. 4) Il plugin non ha `DATABASE_URL`, `APP_ENCRYPTION_KEY` né volumi. 5) Le credenziali non compaiono in log, API, MCP, export. 6) Un secondo utente non vede e non usa le credenziali del primo. 7) Senza plugin attivo l'app si comporta come prima. 8) Fotografia dei numeri invariata per i conti esistenti |
| OK di Mattia | Sì, sul SHA. Passi di Mattia: applicazione Production, chiave nuova inserita solo dall'interfaccia, accesso alla banca |
| Dipende da | N0 |
| Dimensione | L |

### N2 · Stato dei collegamenti

| | |
|---|---|
| Obiettivo | Sostituire il sync log con uno stato semplice. Permettere più banche |
| Contenuto | Stato a 5 valori per collegamento (aggiornato, in corso, in ritardo, serve un'azione, in pausa), cronologia semplice (10 righe), codice di errore da una lista chiusa, avviso dopo 3 fallimenti o subito se serve un'azione, avviso di scadenza del consenso a 14 e 3 giorni, «Rinnova accesso». Registro grezzo solo per l'admin in Server › Diagnostica, 30 giorni, «Copia rapporto» senza segreti. Chiusura delle righe `running` orfane. Rimozione della chiave unica vecchia: da qui un utente collega più banche. Pianificazione sotto «Avanzate» |
| Per l'utente | Una riga chiara per collegamento, con una sola azione quando serve |
| Git | Branch + PR · `feat(integrations)` · criterio #1 |
| Migrazioni | Additive: `error_code`, `consecutive_failures` su `integration_connections`; `origin`, `error_code`, `http_status`, `app_version` su `sync_runs`. Contrazione: rimozione di `integration_connections_user_provider_uq` (seconda metà della migrazione in due tempi). Dati: righe `running` vecchie → `failed`; conservazione di `sync_runs` da 90 a 30 giorni |
| Rollback | Immagine `pre-n2`: l'immagine N1 usa già la chiave nuova. Dump `n2.dump` per la modifica ai dati |
| Test e gate | G1-G9. Unit: stato derivato per ogni combinazione di `state`, `last_ok_at`, `next_sync_at`, fallimenti. Integration: chiusura delle righe orfane, conservazione. E2E: pagina dei collegamenti a 400 e 1440 px, nei due temi |
| Criteri di accettazione | 1) Nessuna parola tecnica nella vista normale. 2) Il registro grezzo non è raggiungibile da un utente non admin. 3) Zero righe `running` più vecchie di un'ora dopo il deploy. 4) Nessun messaggio grezzo del provider salvato dai collegamenti nuovi. 5) Una seconda banca si collega |
| OK di Mattia | Sì, sul SHA |
| Dipende da | N1 |
| Dimensione | S |

### N3 · Categorizzazione automatica e movimento manuale

| | |
|---|---|
| Obiettivo | Dare categorie ai movimenti delle sorgenti che non le hanno. Permettere un movimento a mano |
| Contenuto | Cascata nel core: struttura → memoria severa → classificatore lineare per utente → tabelle MCC e marchi → «Da categorizzare». Origine, confidenza e versione del modello sul movimento. Soglia calcolata per la precisione 95%. Segno «automatica» con il motivo. Vista «Da rivedere» a gruppi. Dopo una correzione: «Applico a N movimenti simili?». Proposta di unione delle categorie doppie. Circa 12 gruppi predefiniti. Revisione guidata alla prima sync. Movimento manuale: crea, modifica, cancella; avviso su un conto collegato a una banca |
| Per l'utente | I movimenti della banca arrivano con una categoria o in «Da categorizzare». Le spese in contanti si registrano a mano |
| Git | Branch + PR · `feat(transactions)` · criterio #1 |
| Migrazioni | Additive: `category_origin`, `category_confidence`, `category_model_version` su `transactions`; `category_memory`; `category_models`; origine `manual` del movimento. Riempimento: `category_origin = 'provider'` per i movimenti esistenti con categoria |
| Rollback | Immagine `pre-n3`; dump `n3.dump`. L'immagine precedente ignora le colonne nuove. I movimenti manuali creati restano visibili come movimenti normali |
| Test e gate | G1-G9. File di riferimento «testo → caratteristiche → categoria attesa». Prova in ordine di tempo su fixture anonime: precisione automatica ≥ 95%. Integration: una previsione automatica non entra mai nell'addestramento; isolamento per utente; il modello non esce da export, API, MCP |
| Criteri di accettazione | 1) Sui conti Wallet le categorie restano quelle di Wallet. 2) Una categoria automatica conta in Budgets ed Expenses; un suggerimento non confermato conta come «Da categorizzare». 3) Precisione automatica ≥ 95% sulla prova; la copertura è misurata e riportata, senza soglia. 4) L'addestramento resta nel limite di memoria del container. 5) Un doppio invio dello stesso movimento manuale crea una sola riga. 6) Fotografia dei numeri invariata |
| OK di Mattia | Sì, sul SHA |
| Dipende da | N1 (campi grezzi), N2 |
| Dimensione | L |

### N4 · Passaggio di un conto da Wallet a Enable Banking

| | |
|---|---|
| Obiettivo | Cambiare la sorgente di un conto senza doppi conteggi e senza perdita di storico |
| Contenuto | Scelta «È lo stesso conto di…» nella procedura della banca. Regola M1 corretta: abbinamento per gruppi (conto + importo, confronto dei conteggi), poi testo, poi data. Prova a secco obbligatoria con rapporto. Controllo del saldo bloccante, con il tipo di saldo scelto per banca. Un conto per volta. Il pass Wallet salta i conti passati. La pubblicazione degli interessi su Wallet finisce per i conti passati. Annullamento del passaggio |
| Per l'utente | L'utente sceglie se e quando passare un conto. Vede prima il rapporto |
| Git | Branch + PR · `feat(accounts)` · criterio #1 (modifica ai dati: `provider` del conto e link esterni) |
| Migrazioni | Nessuna di schema. Dati, su richiesta dell'utente: `accounts.provider`, righe di `provider_links` |
| Rollback | Per conto, dall'interfaccia: «Annulla passaggio» riporta `provider` a `wallet` e toglie i link Enable Banking; nessuna riga di movimento cancellata. Rilascio: immagine `pre-n4`; dump `n4.dump` prima del primo passaggio reale |
| Test e gate | G1-G9. Unit: abbinamento per gruppi sui tre scenari dello spike (stessa data; 0-3 giorni con 3% di differenze; 0-5 giorni con 5%). Integration: prova a secco senza scritture; blocco con saldo diverso; annullamento |
| Criteri di accettazione | 1) La prova a secco non scrive nulla. 2) Nessun movimento della banca si lega a una riga esistente quando i conteggi del gruppo sono diversi: va nel rapporto. 3) Una differenza di saldo blocca l'applicazione. 4) Dopo il passaggio: saldo della banca = saldo locale alla stessa data. 5) Dopo «Annulla passaggio» la fotografia dei numeri è uguale a prima |
| OK di Mattia | Sì, sul SHA. Ogni passaggio reale di un conto è una scelta di Mattia nell'interfaccia |
| Dipende da | N3 |
| Dimensione | M |

### N5 · Time Off

| | |
|---|---|
| Obiettivo | Un'interazione senza gesti nascosti, uguale su mouse, touch e tastiera |
| Contenuto | Selezione di primo e ultimo giorno (trascinamento solo con il mouse). Pannello: tipo, durata, nota, giorni esclusi, residuo prima → dopo. Pulsante «Aggiungi assenza» con due campi data. Tocco su un giorno prenotato: modifica o «Rimuovi». Toast con «Annulla». Tastiera: Invio, frecce, Esc, Canc. Via: ciclo al clic, pressione lunga, tasto destro, Alt |
| Per l'utente | Una settimana di ferie è una sola azione con conferma |
| Git | `main` · `feat(timeoff)` |
| Migrazioni | Nessuna. La scrittura di un intervallo usa le righe di oggi, in una sola transazione |
| Rollback | Immagine `pre-n5` |
| Test e gate | G1, G2, G3, G6 (`a11y`, `keyboard`, mobile a 400 px), G7, G8. Unit: giorni esclusi, sostituzioni, residuo. Integration: un intervallo scrive tutte le righe o nessuna |
| Criteri di accettazione | 1) Ogni azione ha un controllo visibile. 2) Cella del giorno ≥ 40 px su mobile. 3) Nessuna scrittura prima di «Conferma». 4) I residui sono uguali a prima a parità di giorni. 5) La sync con Trek funziona come prima |
| OK di Mattia | No (nessun criterio §6 atteso) |
| Dipende da | N0. Indipendente da N1-N4: si può fare mentre N1 aspetta la banca vera |
| Dimensione | M |

---

## Fase B · riscrittura progressiva

Dettaglio del refactor: [`05-refactor.md`](05-refactor.md).

### R0 · Monorepo

| | |
|---|---|
| Obiettivo | Spostare il codice in `apps/` e `packages/` senza cambiare comportamento. Confini e regole di modularità imposti dal gate, non dalla lettura del codice |
| Contenuto | npm workspaces. `packages/domain` (moduli, schema Drizzle, migrazioni), `packages/api-contract` (primitive zod), `packages/plugin-contract` e `packages/plugin-host` (dal codice di N1), `plugins/enablebanking`, `apps/web` (l'app Next.js di oggi, che contiene ancora API e job). Refactor trasversale senza cambio di numeri: rimozione del codice morto, primitive condivise (`money`, `dates`, `period`, zod), `index.ts` pubblico per modulo, regole di modularità M1-M7 e di pulizia Q1-Q10 nel gate con le loro liste note. Eccezione alla convenzione FastAPI dell'homelab scritta in `AGENTS.md` |
| Per l'utente | Nulla |
| Git | `main` · commit `refactor` e `build`, uno per pacchetto spostato |
| Migrazioni | Nessuna |
| Rollback | Immagine `pre-r0` |
| Test e gate | G1-G9. Tutti i test esistenti passano senza modifiche alle asserzioni. Fotografia dei numeri uguale byte per byte |
| Criteri di accettazione | **Priorità 1, modularità.** 1) Ogni pacchetto ha le sole dipendenze di [`10-modularity.md`](10-modularity.md) §10.2: 0 violazioni di M1 e M6 per `domain` e `api-contract`. 2) Ogni modulo ha un `index.ts` con soli export nominati e il suo file di riferimento (M7). 3) 0 import profondi: `apps/web` e ogni modulo importano un altro modulo solo dal suo `index.ts` (M3). 4) 0 cicli tra pacchetti; i cicli tra moduli sono solo quelli della lista nota, non più lunga di quella di N0 (M4). 5) 0 import tra moduli fuori dalla matrice, salvo la lista nota (M2). 6) Un plugin importa solo `plugin-contract` (M9). 7) Righe duplicate non superiori alla misura di N0; le strutture doppie delle primitive (`civilDate`, decimali, date, guardia admin, `buildCtx`) hanno 1 dichiarazione (M11). **Priorità 2, pulizia.** 8) Regole Q1-Q10 nel gate; ogni lista nota è scritta nel repo e non più lunga della misura iniziale. 9) Le voci «residuo» dell'audit senza effetto sullo schema sono chiuse: 0 export senza uso. 10) I file grandi elencati in [`05-refactor.md`](05-refactor.md) §5.3 sono fuori dalla lista di Q6. **Priorità 3, prestazioni.** 11) Nessuna misura di G9 peggiora di oltre il 10%; il numero di query per vista è uguale. **Comportamento invariato.** 12) Test esistenti verdi; `assertions-diff` senza differenze. 13) Fotografia dei numeri uguale byte per byte; risposte di riferimento di API e MCP uguali. 14) L'immagine parte, applica 0 migrazioni, gli e2e completi passano senza modifiche alle attese |
| OK di Mattia | No (nessun criterio §6 atteso; la valutazione sul diff lo conferma) |
| Dipende da | N4, N5 |
| Dimensione | M |

### R1 · Worker

| | |
|---|---|
| Obiettivo | Togliere sync e job dal processo web |
| Contenuto | `apps/worker`: stessa immagine di `api`, comando diverso. Scheduler interno, coda su PostgreSQL (`FOR UPDATE SKIP LOCKED`), una chiave unica per job, un solo worker. Registro dei job composto nel worker, trigger multipli per job. I lavori `after()` diventano job in coda. Recupero delle righe `running` orfane. Heartbeat nel database. Limiti condivisi (API, tentativi di chiave) su tabella. Pool di connessioni proprio. «Sincronizza ora»: l'API mette in coda e risponde subito. Il container `ledgerly-cron` si spegne |
| Per l'utente | Nulla. Un riavvio non lascia più una sync ferma |
| Git | Branch + PR · `feat(worker)` · criterio #1 (tabelle della coda); compose con un servizio nuovo e uno in meno |
| Migrazioni | Additive: `job_queue`, `worker_heartbeats`, `rate_limit_counters` |
| Rollback | Immagini `pre-r1` (`ledgerly` e `ledgerly-cron`) e compose precedente: il cron riparte e il web esegue di nuovo i job. Le tabelle della coda restano inutilizzate |
| Test e gate | G1-G9. Integration: un job interrotto torna in coda e si chiude; due esecuzioni della stessa chiave non partono insieme; gli orari dell'utente (`docs/scheduler.md`) danno gli stessi istanti di prima. Prova di riavvio del worker durante una sync |
| Criteri di accettazione | 1) Nessun job gira nel processo web. 2) Zero chiamate `after()` per lavoro di dominio. 3) L'health del web non dipende dallo scheduler. 4) Dopo un riavvio forzato nessuna riga resta `running`. 5) Tutti i 20 job hanno girato almeno una volta dal worker con lo stesso esito |
| OK di Mattia | Sì, sul SHA |
| Dipende da | R0 |
| Dimensione | M |

### R2 · API completa

| | |
|---|---|
| Obiettivo | Ogni cosa che il web fa passa da una rotta `/api/v1`. Refactor del dominio modulo per modulo, nell'ordine: modularità, pulizia, prestazioni |
| Contenuto | Per ogni modulo, nell'ordine di [`05-refactor.md`](05-refactor.md) §5.2: schema in `api-contract` → controlli automatici del contratto e conferma di perimetro dell'orchestratore → rotte in `apps/api` → strumenti MCP di lettura dallo stesso descrittore → refactor del dominio (porte al posto dei cicli, un read-model, nessun doppione; poi pulizia; poi prestazioni) → test di parità. In più: documento OpenAPI generato e test «solo additivo»; `GET /api/v1/meta`; chiave di idempotenza su ogni scrittura; scope nuovi; due client OAuth di prima parte per le app; CORS solo per le due origini fisse degli involucri, solo con `Bearer`, mai con cookie; elenco dei dispositivi con revoca. Il web usa ancora le Server Actions, che chiamano gli stessi casi d'uso |
| Per l'utente | Nulla. I client esterni trovano rotte nuove |
| Git | `main` per le rotte e il refactor, un modulo per volta. Branch + PR per: `idempotency_keys` (#1); scope, client OAuth e CORS (#4) |
| Migrazioni | Additive: `idempotency_keys`; righe dei due client OAuth |
| Rollback | Immagine `pre-r2-<modulo>` a ogni passo di modulo. Le rotte nuove spariscono; nessun dato cambia |
| Test e gate | G1-G9 a ogni passo. Test di contratto: OpenAPI del rilascio contro OpenAPI precedente. Test di parità per modulo: valore dell'azione = valore della rotta = valore dello strumento MCP. Test di sicurezza esistenti (`security.spec.ts`, `src/platform/auth/*.itest.ts`) invariati. Prove CORS: una chiamata con cookie da un'origine degli involucri è rifiutata; una chiamata `Bearer` da un'origine non ammessa è rifiutata |
| Criteri di accettazione | **Priorità 1, modularità.** 1) Per ogni modulo: condizioni 1.1-1.6 di [`05-refactor.md`](05-refactor.md) §5.1, parte dominio. 2) A fine R2 le liste note di M2, M4 e M5 sono vuote per i moduli di dominio: 0 import fuori matrice, 0 cicli tra moduli (restano solo Trek e Wallet, fino a R5c), 0 accessi alle tabelle di un altro modulo. 3) 0 import `platform → modules` (oggi 80). 4) Ogni Server Action ha una rotta, salvo una lista di esclusioni scritta (cookie del web), e chiama lo stesso caso d'uso della rotta. 5) 0 serializzatori doppi tra REST e MCP; ogni struttura doppia di [`10-modularity.md`](10-modularity.md) §10.7.4 ha 1 dichiarazione. 6) 0 voci dell'audit di tipo duplicato aperte nel dominio, salvo le rinviate a R5. **Priorità 2, pulizia.** 7) Per ogni modulo: condizioni 2.1-2.4. A fine R2 le liste note di Q6, Q7 e Q8 sono vuote per `packages/domain` e `apps/api`. **Priorità 3, prestazioni.** 8) Per ogni modulo: condizioni 3.1 e 3.2. Le voci P3 del dominio sono chiuse (INV-4, POC-3, IMP-5, INT-7, SUB-9, TRX-11). **Comportamento invariato.** 9) Per ogni modulo: condizioni V.1-V.3. 10) I test di sicurezza esistenti passano senza modifiche; la registrazione dinamica dei client resta chiusa a `/api/v1`. 11) `docs/api-changelog.md` elenca ogni aggiunta; il documento OpenAPI cambia solo per aggiunte. 12) Le sole differenze di numeri sono D1-D11, ognuna con il suo commit e il suo test |
| OK di Mattia | Sì per le due PR (#1, #4). Le voci «stesso numero in due modi» sono già decise (D1-D11, [`09-risks.md`](09-risks.md) §9.5). Sì per ogni eccezione alle priorità ([`10-modularity.md`](10-modularity.md) §10.9.3) |
| Dipende da | R1. Da qui lavorano due filoni |
| Dimensione | L |

### R3 · Web sull'API

| | |
|---|---|
| Obiettivo | Il web usa solo l'API. Le schermate sono React solo client in pacchetti condivisi. Refactor dell'interfaccia, nell'ordine: modularità, pulizia, prestazioni |
| Contenuto | Vincolo fissato all'inizio: niente Server Components e niente Server Actions nelle schermate; niente `next/headers`, `next/navigation`, `next/link` dentro `packages/ui` (adattatore di routing iniettato). Per ogni modulo: hook dati su `api-client` → componenti puri in `packages/ui` → cancellazione delle Server Actions e dei doppioni dell'audit. `design-tokens` come sorgente unica. Cache client con invalidazione per chiave al posto di `revalidatePath` e `router.refresh()`. Stati di caricamento, errore e vuoto per ogni blocco. Tre classi di larghezza |
| Per l'utente | Nulla di visibile, salvo le tabelle che su schermo piccolo diventano liste a schede in modo uniforme |
| Git | `main`, un modulo per volta (filone client) |
| Migrazioni | Nessuna |
| Rollback | Immagine `pre-r3-<modulo>` a ogni passo di modulo |
| Test e gate | G1-G9 a ogni passo. Parità per modulo prima della cancellazione: valore della pagina vecchia = valore della pagina nuova. E2E completi del modulo, `a11y` nei due temi a 400 e 1440 px. Pagina di riferimento dei componenti. Build statica del pacchetto delle schermate dentro l'involucro Android di prova (da C0) |
| Criteri di accettazione | **Priorità 1, modularità.** 1) `packages/ui` importa solo `react`, `design-tokens`, `api-client` e i tipi di `api-contract`: 0 import di `next/*` e di `domain` (M1, M6; oggi 19 import di Next e 5 di `@/platform` in `src/ui`). 2) 0 file `"use server"` di dominio (oggi 21) e 0 Server Component che leggono dati nelle schermate (oggi 61 file) (M10). 3) Nessun client calcola totali, P&L, rendimenti o conversioni: ogni numero mostrato è un campo dell'API. 4) 0 voci dell'audit dell'interfaccia di tipo duplicato aperte per il modulo; a fine R3: 0 tabelle scritte due volte (oggi 28), ogni componente condiviso di `audit-ui.md` §16 ha 1 dichiarazione. 5) 0 componenti condivisi dentro la cartella di una route. **Priorità 2, pulizia.** 6) Liste note di Q6-Q8 vuote per `packages/ui` e `apps/web` (oggi 19 file componente oltre 400 righe). 7) 0 valori Tailwind arbitrari fuori da `design-tokens` (oggi 364), salvo una lista di eccezioni scritta. 8) 0 chiavi di traduzione senza uso; una chiave mancante blocca la build. **Priorità 3, prestazioni.** 9) Le voci P3 dell'interfaccia sono chiuse (UI-ACC-7, UI-TOF-2, UI-PAY-1). 10) Il peso del JavaScript iniziale di ogni schermata è misurato e non cresce da un passo al successivo; i tempi delle rotte restano entro il 10%. **Comportamento invariato.** 11) Parità per modulo: valore della pagina vecchia = valore della pagina nuova, prima della cancellazione. 12) E2E completi del modulo senza modifiche alle attese, `a11y` nei due temi a 400 e 1440 px. 13) Le schermate del modulo girano nel pacchetto statico. 14) 0 migrazioni |
| OK di Mattia | No (nessun criterio §6 atteso) |
| Dipende da | R2 dello stesso modulo |
| Dimensione | L |

### R4 · Container separati

| | |
|---|---|
| Obiettivo | `api` e `web` in due container |
| Contenuto | Immagine `ledgerly` per `api` e `worker`, immagine `ledgerly-web` per l'interfaccia. Traefik instrada `/api` e `/.well-known` verso `api`, il resto verso `web`. Il web resta sullo stesso host dell'API: cookie di sessione, nessuna regola CORS per il web. L'indirizzo dell'API per le app non cambia |
| Per l'utente | Nulla |
| Git | Branch + PR · `build` · criterio #3 (regole Traefik) |
| Migrazioni | Nessuna |
| Rollback | Compose e immagini `pre-r4`: un solo container come prima |
| Test e gate | G1-G9. E2E completi. I due router Traefik esistenti restano, con le stesse protezioni. Le prove CORS di R2 passano anche dopo la separazione |
| Criteri di accettazione | 1) `web` non ha `DATABASE_URL` né `APP_ENCRYPTION_KEY`. 2) Login, 2FA, OIDC e consenso OAuth funzionano. 3) MCP, client esterni e app funzionano senza modifiche |
| OK di Mattia | Sì, sul SHA |
| Dipende da | R3 di tutti i moduli |
| Dimensione | S |

### R5 · Prodotto nuovo

Sei rilasci. Ognuno ha le regole comuni di §3.1.

| | R5a · Navigazione | R5b · Investments e Overview | R5c · Wallet e Trek plugin |
|---|---|---|---|
| Obiettivo | Menu, moduli, primo avvio, Settings | Una home Investments a 3 gruppi; Overview a gruppi | Nessuna sorgente compilata nel core, salvo eToro e Binance |
| Contenuto | Menu a 3 gruppi. Moduli attivabili per utente. Primo avvio in 3 passi. Tab mobile Overview · Accounts · Expenses · Investments · More. Settings: tab Finance (Banche, Investimenti, Categorie ed etichette) e tab Plugin; via Integrations e Categories. Glossario unico | Read-model unico sopra investments e funds (nessuna migrazione dei dati dei fondi). Home con totale, 4 KPI comuni, filtro a chip, gruppi con subtotale, «Altri conti». Pensione nel totale. `/funds/*` → redirect a `/investments`. Via catalogo e «coming soon»: dialog a 3 scelte. Overview: lista a gruppi, subtotale = riquadro, riga di investimento → Investments | Plugin Wallet (sola lettura) e plugin Trek (`provider.write` approvato dall'utente). Porte del dominio al posto degli import. Stato esterno generico in timeoff. Catalogo ufficiale con immagine e digest. Tab Plugin completo: installa, attiva, aggiorna, rimuovi; etichetta «non verificato» fuori catalogo. Uscita dei plugin solo verso gli host del manifest (decisione I8) |
| Per l'utente | Navigazione più corta; solo i moduli scelti | Una risposta a «quanto ho guadagnato»; la voce Funds sparisce | Wallet e Trek si installano; chi non li usa non li vede |
| Git | Branch + PR · #1 | `main`; PR solo se cambia la forma di una risposta API (campo `kind`, `include=funds`: additivi) | Branch + PR · #1, #3, #5 |
| Migrazioni | Additive: `user_preferences.modules`, stato del primo avvio | Nessuna | Additive: colonne di stato esterno generiche in timeoff; righe del registro dei plugin. Dati: connessioni Wallet e Trek → connessioni dei plugin |
| Rollback | Immagini `pre-r5a` | Immagini `pre-r5b` | Immagini `pre-r5c` (core con Wallet e Trek compilati) + dump `r5c.dump`. Le colonne `trek_*` restano fino a R5f |
| Test | G1-G9; e2e di navigazione, primo avvio con utente nuovo, a11y | G1-G9; parità: totale Investments = riquadro Investments di Overview = somma delle righe; ogni fondo ha gli stessi numeri di prima nel dettaglio; API e MCP senza `include=funds` rispondono come prima | G1-G9; kit di test del contratto per i due plugin sulle fixture esistenti; parità dei movimenti e delle ferie dopo una sync dal plugin |
| Criteri di accettazione | Nessuna pagina persa; un modulo spento non compare; Settings ha i tab decisi | Un solo totale; i calcoli approvati dei fondi e dei servizi non cambiano; nessun URL vecchio dà 404 | Zero import di Wallet o Trek nel core; fotografia dei numeri uguale; il plugin Wallet non scrive sul provider |
| OK di Mattia | Sì | Solo se la valutazione sul diff trova un criterio | Sì |
| Dimensione | M | L | L |

| | R5d · Portafoglio manuale | R5e · Avvisi | R5f · Pulizia dello schema |
|---|---|---|---|
| Obiettivo | Seguire titoli a mano con prezzi automatici | Avvisi solo quando serve un'azione, uguali su ogni client | Togliere ciò che non serve più |
| Contenuto | Servizio «Portafoglio manuale» (conto titoli di Accounts, unico scrittore `portfolio`). «Registra operazione»: tipo, ricerca per ISIN, nome o ticker, data, quantità, prezzo, commissioni, cambio. Anagrafica: OpenFIGI + ESMA FIRDS. Prezzi: EODHD, BCE, CoinGecko. Mercato dell'ordine, Xetra di riserva. Stato «prezzo automatico» o «prezzo manuale» per strumento. Job giornaliero dei prezzi con tetto di chiamate. Fonti extra solo come plugin `prices` | Un servizio di notifica con canali (in app, email, notifica del dispositivo). Rotta di lettura per il controllo periodico delle app. Testi senza importi, banca o conto. Blocco «Da fare» in Overview. Preferenze per evento. «Nascondi importi» su tutti i client | Rimozione di colonne, tabelle e valori senza uso, elencati in [`06-data.md`](06-data.md) §6.1 |
| Per l'utente | Posizioni, P&L e prezzi per i titoli inseriti a mano | Pochi avvisi, tutti utili | Nulla |
| Git | Branch + PR · #1, #5 (chiave EODHD) | Branch + PR · #1 | Branch + PR · #1 |
| Migrazioni | Additive: `instruments`, `instrument_listings`, `instrument_prices`, `investment_assets.instrument_id` | Additive: preferenze dei canali, coda delle notifiche da leggere | Rimozioni. Solo dopo un rilascio stabile di chi le ha rese inutili |
| Rollback | Immagini `pre-r5d`; le tabelle nuove restano vuote | Immagini `pre-r5e` | Immagini `pre-r5f` + dump `r5f.dump` (obbligatorio: è l'unico rilascio non compatibile all'indietro senza dump) |
| Test | G1-G9; P&L con le stesse regole di `investments-ux.md` §4; vendita oltre la quantità bloccata; prezzo più vecchio di 5 giorni lavorativi → «da aggiornare» | G1-G9; un evento non si ripete prima della sua pausa; nessun importo nei testi | G1-G9; restore di prova del dump in un database temporaneo |
| Criteri di accettazione | Gli 8 strumenti dello spike hanno anagrafica e prezzo; scostamento sul totale entro lo 0,05% rispetto alla banca con il mercato dell'ordine; un conto letto da una banca non può essere un portafoglio manuale | Ogni evento che chiede un'azione è anche in «Da fare»; mai due avvisi per lo stesso fatto | Nessuna query usa gli oggetti rimossi; fotografia dei numeri uguale |
| OK di Mattia | Sì | Sì | Sì |
| Dimensione | L | M | S |

---

## Fase C · app

Dettaglio: [`07-apps.md`](07-apps.md).

| | C0 · Prove tecniche | C1 · Android: involucro | C2 · Android: funzioni native | C3 · Android: widget | C4 · Windows |
|---|---|---|---|---|---|
| Obiettivo | Sapere se gli involucri reggono, prima di R3 | App installata a mano che mostra i moduli già passati a R3 | App «compagno» completa | Seconda versione | Guscio con la stessa interfaccia |
| Contenuto | Gate del Security Gatekeeper su Android SDK, Capacitor, Tauri. Capacitor: una schermata come pacchetto statico, login OAuth2 + PKCE con schema privato, deposito sicuro. Lavoro in background su due telefoni. Tauri: finestra, login su `127.0.0.1`, build locale; alternativa Electron | `apps/android`. Primo avvio: indirizzo dell'istanza a mano o con QR, login nel browser di sistema, controllo di `/api/v1/meta`. Token nel deposito sicuro. Cache cifrata di sola lettura (90 giorni di movimenti). Stati della rete. «Apri nel browser» per ciò che resta sul web | Sblocco con biometria (avvio e dopo 5 minuti). Controllo periodico degli avvisi, senza terzi. Condivisione di PDF verso l'app. Pulsante «+»: movimento, assenza, aggiorna valore, rinnova accesso | Widget «Da fare» e «Questo mese», importi nascosti di default | `apps/windows` (Tauri 2). Login su `127.0.0.1`. Cache con data. Avvisi di sistema ad app aperta. Trascinamento e «Apri con». Scorciatoia globale e area di notifica facoltative |
| Per l'utente | Nulla | APK installato a mano | Uso quotidiano dal telefono | Widget | App da build locale |
| Git | Fuori da `main` (cartella di lavoro del run) | `main` (filone client) | `main` | `main` | `main` |
| Migrazioni | No | No | No | No | No |
| Rollback | — | Disinstallare l'APK; «Disconnetti» il dispositivo dal web | APK precedente | APK precedente | Build precedente |
| Test | Rapporto delle prove con esito per punto | Test di contratto del client contro il livello API minimo; prova manuale su telefono; 10 numeri chiave uguali all'API | Prova di ritardo degli avvisi; nessun importo nei testi; un doppio «Salva» crea un solo elemento | Il widget non calcola: mostra valori dell'API | Stessi controlli di C1 |
| Criteri di accettazione | Decisione scritta: Capacitor sì o no; Tauri o Electron; intervallo reale del lavoro in background | Login senza password nell'app; logout e «Cambia server» cancellano la cache; senza rete l'app mostra i dati con la data | Le 7 notifiche predefinite arrivano; le azioni rapide hanno al massimo 3 campi obbligatori | Dopo il logout il widget mostra «Accedi a Ledgerly» | Nessuna schermata esiste solo su Windows, salvo primo avvio e preferenze |
| OK di Mattia | Gate del Gatekeeper prima di installare gli strumenti | No | No | No | Gate del Gatekeeper se entra uno strumento nuovo |
| Dipende da | R1 (il secondo agente esiste da R2) | R3 del primo modulo; R2 (`meta`, client OAuth) | R4. Il controllo periodico degli avvisi si attiva con R5e | C2 | C2 |
| Dimensione | S | M | M | S | M |

Nessun passo di distribuzione: nessun canale pubblico e nessun account sviluppatore. La distribuzione è una fase futura, fuori dal piano.

## Z · Review finale unica

Una sola, quando Mattia dichiara tutto completo. È l'unica review del piano: prima di Z nessun agente legge il codice
di un altro (decisione H6). Due parti nello stesso passo (decisione I17):

- **Codice:** il risultato contro le tre priorità di [`10-modularity.md`](10-modularity.md) e contro questo piano.
- **Sicurezza:** login nativo e client OAuth di prima parte, CORS, rete e contratto dei plugin, credenziali per utente,
  cache sui dispositivi, avvisi.

I finding diventano correzioni con il loro rilascio.
