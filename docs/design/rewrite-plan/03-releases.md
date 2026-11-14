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
| Contenuto | Passo 1: prova su una banca vera (S4). Poi: contratto v1 (`manifest`, `verify`, `auth/start`, `auth/complete`, `sync`), con lo schema del manifest già completo di etichette, campi delle credenziali, intervallo minimo e capacità (anticipo AN2, [`11-standardization.md`](11-standardization.md) §11.6), lato core che chiama il plugin, rete `ledgerly_plugins`, container `ledgerly-plugin-enablebanking`, credenziali Enable Banking per utente cifrate nel core, flusso di consenso con ritorno su `/api/v1/plugins/enablebanking/callback`, prima sync subito dopo il consenso, letture automatiche (3 al giorno), «Sincronizza ora» con header `Psu-*`, tab Plugin essenziale (admin), procedura guidata «Collega una banca». Campi grezzi della banca salvati sul movimento |
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
| Contenuto | Stato a 5 valori per collegamento (aggiornato, in corso, in ritardo, serve un'azione, in pausa), cronologia semplice (10 righe), codice di errore da una lista chiusa, avviso dopo 3 fallimenti o subito se serve un'azione, avviso di scadenza del consenso a 14 e 3 giorni, «Rinnova accesso». Chiavi di notifica generiche (`sync_failed`, `sync_stale`) con il fornitore come parametro, al posto delle chiavi con il nome di un fornitore: stessi avvisi, stesso testo (anticipo AN3). Registro grezzo solo per l'admin in Server › Diagnostica, 30 giorni, «Copia rapporto» senza segreti. Chiusura delle righe `running` orfane. Rimozione della chiave unica vecchia: da qui un utente collega più banche. Pianificazione sotto «Avanzate» |
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
| Contenuto | Selezione di primo e ultimo giorno (trascinamento solo con il mouse). Pannello: tipo, durata, nota, giorni esclusi, residuo prima → dopo. Pulsante «Aggiungi assenza» con due campi data. Tocco su un giorno prenotato: modifica o «Rimuovi». Toast con «Annulla». Tastiera: Invio, frecce, Esc, Canc. Via: ciclo al clic, pressione lunga, tasto destro, Alt. Il pannello legge i tipi di assenza da un elenco, non da nomi fissi: l'elenco contiene i tipi di oggi, nessun cambio di schema (anticipo AN1). Test: un giorno ROL avvia la sync verso Trek come un giorno di ferie; se il test fallisce, correzione come `fix` nello stesso rilascio (ipotesi ST-23) |
| Per l'utente | Una settimana di ferie è una sola azione con conferma |
| Git | `main` · `feat(timeoff)` |
| Migrazioni | Nessuna. La scrittura di un intervallo usa le righe di oggi, in una sola transazione |
| Rollback | Immagine `pre-n5` |
| Test e gate | G1, G2, G3, G6 (`a11y`, `keyboard`, mobile a 400 px), G7, G8. Unit: giorni esclusi, sostituzioni, residuo. Integration: un intervallo scrive tutte le righe o nessuna |
| Criteri di accettazione | 1) Ogni azione ha un controllo visibile. 2) Cella del giorno ≥ 40 px su mobile. 3) Nessuna scrittura prima di «Conferma». 4) I residui sono uguali a prima a parità di giorni. 5) La sync con Trek funziona come prima; un giorno ROL arriva a Trek senza aspettare la sync successiva. 6) Nessun nome di tipo di assenza scritto nel pannello: i tipi arrivano dall'elenco |
| OK di Mattia | No (nessun criterio §6 atteso) |
| Dipende da | N0. Indipendente da N1-N4: si può fare mentre N1 aspetta la banca vera |
| Dimensione | M |

### N6 · Fondo pensione standard

Revisione sulla standardizzazione, in attesa dell'OK di Mattia. Dettaglio: [`11-standardization.md`](11-standardization.md) §11.2.

| | |
|---|---|
| Obiettivo | Un solo fondo pensione: un modello, un motore, una serie di schermate. Togliere dal modulo `funds` il tipo PAC e la logica scritta per un gestore, **prima** della riscrittura: R0, R2 e R3 non spostano e non rifanno il codice che sparisce |
| Contenuto | Tabelle `fund_contribution_sources` (sorgenti `payroll`, `bank_debit`, `manual`) e `fund_fees` (commissioni generiche). Registro unico `fund_operations` con `source_id`. Un servizio `createFund` con le sorgenti; una funzione `fundFlows` al posto di `pacFlows` e `pensionFlows`. Il job `funds-deposits` scrive operazioni `voluntary`. Procedura «Aggiungi fondo pensione» in 4 passi, senza il tipo. Home e dettaglio unici: tab Panoramica · Contributi · Valori · Documenti · Impostazioni; sezioni guidate dalla configurazione. Commissioni come lista modificabile. Scadenze nella sorgente; nessun ripiego sul calendario di un gestore. Limite di deducibilità come campo del fondo, con il default del paese. Tipo di documento `fund_statement`; il lettore di oggi dietro l'interfaccia dei lettori; pulsante «Importa documento del fondo» solo se il fondo ha un lettore. Modelli di fondo come file di dati. Migrazione dei 2 fondi in produzione (strada A). Via: `pac-*.tsx`, i form del PAC, il motore vecchio, i percorsi di scrittura di `fund_deposits`, la tariffa scritta a ogni lettura, i testi con «PAC». Regola M12 («nomi vietati») nel gate, con la sua lista nota |
| Per l'utente | «Aggiungi fondo» non chiede il tipo. Un fondo nuovo nasce senza scadenze e senza commissioni di un altro gestore. Fideuram mostra «Contributi» con le stesse righe. Le commissioni si vedono e si modificano in una lista. La voce di menu «Funds» e i gruppi di Investments non cambiano: arrivano in R5b |
| Git | Branch + PR · `feat(funds)` · criterio #1 (schema e modifica ai dati) |
| Migrazioni | A1, additiva: `fund_contribution_sources`, `fund_fees`; `fund_operations.source_id` e `fees_unknown`; `funds.statement_reader`; check `fund_operations_source_ck` allargato con `rule`; check `documents_kind_ck` allargato con `fund_statement`. A2, dati: sorgenti e commissioni dei 2 fondi; copia dei 10 versamenti di Fideuram in `fund_operations` con `origin_key = 'deposit:' + id`; `accounts.type` del conto di Fideuram da `investment` a `pension`. Le tabelle e le colonne vecchie restano ferme fino a R5f. Dettaglio: [`06-data.md`](06-data.md) §6.1 |
| Rollback | Immagine `pre-n6`: le tabelle vecchie sono intatte e l'immagine precedente le legge come prima. File SQL di rollback nel repo: cancella le operazioni con `origin_key like 'deposit:%'`, riporta `accounts.type`, elimina tabelle e colonne nuove. I versamenti da regola fatti dopo il rilascio ritornano da soli (il job dell'immagine precedente li ricrea dai movimenti). Dump `n6.dump` per i versamenti manuali fatti dopo il rilascio |
| Test e gate | G1-G9. Prove «stessi numeri» SN1-SN6 ([`11-standardization.md`](11-standardization.md) §11.2.4): fotografia prima e dopo in produzione; parità della copia dentro la migrazione (la migrazione fallisce se conteggio o somme sono diversi); `fundFlows` = `pacFlows` campo per campo; commissioni di Cometa sui 14 periodi maturati; file di riferimento dei calcoli approvati; patrimonio. Prova di rollback sul database di test con l'immagine `pre-n6`. Integration: un fondo nuovo senza modello non ha righe di scadenza e di commissione; una voce di busta paga va a un solo fondo; due esecuzioni del job non creano due operazioni. E2E: procedura a 4 passi, dettaglio dei 2 fondi a 400 e 1440 px, nei due temi |
| Criteri di accettazione | 1) Nessun ramo sul tipo del fondo in pagine, query e servizi: 0 usi di `funds.type` fuori dalla migrazione. 2) Un fondo pensione nuovo si crea dall'interfaccia, con sorgenti e commissioni, senza codice e senza una pagina nuova. 3) Fondo senza Payroll e senza lettore: contributi e valori a mano, file allegati. 4) Cometa: fotografia dei numeri uguale byte per byte. 5) Fideuram: valore, versato, commissioni, guadagno e rendimento uguali; cambiano solo X1 («Deducibile») e X2 (gruppo del conto). 6) Patrimonio totale uguale su Overview, somma dei conti, `GET /summary`, `get_summary`. 7) Nessuna tariffa, scadenza o fonte di un gestore nel codice del modulo: stanno nei dati del fondo o in un modello. 8) Nessuna scrittura nel database a ogni lettura di un fondo. 9) La parola «PAC» non compare nei testi di Funds. 10) Il rollback di prova riporta la fotografia dei numeri di prima. 11) La lista nota di M12 è nel repo e non contiene voci nuove |
| Eccezioni dichiarate a «comportamento invariato» | X1: i contributi a Fideuram contano nel «Deducibile». X2: il conto di Fideuram passa al gruppo pensione; il subtotale cambia, il patrimonio no. X3: nell'export `kind` vale `pension` per ogni fondo. Ognuna con un commit separato e un test |
| OK di Mattia | Sì, sul SHA. Prima dell'inizio: conferma delle ipotesi ST-1, ST-4, ST-10, ST-16, ST-17, ST-18 ([`09-risks.md`](09-risks.md) §9.6) |
| Dipende da | N0 (fotografia dei numeri). Ultimo della fase A: parte dopo N5. Indipendente da N1-N4 |
| Dimensione | L |

---

## Fase B · riscrittura progressiva

Dettaglio del refactor: [`05-refactor.md`](05-refactor.md).

### R0 · Monorepo

| | |
|---|---|
| Obiettivo | Spostare il codice in `apps/` e `packages/` senza cambiare comportamento. Confini e regole di modularità imposti dal gate, non dalla lettura del codice |
| Contenuto | npm workspaces. `packages/domain` (moduli, schema Drizzle, migrazioni), `packages/api-contract` (primitive zod), `packages/plugin-contract` e `packages/plugin-host` (dal codice di N1), `plugins/enablebanking`, `apps/web` (l'app Next.js di oggi, che contiene ancora API e job). Refactor trasversale senza cambio di numeri: rimozione del codice morto, primitive condivise (`money` con valuta obbligatoria, `dates`, `period`, zod), struttura dei punti di estensione senza cambio di comportamento (`shared/fees` con il tipo `FeeRule`, `shared/country` con i valori di oggi come dati `IT`, una sola mappa lingua → locale), `index.ts` pubblico per modulo, regole di modularità M1-M7 e di pulizia Q1-Q10 nel gate con le loro liste note. Eccezione alla convenzione FastAPI dell'homelab scritta in `AGENTS.md` |
| Per l'utente | Nulla |
| Git | `main` · commit `refactor` e `build`, uno per pacchetto spostato |
| Migrazioni | Nessuna |
| Rollback | Immagine `pre-r0` |
| Test e gate | G1-G9. Tutti i test esistenti passano senza modifiche alle asserzioni. Fotografia dei numeri uguale byte per byte |
| Criteri di accettazione | **Priorità 1, modularità.** 1) Ogni pacchetto ha le sole dipendenze di [`10-modularity.md`](10-modularity.md) §10.2: 0 violazioni di M1 e M6 per `domain` e `api-contract`. 2) Ogni modulo ha un `index.ts` con soli export nominati e il suo file di riferimento (M7). 3) 0 import profondi: `apps/web` e ogni modulo importano un altro modulo solo dal suo `index.ts` (M3). 4) 0 cicli tra pacchetti; i cicli tra moduli sono solo quelli della lista nota, non più lunga di quella di N0 (M4). 5) 0 import tra moduli fuori dalla matrice, salvo la lista nota (M2). 6) Un plugin importa solo `plugin-contract` (M9). 7) Righe duplicate non superiori alla misura di N0; le strutture doppie delle primitive (`civilDate`, decimali, date, guardia admin, `buildCtx`) hanno 1 dichiarazione (M11). **Priorità 2, pulizia.** 8) Regole Q1-Q10 nel gate; ogni lista nota è scritta nel repo e non più lunga della misura iniziale. 9) Le voci «residuo» dell'audit senza effetto sullo schema sono chiuse: 0 export senza uso. 10) I file grandi elencati in [`05-refactor.md`](05-refactor.md) §5.3 sono fuori dalla lista di Q6. **Priorità 3, prestazioni.** 11) Nessuna misura di G9 peggiora di oltre il 10%; il numero di query per vista è uguale. **Comportamento invariato.** 12) Test esistenti verdi; `assertions-diff` senza differenze. 13) Fotografia dei numeri uguale byte per byte; risposte di riferimento di API e MCP uguali. 14) L'immagine parte, applica 0 migrazioni, gli e2e completi passano senza modifiche alle attese |
| OK di Mattia | No (nessun criterio §6 atteso; la valutazione sul diff lo conferma) |
| Dipende da | N4, N5, N6 |
| Dimensione | M |

### R1 · Worker

| | |
|---|---|
| Obiettivo | Togliere sync e job dal processo web |
| Contenuto | `apps/worker`: stessa immagine di `api`, comando diverso. Scheduler interno, coda su PostgreSQL (`FOR UPDATE SKIP LOCKED`), una chiave unica per job, un solo worker. Registro dei job composto nel worker, trigger multipli per job. Un solo job `documents-sweep` al posto di `cometa-sweep` e `payslips-sweep`. Un solo registro dei fornitori, dal descrittore (E5). I lavori `after()` diventano job in coda. Recupero delle righe `running` orfane. Heartbeat nel database. Limiti condivisi (API, tentativi di chiave) su tabella. Pool di connessioni proprio. «Sincronizza ora»: l'API mette in coda e risponde subito. Il container `ledgerly-cron` si spegne |
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
| Contenuto | Per ogni modulo, nell'ordine di [`05-refactor.md`](05-refactor.md) §5.2: schema in `api-contract` → controlli automatici del contratto e conferma di perimetro dell'orchestratore → rotte in `apps/api` → strumenti MCP di lettura dallo stesso descrittore → refactor del dominio (porte al posto dei cicli, un read-model, nessun doppione; poi pulizia; poi prestazioni) → test di parità. In più: documento OpenAPI generato e test «solo additivo»; `GET /api/v1/meta`; chiave di idempotenza su ogni scrittura; scope nuovi; due client OAuth di prima parte per le app; CORS solo per le due origini fisse degli involucri, solo con `Bearer`, mai con cookie; elenco dei dispositivi con revoca. Punti di estensione ([`10-modularity.md`](10-modularity.md) §10.11): registro dei lettori di documenti in `documents` (E1); evento `PayslipApplied` con righe per ruolo, la sorgente `payroll` del fondo decide componente e periodo (E2); descrittori di eToro e Binance (E5); abbinatore di movimenti come servizio pubblico di `transactions` (E7); nome dell'accesso OIDC e servizio AI come impostazioni (E8). Rotte dei fondi: `GET /funds`, `GET /funds/:id` con sorgenti, commissioni e operazioni. Il web usa ancora le Server Actions, che chiamano gli stessi casi d'uso |
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

Sette rilasci: R5a-R5e, R5g, R5f. R5g («Lavoro standard») si aggiunge con la revisione sulla standardizzazione; R5f
resta l'ultimo. Ognuno ha le regole comuni di §3.1.

| | R5a · Navigazione | R5b · Investments e Overview | R5c · Wallet e Trek plugin |
|---|---|---|---|
| Obiettivo | Menu, moduli, primo avvio, Settings | Una home Investments a 2 gruppi; Overview a gruppi | Nessuna sorgente compilata nel core, salvo eToro e Binance |
| Contenuto | Menu a 3 gruppi. Moduli attivabili per utente. Primo avvio in 3 passi. Tab mobile Overview · Accounts · Expenses · Investments · More. Settings: tab Finance (Banche, Investimenti, Categorie ed etichette) e tab Plugin; via Integrations e Categories. Glossario unico (una parola per «movimento», «collegamento» e «sorgente»). Primo avvio: «Paese e formato» (paese, valuta, fuso, formato dei numeri) proposti dal browser; il paese sceglie i default dal pacchetto paese (E4, E8). «Connections» del conto passa in Subscriptions (ipotesi ST-13). Frequenza «ogni N settimane o mesi» e voto «utilità» facoltativo in Subscriptions; giorno di accredito a scelta in Pockets | Read-model unico sopra investments e funds (i dati dei fondi sono già nel modello unico da N6). Home con totale, 4 KPI comuni, filtro a chip (Tutti · Azioni e crypto · Fondi pensione), 2 gruppi con subtotale; i conti con solo valore sono righe del primo gruppo. Fondi pensione nel totale. `kind` della riga: `service`, `manual_portfolio`, `pension_fund`. Strumento MCP `list_funds` in sola lettura. Conto manuale con valuta a scelta e 4 campi alla creazione. `/funds/*` → redirect a `/investments`. Via catalogo e «coming soon»: dialog a 3 scelte. Overview: lista a gruppi, subtotale = riquadro, riga di investimento → Investments | Plugin Wallet (sola lettura) e plugin Trek (`provider.write` approvato dall'utente). Porte del dominio al posto degli import. Stato esterno generico in timeoff. Catalogo ufficiale con immagine e digest. Tab Plugin completo: installa, attiva, aggiorna, rimuovi; etichetta «non verificato» fuori catalogo. Uscita dei plugin solo verso gli host del manifest (decisione I8). Capacità `documents.read` nel contratto dei plugin, per i lettori che chiedono codice (E1). Import CSV dei movimenti nel core, con mappa delle colonne salvata per conto (ipotesi ST-8). La pubblicazione degli interessi su Wallet finisce per tutti i conti (ipotesi ST-14) |
| Per l'utente | Navigazione più corta; solo i moduli scelti | Una risposta a «quanto ho guadagnato»; la voce Funds sparisce | Wallet e Trek si installano; chi non li usa non li vede |
| Git | Branch + PR · #1 | `main`; PR solo se cambia la forma di una risposta API (campo `kind`, `include=funds`: additivi) | Branch + PR · #1, #3, #5 |
| Migrazioni | Additive: `user_preferences.modules`, stato del primo avvio, impostazioni di istanza (paese, valuta, fuso, formato). Dati: righe di «Connections» → Subscriptions | Nessuna | Additive: colonne di stato esterno generiche in timeoff; righe del registro dei plugin. Dati: connessioni Wallet e Trek → connessioni dei plugin |
| Rollback | Immagini `pre-r5a` | Immagini `pre-r5b` | Immagini `pre-r5c` (core con Wallet e Trek compilati) + dump `r5c.dump`. Le colonne `trek_*` restano fino a R5f |
| Test | G1-G9; e2e di navigazione, primo avvio con utente nuovo, a11y | G1-G9; parità: totale Investments = riquadro Investments di Overview = somma delle righe; ogni fondo ha gli stessi numeri di prima nel dettaglio; API e MCP senza `include=funds` rispondono come prima | G1-G9; kit di test del contratto per i due plugin sulle fixture esistenti; parità dei movimenti e delle ferie dopo una sync dal plugin |
| Criteri di accettazione | Nessuna pagina persa; un modulo spento non compare; Settings ha i tab decisi; un utente nuovo di un altro paese non riceve default italiani | Un solo totale; 2 subtotali uguali ai riquadri di Overview; nessun valore `pac` in API, MCP ed export; i calcoli approvati dei fondi e dei servizi non cambiano; nessun URL vecchio dà 404 | Zero import di Wallet o Trek nel core; fotografia dei numeri uguale; il plugin Wallet non scrive sul provider |
| OK di Mattia | Sì | Solo se la valutazione sul diff trova un criterio | Sì |
| Dimensione | M | L | L |

Nota su R5a: con le voci della revisione la dimensione può passare da M a L. Si valuta alla conferma di R5a (rischio R-15).

| | R5d · Portafoglio manuale | R5e · Avvisi | R5f · Pulizia dello schema |
|---|---|---|---|
| Obiettivo | Seguire titoli a mano con prezzi automatici | Avvisi solo quando serve un'azione, uguali su ogni client | Togliere ciò che non serve più |
| Contenuto | Servizio «Portafoglio manuale» (conto titoli di Accounts, unico scrittore `portfolio`). «Registra operazione»: tipo, ricerca per ISIN, nome o ticker, data, quantità, prezzo, commissioni, cambio. Anagrafica: OpenFIGI + ESMA FIRDS. Prezzi: EODHD, BCE, CoinGecko. Mercato dell'ordine, Xetra di riserva. Stato «prezzo automatico» o «prezzo manuale» per strumento. Job giornaliero dei prezzi con tetto di chiamate. Fonti extra solo come plugin `prices`. **Secondo passo: «Piano di acquisto» (PAC)**, dopo che il primo passo è stabile: piano per strumento (importo o quantità, frequenza, giorno, inizio, fine, conto di addebito, commissione), job giornaliero `investment-plans-due`, rata proposta da confermare (default) o registrata in automatico (interruttore del piano), collegamento facoltativo al movimento di addebito con l'abbinatore E7. Dettaglio: [`11-standardization.md`](11-standardization.md) §11.3 | Un servizio di notifica con canali (in app, email, notifica del dispositivo). Rotta di lettura per il controllo periodico delle app. Testi senza importi, banca o conto. Blocco «Da fare» in Overview. Preferenze per evento. «Nascondi importi» su tutti i client | Rimozione di colonne, tabelle e valori senza uso, elencati in [`06-data.md`](06-data.md) §6.1. Comprende le rimozioni di N6 (passo A3) e di R5g |
| Per l'utente | Posizioni, P&L e prezzi per i titoli inseriti a mano. Secondo passo: acquisti periodici con una conferma per rata | Pochi avvisi, tutti utili | Nulla |
| Git | Branch + PR · #1, #5 (chiave EODHD) | Branch + PR · #1 | Branch + PR · #1 |
| Migrazioni | Additive: `instruments`, `instrument_listings`, `instrument_prices`, `investment_assets.instrument_id`. Secondo passo, additive: `investment_plans`, `investment_plan_runs` (`unique (plan_id, due_on)`), `investment_operations.plan_run_id` (nullable, unico) | Additive: preferenze dei canali, coda delle notifiche da leggere | Rimozioni. Solo dopo un rilascio stabile di chi le ha rese inutili |
| Rollback | Immagini `pre-r5d` e, per il secondo passo, `pre-r5d-2`; le tabelle nuove restano vuote o inutilizzate. Gli acquisti già registrati da un piano restano operazioni normali | Immagini `pre-r5e` | Immagini `pre-r5f` + dump `r5f.dump` (obbligatorio: è l'unico rilascio non compatibile all'indietro senza dump) |
| Test | G1-G9; P&L con le stesse regole di `investments-ux.md` §4; vendita oltre la quantità bloccata; prezzo più vecchio di 5 giorni lavorativi → «da aggiornare». Secondo passo: due esecuzioni del job nello stesso giorno creano una sola scadenza e un solo acquisto; ripresa dopo un'interruzione a metà; prezzo assente → `waiting_price`, poi voce da completare a mano dopo 5 giorni; recupero di al massimo 12 scadenze dopo un fermo; P&L di un acquisto da piano = P&L dello stesso acquisto inserito a mano | G1-G9; un evento non si ripete prima della sua pausa; nessun importo nei testi | G1-G9; restore di prova del dump in un database temporaneo |
| Criteri di accettazione | Gli 8 strumenti dello spike hanno anagrafica e prezzo; scostamento sul totale entro lo 0,05% rispetto alla banca con il mercato dell'ordine; un conto letto da una banca non può essere un portafoglio manuale. Secondo passo: nessun acquisto scritto senza conferma con il modo `propose`; un acquisto automatico ha il segno «automatica» ed è modificabile; mai due acquisti per la stessa scadenza; un servizio collegato non ha piani; l'addebito di un piano non compare come abbonamento; nessun dato dei fondi passa ai piani | Ogni evento che chiede un'azione è anche in «Da fare»; mai due avvisi per lo stesso fatto | Nessuna query usa gli oggetti rimossi; fotografia dei numeri uguale |
| OK di Mattia | Sì | Sì | Sì |
| Dimensione | L | M | S |

### R5g · Lavoro standard

Revisione sulla standardizzazione, in attesa dell'OK di Mattia. Si fa dopo R5c e prima di R5f (ipotesi ST-22).
Elenco delle voci: [`11-standardization.md`](11-standardization.md) §11.5.

| | |
|---|---|
| Obiettivo | Payroll e Time Off usabili da un utente con un altro datore di lavoro, un altro contratto o un altro paese, senza codice |
| Contenuto | **Tipi di assenza come dati** (E6): tabella `leave_types` (nome, colore, «ha un monte», «va al calendario esterno», unità: giorno, mezza giornata, ore). I tipi predefiniti arrivano dal pacchetto paese (`IT`: Ferie, ROL/Permessi, Malattia); l'utente ne aggiunge altri (ipotesi ST-7). Monte per (anno, tipo); una scheda per tipo con monte; riporto inseribile a mano; un giorno passato è «goduto» anche senza busta paga; inizio dell'anno ferie e giorni lavorativi come configurazione; giorni non lavorativi personali (il patrono diventa una riga). Festività: fine del ripiego italiano nel codice (ipotesi ST-20). **Profili delle buste paga** (E1): registro dei lettori con `detect()`; un profilo è un file di dati (etichette, colonne, formati, codici, controlli, ritardo delle assenze). Il profilo di oggi è il primo. Busta paga generica inseribile a mano: mese, lordo, tasse, contributi, netto, PDF allegato (ipotesi ST-21). Campi base nel core; campi e ruoli del paese dal pacchetto `IT`, salvati come coppie chiave-valore (E4). Colonne e KPI dal catalogo dei campi. Prompt AI costruito da profilo, lingua e valuta. **Configurazione del datore** (E6): numero e mese delle mensilità extra, frequenza di paga; tipi di busta `ordinary`, `extra`, `bonus`, `settlement`. Regola di interesse: conteggio dei giorni, ancora del periodo e finestra dell'accredito come campi, con i default di oggi; tassa di default dal paese |
| Per l'utente | Mattia ritrova «Ferie» e «ROL» già creati, gli stessi residui e le stesse buste paga. Un utente nuovo crea i suoi tipi di assenza e inserisce una busta paga a mano o con un profilo |
| Git | Branch + PR · `feat(timeoff)`, `feat(payroll)` · criterio #1. Due PR di seguito, una per modulo: prima Time Off, poi Payroll |
| Migrazioni | Additive: `leave_types`; monte per (anno, tipo); `leave_days.type_id` (nullable, poi riempita); giorni non lavorativi personali; configurazione del datore; campi extra della busta paga come coppie chiave-valore; campi nuovi della regola di interesse con default. Dati: i 5 tipi di oggi → righe; le 36 righe di assenza → `type_id`; 1 riga di monte → 2 righe; 1 patrono → 1 riga; tipi di busta `thirteenth`, `fourteenth`, `fifteenth` → `extra` con il numero; valori fiscali italiani copiati nei campi extra. Le colonne vecchie restano e restano scritte fino a R5f |
| Rollback | Immagini `pre-r5g-timeoff` e `pre-r5g-payroll`: l'immagine precedente legge le colonne vecchie, ancora scritte. Dump `r5g.dump` |
| Test e gate | G1-G9. Le 14 buste paga applicate, rilette con il profilo, danno gli stessi valori campo per campo. Residui di ferie e ROL uguali per ogni anno. Fotografia dei numeri uguale. Integration: un tipo di assenza nuovo con monte entra nel residuo senza codice; un utente senza buste paga ha un residuo corretto; una busta paga a mano entra nel registro dell'anno; un profilo nuovo si aggiunge come file di dati, con un test di sola lettura. E2E: Time Off e Payroll con un utente nuovo senza profilo |
| Criteri di accettazione | 1) Nessun nome di tipo di assenza nel codice e nei check DB: 0 usi di `vacation` e `rol` fuori dai dati e dalla migrazione. 2) Nessun nome di datore, di modulo di busta paga o di fornitore nel codice dei moduli `payroll` e `timeoff` (lista nota di M12 vuota per i due moduli). 3) Un utente senza profilo usa Payroll con l'inserimento a mano. 4) Un utente senza calendario festivo vede solo i fine settimana e un avviso. 5) Mattia: stessi residui, stesse buste paga, stessi KPI; la sync con Trek funziona come prima. 6) Export e cancellazione dell'utente derivano dai tipi registrati |
| OK di Mattia | Sì, sul SHA di ogni PR. Prima dell'inizio: conferma delle ipotesi ST-7, ST-20, ST-21, ST-22 |
| Dipende da | R2 (timeoff, payroll, documents), R5c (Trek come plugin), R0 (`shared/country`) |
| Dimensione | L |

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
