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
| Contenuto | Passo 1: prova su una banca vera (S4). Poi: contratto v1 (`manifest`, `verify`, `auth/start`, `auth/complete`, `sync`), con lo schema del manifest già completo di etichette, campi delle credenziali, intervallo minimo e capacità (anticipo AN2, [`11-standardization.md`](11-standardization.md) §11.6), lato core che chiama il plugin, rete `ledgerly_plugins`, container `ledgerly-plugin-enablebanking`, credenziali Enable Banking per utente cifrate nel core, flusso di consenso con ritorno su `/api/v1/plugins/enablebanking/callback`, prima sync subito dopo il consenso, letture automatiche (3 al giorno), «Sincronizza ora» con header `Psu-*`, voce del plugin per utente in Settings › Integrations («Attiva», «Disattiva»; decisione H25), procedura guidata «Collega una banca». Il container del plugin fa parte dell'installazione standard dell'istanza: nessun passo dell'admin nell'interfaccia. Specifica delle schermate: [`ux/n1-plugin-bank.md`](ux/n1-plugin-bank.md). Campi grezzi della banca salvati sul movimento |
| Per l'utente | Il plugin è già nell'istanza, non attivo. Ogni utente lo attiva per sé, inserisce la sua applicazione Enable Banking e collega una banca. Lo disattiva quando vuole: le letture si fermano, conti e movimenti restano e tornano alla riattivazione. L'admin non fa niente (H25). I conti della banca sono conti nuovi o conti manuali esistenti |
| Git | Branch + PR · `feat(plugins)` · criteri #1 (schema), #3 (rete nuova), #4 (rotta di ritorno legata alla sessione), #5 (segreto condiviso core-plugin) |
| Migrazioni | Additive: `integration_connections.instance_key` e `expires_at`, nuova chiave unica `(user_id, provider, instance_key)` accanto a quella vecchia; `plugins`; `plugin_user_credentials`; attivazione del plugin per utente (H25: forma scelta dallo sviluppo); colonne grezze su `transactions`. Dettaglio: [`06-data.md`](06-data.md) §6.1 |
| Rollback | Immagine `pre-n1`; `docker compose stop` del plugin. Le tabelle nuove restano inutilizzate. I conti creati dalla banca restano come conti senza sorgente |
| Test e gate | G1-G9. Kit di test del contratto contro risposte registrate (fixture dalla sandbox e, anonime, dalla banca vera). Integration: consenso, `state` legato alla sessione, scadenza, 429 → attesa di 6 ore, idempotenza su `entry_reference` e sull'hash di riserva. E2E: procedura guidata contro la sandbox |
| Criteri di accettazione | 1) Un consenso reale va a buon fine dal browser senza copiare codici a mano. 2) Lo storico oltre 90 giorni è letto nella prima sync. 3) Due sync di seguito non creano doppioni. 4) Il plugin non ha `DATABASE_URL`, `APP_ENCRYPTION_KEY` né volumi. 5) Le credenziali non compaiono in log, API, MCP, export. 6) Un secondo utente non vede e non usa le credenziali del primo. 7) Per un utente che non ha attivato il plugin l'app si comporta come prima; l'unico elemento nuovo è la voce «Enable Banking · Non attivo» in Settings › Integrations. 8) Fotografia dei numeri invariata per i conti esistenti. 9) Nessun passo dell'admin nell'interfaccia: un utente non admin attiva il plugin, collega una banca e lo disattiva da solo; l'attivazione di un utente non cambia niente per un altro utente. 10) Dopo la disattivazione le letture di quell'utente sono ferme, conti e movimenti restano; dopo la riattivazione le letture ripartono |
| OK di Mattia | Sì, sul SHA. Passi di Mattia: applicazione Production, chiave nuova inserita solo dall'interfaccia, accesso alla banca |
| Dipende da | N0 |
| Dimensione | L |

### N2 · Stato dei collegamenti

| | |
|---|---|
| Obiettivo | Sostituire il sync log con uno stato semplice. Permettere più banche |
| Contenuto | Stato a 5 valori per collegamento (aggiornato, in corso, in ritardo, serve un'azione, in pausa), cronologia semplice (10 righe), codice di errore da una lista chiusa, avviso dopo 3 fallimenti o subito se serve un'azione, avviso di scadenza del consenso a 14 e 3 giorni, «Rinnova accesso». Chiavi di notifica generiche (`sync_failed`, `sync_stale`) con il fornitore come parametro, al posto delle chiavi con il nome di un fornitore: stessi avvisi, stesso testo (anticipo AN3). Registro grezzo per utente, sotto «Avanzate»: ogni utente vede solo i suoi collegamenti, 30 giorni, «Copia rapporto» senza segreti. L'admin vede solo lo stato dei plugin in Server › Diagnostica (H29). Il collegamento di un plugin disattivato dall'utente è «In pausa», con l'azione «Attiva», senza avvisi di ritardo o di scadenza (H30). Chiusura delle righe `running` orfane. Rimozione della chiave unica vecchia: da qui un utente collega più banche. Pianificazione sotto «Avanzate» |
| Per l'utente | Una riga chiara per collegamento, con una sola azione quando serve |
| Git | Branch + PR · `feat(integrations)` · criterio #1 |
| Migrazioni | Additive: `error_code`, `consecutive_failures` su `integration_connections`; `origin`, `error_code`, `http_status`, `app_version` su `sync_runs`. Contrazione: rimozione di `integration_connections_user_provider_uq` (seconda metà della migrazione in due tempi). Dati: righe `running` vecchie → `failed`; conservazione di `sync_runs` da 90 a 30 giorni |
| Rollback | Immagine `pre-n2` = `v0.19.1`: usa la chiave nuova in ogni salvataggio (la `v0.19.0` no: [`06-data.md`](06-data.md) §6.1, «Correzione al primo tempo»). Dump `n2.dump` per la modifica ai dati; [`n2-rollback.sql`](n2-rollback.sql) |
| Test e gate | G1-G9. Unit: stato derivato per ogni combinazione di `state`, `last_ok_at`, `next_sync_at`, fallimenti. Integration: chiusura delle righe orfane, conservazione. E2E: pagina dei collegamenti a 400 e 1440 px, nei due temi |
| Criteri di accettazione | 1) Nessuna parola tecnica nella vista normale. 2) Un utente raggiunge solo il registro grezzo dei suoi collegamenti; l'admin non raggiunge il registro di un altro utente. 3) Zero righe `running` più vecchie di un'ora dopo il deploy. 4) Nessun messaggio grezzo del provider salvato dai collegamenti nuovi. 5) Una seconda banca si collega |
| OK di Mattia | Sì, sul SHA |
| Dipende da | N1 |
| Dimensione | S |

### N3 · Categorizzazione automatica e movimento manuale

| | |
|---|---|
| Obiettivo | Dare categorie ai movimenti delle sorgenti che non le hanno. Permettere un movimento a mano, sui conti «a mano» e «sola lettura», con il suo effetto sul saldo |
| Contenuto | Cascata nel core: struttura → memoria severa → classificatore lineare per utente → tabelle MCC e marchi → «Da categorizzare». Origine, confidenza e versione del modello sul movimento. Soglia calcolata per la precisione 95%. Segno «automatica» con il motivo. Vista «Da rivedere» a gruppi. Dopo una correzione: «Applico a N movimenti simili?». Proposta di unione delle categorie doppie. Circa 12 gruppi predefiniti. Revisione guidata alla prima sync. Movimento manuale: crea, modifica, cancella, sui conti «a mano» e «sola lettura» (H32); cambia il saldo (H33); avviso su un conto «sola lettura». I conti «lettura e scrittura» e l'associazione delle categorie di una sorgente arrivano con N3.1 (H36): fino ad allora il dialogo non offre quei conti |
| Per l'utente | I movimenti della banca arrivano con una categoria o in «Da categorizzare». Le spese in contanti si registrano a mano e il saldo del conto cambia subito |
| Git | Branch + PR · `feat(transactions)` · criterio #1 |
| Migrazioni | Additive: `category_origin`, `category_confidence`, `category_model_version` su `transactions`; `category_memory`; `category_models`; origine `manual` del movimento; categoria suggerita e codice del motivo sul movimento; fonte `movement` nel check dei saldi (check allargato, [`12-account-modes.md`](12-account-modes.md) §12.8). Riempimento: `category_origin = 'provider'` per i movimenti esistenti con categoria. |
| Rollback | Immagine `pre-n3`; dump `n3.dump`. L'immagine precedente ignora le colonne nuove. I movimenti manuali creati restano visibili come movimenti normali. L'immagine precedente non conosce la regola del saldo: non aggiorna i saldi dei movimenti a mano. `n3-rollback.sql` cancella le righe con fonte `movement`: da lì l'immagine precedente mostra il saldo senza i movimenti a mano. |
| Test e gate | G1-G9. File di riferimento «testo → caratteristiche → categoria attesa». Prova in ordine di tempo su fixture anonime: precisione automatica ≥ 95%. Integration: una previsione automatica non entra mai nell'addestramento; isolamento per utente; il modello non esce da export, API, MCP |
| Criteri di accettazione | 1) I movimenti di una sorgente che dà le categorie non si ricategorizzano; al rilascio ogni categoria della sorgente è «aggiunta» con il suo nome, come oggi (H34). 2) Una categoria automatica conta in Budgets ed Expenses; un suggerimento non confermato conta come «Da categorizzare». 3) Precisione automatica ≥ 95% sulla prova; la copertura è misurata e riportata, senza soglia. 4) L'addestramento resta nel limite di memoria del container. 5) Un doppio invio dello stesso movimento manuale crea una sola riga. 6) Fotografia dei numeri invariata al rilascio; dopo un movimento a mano il saldo del conto cambia secondo H33. 7) Su un conto «sola lettura», dopo la lettura successiva il saldo è quello della sorgente e il movimento a mano resta. 8) Un movimento a mano con una data prima dell'ultimo saldo conosciuto non cambia il saldo di oggi |
| OK di Mattia | Sì, sul SHA |
| Dipende da | N1 (campi grezzi), N2 |
| Dimensione | L |

N3 arriva in due PR di seguito, ognuna con il suo OK ([`12-account-modes.md`](12-account-modes.md) §12.8, punto 14):

| Parte | Contenuto | Criteri di N3 | Rollback |
|---|---|---|---|
| 1 · Movimento a mano | Dialogo di Expenses (crea, modifica, elimina), badge «A mano», modalità del conto, regola del saldo, chiave di idempotenza. Migrazione `0053_manual_movement` | 5, 6 (saldo), 7, 8 | Immagine `pre-n3-1`; dump `n3-1` |
| 2 · Categorie automatiche | Cascata, «Da rivedere», azioni di gruppo, proposta di unione, gruppi predefiniti, revisione guidata, suggerimento nel dialogo del movimento a mano, «Da categorizzare» al posto di «Senza categoria» | 1, 2, 3, 4, 6 (fotografia) | Immagine `pre-n3-2`; dump `n3-2` |

Nella parte 1 il dialogo non chiede ancora un suggerimento di categoria e il campo vuoto si chiama «Senza categoria»:
i due punti arrivano con la cascata.

### N3.1 · Invio dei movimenti a mano e categorie delle sorgenti

Rilascio nato dalla decisione H36 (Mattia, 15/11/2026). Concetto: [`12-account-modes.md`](12-account-modes.md) §12.1-§12.3.
Interfaccia: [`ux/n3-categories-manual.md`](ux/n3-categories-manual.md) §6.4 e §9.8. Le stime con il segno **[DEV]**
sono una prima lettura: le conferma lo sviluppatore.

| | |
|---|---|
| Obiettivo | Un movimento a mano su un conto «lettura e scrittura» arriva alla sorgente. Le categorie di una sorgente che le dà già si associano alle categorie di Ledgerly |
| Contenuto | Il dialogo del movimento a mano offre anche i conti «lettura e scrittura». All'aggiornamento successivo il core scrive il movimento sulla sorgente; stato «Da inviare» e «Non inviato» sulla riga; nuovo tentativo a ogni aggiornamento e «Riprova l'invio»; link esterno dopo l'invio; nessun doppione quando la sorgente restituisce il movimento. La modalità del conto deriva dalla capacità della sorgente di creare un movimento, senza nomi di fornitore nel dominio (H32). Sezione «Categorie di {sorgente}» in Settings › Categories: «associa» o «aggiungi» per ogni categoria, anche in modo misto; segno «Nuova»; il movimento inviato porta la categoria della sorgente che corrisponde |
| Per l'utente | Una spesa scritta in Ledgerly su un conto Wallet compare anche su Wallet. Le categorie di Wallet si ordinano sotto le categorie di Ledgerly |
| Git | Branch + PR · `feat(transactions)` · criterio #1; #8 da valutare sul diff: Ledgerly scrive dati nuovi su un servizio esterno **[DEV]** |
| Migrazioni | Additive: stato dell'invio sul movimento; tabella della corrispondenza «categoria della sorgente → categoria di Ledgerly», per utente e per sorgente; categoria della sorgente sul movimento. Dati: una riga di corrispondenza «aggiunta» per ogni categoria della sorgente di oggi; categoria della sorgente sui movimenti esistenti |
| Rollback | Immagine `pre-n3-1`; dump `n3-1.dump`. L'immagine precedente ignora colonne e tabella nuove. Un movimento già inviato resta sulla sorgente e torna come movimento della sorgente. Un movimento «Da inviare» resta in Ledgerly, come movimento a mano |
| Test e gate | G1-G9. Integration: «invio poi lettura = una riga»; un doppio invio con la stessa chiave di idempotenza crea un solo movimento sulla sorgente; invio non riuscito → nuovo tentativo; collegamento «In pausa» → nessun invio; cambio di corrispondenza e «Annulla». Fotografia dei numeri uguale dopo il riempimento della corrispondenza. E2E: sezione «Categorie di {sorgente}» a 400 e 1440 px, nei due temi |
| Criteri di accettazione | 1) Un movimento a mano su un conto «lettura e scrittura» compare sulla sorgente dopo l'aggiornamento successivo, una sola volta. 2) Dopo l'invio il saldo del conto è quello della sorgente. 3) Un invio non riuscito non perde il movimento e non cambia lo stato del collegamento oltre le regole di N2. 4) Al rilascio ogni categoria della sorgente è «aggiunta» con il suo nome: fotografia dei numeri invariata. 5) Dopo un'associazione i movimenti della sorgente contano nella categoria di Ledgerly scelta, senza essere ricategorizzati. 6) Nessun nome di fornitore nella regola della modalità (lista nota di M12 non peggiora) |
| OK di Mattia | Sì, sul SHA |
| Dipende da | N3 |
| Dimensione | M **[DEV]** |

### N4 · Passaggio di un conto da Wallet a Enable Banking

Revisione del 16/11/2026: applica le decisioni H39-H47 di Mattia ([`01-decisions.md`](01-decisions.md) §1.0).
Interfaccia: [`ux/n4-account-switch.md`](ux/n4-account-switch.md), in particolare §2.4 (IBAN) e §9.3 (giroconti).
Regole tecniche: [`04-now.md`](04-now.md) §4.6. I punti con il segno **[DEV]** sono una prima lettura del designer:
li conferma lo sviluppatore prima dello sviluppo.

| | |
|---|---|
| Obiettivo | Cambiare la sorgente di un conto senza doppi conteggi e senza perdita di storico. Impedire che lo stesso conto vero sia due volte in Ledgerly |
| Contenuto | **Passaggio.** Scelta «È lo stesso conto di…» nella procedura della banca. Regola M1 corretta: abbinamento per gruppi (conto + importo, confronto dei conteggi), poi testo, poi data. Prova a secco obbligatoria con rapporto; la sezione «Da controllare» è solo da leggere (H44). Controllo del saldo bloccante; il tipo di saldo lo sceglie Ledgerly, uno per banca (H43). Un conto per volta. Il pass Wallet salta i conti passati. La pubblicazione degli interessi su Wallet finisce per i conti passati. «Annulla passaggio», senza limite di tempo, finché la sorgente di partenza è collegata (H42); dopo l'annullamento i movimenti arrivati dalla banca non contano e non si vedono, e nessuna riga è cancellata (H41). **IBAN sul conto (H39, H45-H47), regola generale per ogni conto con movimenti e per ogni sorgente.** Campo IBAN facoltativo sul conto, accanto al campo «Riferimento»; i conti di investimento e i fondi non lo hanno; l'IBAN non esce da Ledgerly con API, MCP ed export. Il campo lo riempie la sorgente quando lo dà, oppure lo scrive la persona. Un IBAN, un conto: unico per utente tra i conti non archiviati. La procedura di collegamento, gli aggiornamenti automatici e la creazione a mano non creano un conto con un IBAN già presente: mostrano un avviso con il nome del conto che ha quell'IBAN. Nessuna unione di due conti. **Giroconti su tutto lo storico (H40).** Regola nuova del dominio, per importo e data, tra il conto passato e gli altri conti della stessa banca. La prova elenca ogni coppia e il totale per anno prima di «Applica». «Annulla passaggio» riporta ogni coppia com'era, con la categoria di prima |
| Per l'utente | L'utente sceglie se e quando passare un conto. Vede prima il rapporto, con i giroconti e l'effetto sui mesi passati. Un conto che è già in Ledgerly non entra una seconda volta: Ledgerly dice quale conto ha lo stesso IBAN |
| Git | Branch + PR · `feat(accounts)` · criterio #1 (schema: campo IBAN; dati: `provider` del conto, link esterni, coppie di giroconti) |
| Migrazioni | **Di schema, additiva (H39):** campo IBAN del conto, nullable, con la regola «unico per utente tra i conti non archiviati». **[DEV]** Forma della regola: indice unico parziale, oppure controllo nel servizio se due conti di oggi hanno lo stesso IBAN. **[DEV]** Dati del passaggio fatto e delle coppie di giroconti (specifica §18, punti 10 e 11): colonne o tabella nuove, additive. Dati al rilascio: copia nel campo IBAN dei valori di «IBAN o riferimento» che sono un IBAN valido; il campo vecchio resta, come «Riferimento» (H46). Dati su richiesta dell'utente: `accounts.provider`, righe di `provider_links`, coppie di giroconti. Dettaglio: [`06-data.md`](06-data.md) §6.1 |
| Rollback | Per conto, dall'interfaccia: «Annulla passaggio» riporta `provider` a `wallet`, toglie i link Enable Banking e riporta ogni coppia di giroconti a un'entrata e un'uscita; nessuna riga di movimento cancellata. Rilascio: immagine `pre-n4`, che ignora il campo IBAN e non applica la regola «un IBAN, un conto»; dump `n4.dump` prima del deploy (migrazione di schema) e un dump nuovo prima del primo passaggio reale. **[DEV]** Con l'immagine `pre-n4` le coppie di un passaggio già applicato restano giroconti: prima del rollback dell'immagine si annulla ogni passaggio, oppure un file `n4-rollback.sql` riporta le coppie |
| Test e gate | G1-G9. Unit: abbinamento per gruppi sui tre scenari dello spike (stessa data; 0-3 giorni con 3% di differenze; 0-5 giorni con 5%). Unit: controllo e forma dell'IBAN; regola «un IBAN, un conto» senza nomi di fornitore; regola dei giroconti su tutto lo storico, con i casi ambigui (due spostamenti uguali nello stesso giorno: nessuna coppia) e valute diverse. Integration: prova a secco senza scritture, con l'elenco delle coppie; blocco con saldo diverso; annullamento, con ogni coppia e ogni categoria riportata; un conto con un IBAN già presente è rifiutato dalla procedura, da un aggiornamento automatico e dalla creazione a mano (codice `iban_exists`); l'IBAN non compare in registro, log, URL, «Copia rapporto», risposte dell'API, strumenti MCP ed export; la copia da «IBAN o riferimento» prende solo i valori validi e non cambia il campo vecchio. Fotografia dei numeri: uguale al rilascio; dopo un passaggio di prova diversa solo per le coppie elencate; uguale dopo l'annullamento |
| Criteri di accettazione | 1) La prova a secco non scrive nulla. 2) Nessun movimento della banca si lega a una riga esistente quando i conteggi del gruppo sono diversi: va nel rapporto, e la persona non lo collega a mano (H44). 3) Una differenza di saldo blocca l'applicazione; nessuna scelta di un altro tipo di saldo (H43). 4) Dopo il passaggio: saldo della banca = saldo locale alla stessa data. 5) Dopo «Annulla passaggio» la fotografia dei numeri è uguale a prima del passaggio, comprese le coppie di giroconti e le loro categorie; fanno eccezione solo i movimenti che la sorgente di partenza ha letto nel frattempo (H40, H41). 6) Nessuna strada crea un conto con un IBAN già presente in un conto non archiviato dello stesso utente: procedura, aggiornamento automatico, creazione e modifica a mano. L'avviso dice quale conto ha quell'IBAN (H39). 7) La prova elenca ogni coppia di giroconti e il totale per anno. Dopo «Applica» entrate e uscite scendono dell'importo scritto nel rapporto, non di più; patrimonio e saldi di ogni conto non cambiano (H40). 8) Al rilascio, prima di ogni passaggio, la fotografia dei numeri è invariata. 9) L'IBAN non compare in URL, toast, log, registro, «Copia rapporto», risposte dell'API, strumenti MCP ed export (H45). 10) Nessun nome di fornitore nella regola dell'IBAN e nella regola dei giroconti (lista nota di M12 non peggiora). 11) Al rilascio ogni conto con un IBAN valido in «IBAN o riferimento» ha lo stesso valore nel campo «IBAN»; il campo «Riferimento» ha il valore di prima (H46). 12) I conti di investimento e i fondi pensione non hanno il campo IBAN (H47) |
| OK di Mattia | Sì, sul SHA. Ogni passaggio reale di un conto è una scelta di Mattia nell'interfaccia |
| Dipende da | N3. Ordine previsto: dopo N3.1; può andare prima per scelta di Mattia (H36). Con N3.1 già rilasciato vale H38: prima l'invio dei movimenti a mano, poi il passaggio |
| Dimensione | L **[DEV]** (era M). In più rispetto alla riga del 13/11/2026: campo IBAN con migrazione, controllo in tre strade di creazione, regola nuova dei giroconti con elenco e annullamento |

**Eccezioni dichiarate a «comportamento invariato» di N4.** La regola della fase A dice: nessun numero esistente
cambia senza una decisione scritta.

| # | Cosa cambia | Quando | Decisione | Limiti |
|---|---|---|---|---|
| X1 | Entrate e uscite dei mesi passati scendono: ogni coppia riconosciuta era un'uscita e un'entrata, e diventa un giroconto. Scendono anche la spesa per categoria e i budget di quei mesi, per i movimenti che avevano una categoria. Budget e grafici dei mesi passati cambiano senza un avviso nelle loro pagine | Solo dopo «Applica» di un passaggio reale, scelto dall'utente. Mai al deploy | H40 | Solo i movimenti tra il conto passato e gli altri conti della stessa banca. Patrimonio e saldi non cambiano. Il rapporto dice numero delle coppie e importo per anno prima di «Applica». «Annulla passaggio» riporta ogni coppia |

Non sono eccezioni: il campo IBAN non cambia nessun numero; al rilascio la fotografia dei numeri è invariata
(criterio 8). Rischio «coppie sbagliate»: [`09-risks.md`](09-risks.md) R-34.

**Effetti di H39 e H40 sugli altri rilasci.** Questa tabella elenca gli effetti. Non riscrive i rilasci.

| Rilascio o parte | Effetto | Da confermare |
|---|---|---|
| **N1** (in produzione) | La procedura della banca cambia in N4: con un IBAN già presente «Crea un conto nuovo» non è disponibile e il server rifiuta l'importazione (`iban_exists`). Il contratto dei plugin dà oggi un campo solo, «IBAN o un altro numero» (`identifier`) | **[DEV]** Il core riconosce l'IBAN da `identifier` con il controllo delle cifre, oppure il contratto v1 riceve un campo `iban`, additivo |
| **N2** (in produzione) | Un aggiornamento che trova un conto nuovo con un IBAN già presente non lo crea: la riga del collegamento mostra un avviso con l'azione «Scegli i conti». Non è uno stato nuovo del collegamento e non conta nei «3 fallimenti». L'IBAN resta fuori dal registro e da «Copia rapporto» | **[DEV]** Dove si salva l'avviso |
| **N3** | Nessun effetto sul movimento a mano e sulle categorie. «Nuovo conto» e le impostazioni del conto ricevono il campo IBAN in N4 | — |
| **N3.1** | Nessun effetto sul contenuto. Ledgerly non scrive mai l'IBAN sulla sorgente: `POST /push` porta movimenti, non dati del conto. Un IBAN scritto a mano resta solo in Ledgerly. Se N3.1 arriva dopo N4, la regola vale già; se arriva prima, non cambia | — |
| **N5, N5.1, N6** | Nessun effetto. I conti di investimento e i fondi non hanno il campo (H47) | — |
| **Giroconti per IBAN di oggi** | La regola di oggi legge l'IBAN dal campo «IBAN o riferimento» del conto e abbina due movimenti che sono già giroconti. Da N4 legge il campo IBAN. Con più conti con un IBAN, più giroconti già riconosciuti si abbinano: entrate e uscite non cambiano, perché la regola non trasforma un'entrata o un'uscita | **[DEV]** Conferma con la fotografia dei numeri al rilascio (criterio 8) |
| **R1** | Il controllo «IBAN già presente» è un passo del job di sync: il job non crea il conto e scrive l'avviso | — |
| **R2** | 1) Rotte di creazione e di modifica del conto: campo IBAN in scrittura, con controllo e codice di errore `iban_exists`, additivi. 2) `GET /accounts`, MCP ed export non danno l'IBAN, né intero né mascherato (H45): nessun campo nuovo in lettura. 3) Punto di estensione E7 (abbinatore di movimenti): la strategia «IBAN» legge il campo nuovo; la regola dei giroconti su tutto lo storico è la strategia «importo e data» dello stesso abbinatore, non una regola doppia | **[DEV]** La regola di N4 nasce già come funzione pura, con la forma di E7 |
| **R3** | Il campo e gli avvisi passano a `packages/ui`. Nessun client controlla l'IBAN da solo: l'errore arriva dall'API | — |
| **R5a** | Il primo avvio guidato e «Nuovo conto» hanno il campo IBAN. Il glossario unico ha «IBAN» e «giroconto» | — |
| **R5c** | Ogni plugin che dà conti dà l'IBAN nello stesso campo del contratto, quando la sorgente lo ha. La regola «un IBAN, un conto» resta nel core: un plugin non la applica e non la conosce. Import CSV (ST-8): un import che crea un conto rispetta la regola | **[DEV]** Il plugin Wallet dà l'IBAN del conto in ogni caso (decisione di Mattia: sì) |
| **Export** | Oggi la sezione `accounts` dell'export non ha «IBAN o riferimento». Resta senza IBAN (H45). Il campo «Riferimento» resta fuori, come oggi | — |
| **MCP** | Oggi `list_accounts` non dà «IBAN o riferimento». MCP resta in sola lettura (F5b): nessuno strumento scrive l'IBAN. Nessuno strumento lo legge (H45) | — |
| **Dump e fotografia dei numeri** | Il dump del database contiene l'IBAN, come gli altri dati personali: stessi permessi di oggi. Il file della fotografia dei numeri non deve contenere l'IBAN | **[DEV]** Lo script `numbers-snapshot` non legge il campo |
| **C1, C2 (Android)** | L'IBAN non è nell'API (H45): non entra nella cache del telefono e le app non lo mostrano | — |

**Nota di sicurezza (da riportare alla review finale Z).** L'IBAN è un dato personale. Decisione H45:
non compare in API, MCP, export e log. Regole già fissate dalla specifica (§2.4.1): mai in URL, toast, registro e «Copia
rapporto»; mascherato negli elenchi e nella procedura della banca. **[DEV]** Cifrato o no nel database, come gli
altri dati del conto.

**Punti nati dal controllo del piano: decisi.** Mattia ha scelto il default (A) per tutti e tre, il 16/11/2026
(H45-H47). Nessun punto è aperto.

| # | Domanda | Esempio | A (default) | B | Effetto | Decisione |
|---|---|---|---|---|---|---|
| P1 | L'IBAN di un conto esce da Ledgerly con API, MCP ed export? | Un assistente collegato con MCP chiede l'elenco dei conti. Tu scarichi l'export | No: l'IBAN si vede solo nelle pagine di Ledgerly. API, MCP ed export non lo contengono. I log non lo contengono in nessun caso | Sì, in parte: API e MCP danno l'IBAN mascherato («IT60 •••• 4821»); l'export, che è tuo, lo dà intero | A: nessun dato personale nuovo fuori da Ledgerly; un client non può mostrare l'IBAN. B: un client riconosce il conto; un dato personale in più in API, MCP e file. Tocca R2, export, MCP, C1 | **A** (H45) |
| P2 | Oggi il conto ha un campo solo, «IBAN o riferimento». Cosa succede a quel campo? | «Conto corrente» ha «IBAN o riferimento» = `IT60…456`. «Contanti» ha «portafoglio» | Due campi. Al rilascio Ledgerly copia nel campo «IBAN» i valori che sono un IBAN valido. Il campo vecchio resta, con il nome «Riferimento» | Un campo solo, come oggi. La regola «un IBAN, un conto» vale quando il valore è un IBAN valido | A: l'IBAN ha controllo e avviso propri; i conti di oggi sono protetti dal primo giorno; una migrazione di dati in più. Se due conti di oggi hanno lo stesso IBAN, vale il caso 7 della specifica (§2.4.2). B: nessun campo nuovo; un campo con due significati, e la sorgente non può riempirlo senza cancellare un riferimento scritto a mano. Tocca «Migrazioni» | **A** (H46) |
| P3 | I conti di investimento e i fondi pensione hanno il campo IBAN? | Il conto del fondo pensione, o il conto di un servizio di investimento | No: il campo è dei conti con movimenti (a mano, lettura e scrittura, sola lettura). È la scelta della specifica (§2.4.1) | Sì: ogni conto, di ogni tipo | A: il controllo vale dove un conto doppio può nascere da una banca. B: «ogni conto» alla lettera; un campo senza uso sui conti che non arrivano da una banca | **A** (H47) |

### N5 · Time Off

| | |
|---|---|
| Obiettivo | Un'interazione senza gesti nascosti, uguale su mouse, touch e tastiera |
| Contenuto | Selezione di primo e ultimo giorno (trascinamento solo con il mouse). Pannello: tipo, durata, nota, giorni esclusi, residuo prima → dopo. Pulsante «Aggiungi assenza» con due campi data. Tocco su un giorno prenotato: modifica o «Rimuovi». Toast con «Annulla». Tastiera: Invio, frecce, Esc, Canc. Via: ciclo al clic, pressione lunga, tasto destro, Alt. Il pannello legge i tipi di assenza da un elenco, non da nomi fissi: l'elenco contiene i tipi di oggi senza `sick` (decisione H20, decisione ST-27), nessun cambio di schema (anticipo AN1). Test: un giorno ROL avvia la sync verso Trek come un giorno di ferie; se il test fallisce, correzione come `fix` nello stesso rilascio (decisione ST-23) |
| Per l'utente | Una settimana di ferie è una sola azione con conferma |
| Git | `main` · `feat(timeoff)` |
| Migrazioni | Nessuna. La scrittura di un intervallo usa le righe di oggi, in una sola transazione |
| Rollback | Immagine `pre-n5` |
| Test e gate | G1, G2, G3, G6 (`a11y`, `keyboard`, mobile a 400 px), G7, G8. Unit: giorni esclusi, sostituzioni, residuo. Integration: un intervallo scrive tutte le righe o nessuna |
| Criteri di accettazione | 1) Ogni azione ha un controllo visibile. 2) Cella del giorno ≥ 40 px su mobile. 3) Nessuna scrittura prima di «Conferma». 4) I residui sono uguali a prima a parità di giorni. 5) La sync con Trek funziona come prima; un giorno ROL arriva a Trek senza aspettare la sync successiva. 6) Nessun nome di tipo di assenza scritto nel pannello: i tipi arrivano dall'elenco |
| OK di Mattia | No (nessun criterio §6 atteso) |
| Dipende da | N0. Indipendente da N1-N4: si può fare mentre N1 aspetta la banca vera |
| Dimensione | M |

### N5.1 · Time Off: maturazione e residuo previsto

Fuori dal piano originale: richiesta di Mattia del 14/11/2026, dopo N5. Analisi e decisioni D1-D7:
[`../timeoff-accrual.md`](../timeoff-accrual.md).

| | |
|---|---|
| Obiettivo | Time Off serve anche per pianificare: quanto matura ogni mese e quanto resta a una data futura |
| Contenuto | Ritmo di maturazione letto dalle buste paga: media delle differenze di `MAT.` tra buste paga consecutive (ultime 12); senza buste paga, dotazione ÷ 12 (D1). Saldo di partenza: `RES.` dell'ultima busta paga, anche dell'anno prima; tutto il residuo passa all'anno dopo (D4). La maturazione di un mese conta a mese finito (D3). Schede Ferie e ROL: «Matura X al mese» e «Previsto al 31/12» (U1). Pannello di N5: riga «previsto alla data dell'assenza, prima → dopo», accanto al residuo di fine anno (U2). Un anno senza buste paga proprie mostra il previsto dall'ultima busta paga, con etichetta (D6). L'avviso di superamento usa lo stesso ritmo (D5). Regole pure in un file nuovo, `src/modules/timeoff/accrual.ts`; una lettura in più nel contratto di `payroll` (`leaveSnapshotHistory`), senza query in più per la vista. Fuori: la linea del residuo nel grafico (U3) |
| Per l'utente | Vede quanto matura al mese, quanto avrà a fine anno e quanto avrà il giorno dell'assenza. Un valore sotto zero si vede e si conferma |
| Git | `main` · `feat(timeoff)`, `test`, `docs` |
| Migrazioni | Nessuna. Nessun cambio alla sync con Trek, nessun pacchetto nuovo |
| Rollback | Immagine `pre-n5-1` |
| Test e gate | G1, G2, G3, G4, G6 (`timeoff`, `a11y`, `keyboard`, mobile a 400 px, nei due temi), G7, G8, G9. Unit: ritmo, previsto a una data, cambio di anno, avviso. Integration: ritmo da due buste paga, anno senza buste paga, utente senza buste paga in un anno futuro |
| Criteri di accettazione | 1) Le schede mostrano la maturazione mensile e il previsto al 31/12, con il ritmo delle buste paga. 2) Il pannello mostra il previsto alla data dell'assenza; un valore negativo si vede e si conferma. 3) Senza buste paga: dotazione ÷ 12, con etichetta che lo dice. 4) I residui (`residual()`) sono uguali a prima: la fotografia dei numeri differisce solo nell'avviso di superamento (D5). 5) Un utente senza buste paga e un anno futuro non danno errori. 6) `npm run perf` dà lo stesso esito in 3 esecuzioni di seguito |
| OK di Mattia | No (nessun criterio §6 atteso). Le decisioni D1-D7 sono del 14/11/2026 |
| Dipende da | N5. Indipendente da N1-N4 e da N6 |
| Dimensione | M |

Con questo rilascio `npm run perf` (G9) misura in 5 processi separati e confronta la mediana migliore: la soglia del
10% e i valori di partenza non cambiano ([`../../operations.md`](../../operations.md), «Measures and baselines»).

### N6 · Fondo pensione standard

Revisione sulla standardizzazione, approvata da Mattia il 14/11/2026. Dettaglio: [`11-standardization.md`](11-standardization.md) §11.2.

| | |
|---|---|
| Obiettivo | Un solo fondo pensione: un modello, un motore, una serie di schermate. Togliere dal modulo `funds` il tipo PAC e la logica scritta per un gestore, **prima** della riscrittura: R0, R2 e R3 non spostano e non rifanno il codice che sparisce |
| Contenuto | Tabelle `fund_contribution_sources` (sorgenti `payroll`, `bank_debit`, `manual`) e `fund_fees` (commissioni generiche). Registro unico `fund_operations` con `source_id`. Un servizio `createFund` con le sorgenti; una funzione `fundFlows` al posto di `pacFlows` e `pensionFlows`. Il job `funds-deposits` scrive operazioni `voluntary`. Procedura «Aggiungi fondo pensione» in 4 passi, senza il tipo. Home e dettaglio unici: tab Panoramica · Contributi · Valori · Impostazioni; sezioni guidate dalla configurazione. Commissioni come lista modificabile. Scadenze nella sorgente; nessun ripiego sul calendario di un gestore. Nessun «Deducibile»: via il riquadro, il limite e il calcolo, per ogni fondo (H18). Nessun documento nei fondi: via il caricamento, i lettori, la lista e le pagine dei documenti, il job `cometa-sweep`; contributi e valori solo dalle sorgenti e a mano (H19). Elenco di ciò che si toglie: [`11-standardization.md`](11-standardization.md) §11.2.6. Modelli di fondo come file di dati. Migrazione dei 2 fondi in produzione (strada A). **Passo separato, dopo il resto del rilascio (decisione ST-25, H24):** cancellazione dei file dei documenti di Cometa nell'archivio S3 e delle righe `documents` dei tipi `cometa_*`; prima, dump del database e copia dei file, con una prova di ripristino (passo A4). Via: `pac-*.tsx`, i form del PAC, il motore vecchio, i percorsi di scrittura di `fund_deposits`, la tariffa scritta a ogni lettura, i testi con «PAC». Regola M12 («nomi vietati») nel gate, con la sua lista nota |
| Per l'utente | «Aggiungi fondo» non chiede il tipo. Un fondo nuovo nasce senza scadenze e senza commissioni di un altro gestore. Fideuram mostra «Contributi» con le stesse righe. Le commissioni si vedono e si modificano in una lista. Il riquadro «Deducibile» e l'import dei documenti di Cometa non ci sono più; le operazioni e i valori già letti restano. Dopo il passo A4 i file dei documenti di Cometa non sono più nell'archivio e nell'export. La voce di menu «Funds» e i gruppi di Investments non cambiano: arrivano in R5b |
| Git | Branch + PR · `feat(funds)` · criterio #1 (schema e modifica ai dati) e, per il passo A4, #2 (file di dati) |
| Migrazioni | A1, additiva: `fund_contribution_sources`, `fund_fees`; `fund_operations.source_id` e `fees_unknown`; check `fund_operations_source_ck` allargato con `rule`. A2, dati: sorgenti e commissioni dei 2 fondi; copia dei 10 versamenti di Fideuram in `fund_operations` con `origin_key = 'deposit:' + id`; `accounts.type` del conto di Fideuram da `investment` a `pension`. Le tabelle e le colonne vecchie restano ferme fino a R5f. Nessuna migrazione per H18: il «Deducibile» non ha colonne. A4, dati (decisione ST-25): `DELETE` delle righe `documents` dei tipi `cometa_*`, con `WHERE` e conteggio, e cancellazione dei loro file nell'archivio S3. Commit e deploy separati, dopo A1 e A2 in produzione e dopo la prova SN7. Le colonne `document_id` passano a `NULL` con la chiave esterna e restano fino a R5f. Dettaglio: [`06-data.md`](06-data.md) §6.1 |
| Rollback | Immagine `pre-n6`: le tabelle vecchie sono intatte e l'immagine precedente le legge come prima. File SQL di rollback nel repo: cancella le operazioni con `origin_key like 'deposit:%'`, riporta `accounts.type`, elimina tabelle e colonne nuove. I versamenti da regola fatti dopo il rilascio ritornano da soli (il job dell'immagine precedente li ricrea dai movimenti). Dump `n6.dump` per i versamenti manuali fatti dopo il rilascio. Fino al passo A4 righe e file dei documenti di Cometa non sono toccati: l'immagine precedente li legge e li carica come prima. Passo A4: la cancellazione è irreversibile senza la copia. Rollback: ripristino delle righe dal dump e dei file dalla copia in `projects/Ledgerly-dumps/` ([`06-data.md`](06-data.md) §6.3) |
| Test e gate | G1-G9. Prove «stessi numeri» SN1-SN7 ([`11-standardization.md`](11-standardization.md) §11.2.4): fotografia prima e dopo in produzione; parità della copia dentro la migrazione (la migrazione fallisce se conteggio o somme sono diversi); `fundFlows` = `pacFlows` campo per campo; commissioni di Cometa sui 14 periodi maturati; file di riferimento dei calcoli approvati; patrimonio; operazioni e valori già letti dai documenti. Prova di rollback sul database di test con l'immagine `pre-n6`. Passo A4: prova di ripristino del dump e della copia dei file prima della cancellazione; SN7 prima e dopo la cancellazione. Integration: un fondo nuovo senza modello non ha righe di scadenza e di commissione; una voce di busta paga va a un solo fondo; due esecuzioni del job non creano due operazioni; `POST /imports` con un tipo `cometa_*` non salva un file (decisione ST-26); la riconciliazione legge le operazioni registrate, senza documenti. E2E: procedura a 4 passi, dettaglio dei 2 fondi a 400 e 1440 px, nei due temi; nessun riquadro «Deducibile» e nessun import di documenti |
| Criteri di accettazione | 1) Nessun ramo sul tipo del fondo in pagine, query e servizi: 0 usi di `funds.type` fuori dalla migrazione. 2) Un fondo pensione nuovo si crea dall'interfaccia, con sorgenti e commissioni, senza codice e senza una pagina nuova. 3) Fondo senza Payroll: contributi e valori a mano. 4) Cometa: fotografia dei numeri uguale byte per byte; il «Deducibile» non entra nel confronto (X1). 5) Fideuram: valore, versato, commissioni, guadagno e rendimento uguali; cambia solo X2 (gruppo del conto). 6) Patrimonio totale uguale su Overview, somma dei conti, `GET /summary`, `get_summary`. 7) Nessuna tariffa, scadenza o fonte di un gestore nel codice del modulo: stanno nei dati del fondo o in un modello. 8) Nessuna scrittura nel database a ogni lettura di un fondo. 9) La parola «PAC» non compare nei testi di Funds. 10) Il rollback di prova riporta la fotografia dei numeri di prima. 11) La lista nota di M12 è nel repo e non contiene voci nuove. 12) Nessun riquadro e nessun calcolo «Deducibile»: 0 usi di `deductib` in `src` e in `messages`. 13) Nessun caricamento e nessun lettore di documenti nei fondi: 0 rotte, azioni, pagine e job. Le operazioni e i valori già letti restano, con gli stessi numeri (SN7). 14) Dopo il passo A4: 0 file nelle cartelle di Cometa dell'archivio S3 e 0 righe `documents` dei tipi `cometa_*`; numeri del fondo Cometa invariati (SN1, SN7) |
| Eccezioni dichiarate a «comportamento invariato» | X1: il riquadro «Deducibile» e il suo calcolo non esistono più, per ogni fondo (H18). X2: il conto di Fideuram passa al gruppo pensione; il subtotale cambia, il patrimonio no. X3: nell'export `kind` vale `pension` per ogni fondo. Ognuna con un commit separato e un test |
| OK di Mattia | Sì, sul SHA. ST-1, ST-10, ST-11, ST-12, ST-16, ST-17, ST-18, ST-26: decisioni del 14/11/2026, con il default. ST-25: decisione del 14/11/2026 (H24). Il passo A4 ha un OK suo, sul suo SHA, dopo la prova SN7 e la prova di ripristino (`git-policy` §6 #1 e #2) |
| Dipende da | N0 (fotografia dei numeri). Ultimo della fase A: parte dopo N5. Indipendente da N1-N4 |
| Dimensione | L |

Note di realizzazione di N6:

- Decisioni di Mattia del 14/11/2026 sulle 8 domande delle schermate: [`ux/n6-pension-fund.md`](ux/n6-pension-fund.md)
  §15, «Decisioni prese». Domanda 6 (modelli di fondo): A, un solo modello nel file di dati.
- Chiarimenti del piano nati con il codice: [`11-standardization.md`](11-standardization.md) §11.2.7. Due limiti da
  conoscere: la busta paga alimenta un fondo per volta fino a R2 (punto 7); le righe della tariffa che ripetono le
  commissioni della regola non diventano righe (punto 9).
- Migrazioni `0046`, `0047`, `0048` e file di rollback: [`06-data.md`](06-data.md) §6.1.
- Base delle prestazioni delle tre viste dei fondi: [`10-modularity.md`](10-modularity.md) §10.9.1.
- Il rilascio si fa con `scripts/release.sh n6 --before-from <checkout della versione in produzione>`: la fotografia
  «prima» si legge con il codice di prima, perché il codice nuovo chiede tabelle che ancora non esistono.

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
| Contenuto | `apps/worker`: stessa immagine di `api`, comando diverso. Scheduler interno, coda su PostgreSQL (`FOR UPDATE SKIP LOCKED`), una chiave unica per job, un solo worker. Registro dei job composto nel worker, trigger multipli per job. Un solo job `documents-sweep` al posto di `payslips-sweep` (`cometa-sweep` è tolto in N6). Un solo registro dei fornitori, dal descrittore (E5). I lavori `after()` diventano job in coda. Recupero delle righe `running` orfane. Heartbeat nel database. Limiti condivisi (API, tentativi di chiave) su tabella. Pool di connessioni proprio. «Sincronizza ora»: l'API mette in coda e risponde subito. Il container `ledgerly-cron` si spegne |
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
| Contenuto | Menu a 3 gruppi. Moduli attivabili per utente. Primo avvio in 3 passi. Tab mobile Overview · Accounts · Expenses · Investments · More. Settings: tab Finance (Banche, Investimenti, Categorie ed etichette) e tab Plugin; via Integrations e Categories. Glossario unico (una parola per «movimento», «collegamento» e «sorgente»). Primo avvio: «Paese e formato» (paese, valuta, fuso, formato dei numeri) proposti dal browser; il paese sceglie i default dal pacchetto paese (E4, E8). «Connections» del conto passa in Subscriptions (decisione ST-13). Frequenza «ogni N settimane o mesi» e voto «utilità» facoltativo in Subscriptions; giorno di accredito a scelta in Pockets | Read-model unico sopra investments e funds (i dati dei fondi sono già nel modello unico da N6). Home con totale, 4 KPI comuni, filtro a chip (Tutti · Azioni e crypto · Fondi pensione), 2 gruppi con subtotale; i conti con solo valore sono righe del primo gruppo. Fondi pensione nel totale. `kind` della riga: `service`, `manual_portfolio`, `pension_fund`. Strumento MCP `list_funds` in sola lettura. Conto manuale con valuta a scelta e 4 campi alla creazione. `/funds/*` → redirect a `/investments`. Via catalogo e «coming soon»: dialog a 3 scelte. Overview: lista a gruppi, subtotale = riquadro, riga di investimento → Investments | Plugin Wallet («lettura e scrittura», H32: versione del 13/11/2026 «sola lettura», sostituita) e plugin Trek (`provider.write` approvato dall'utente). Porte del dominio al posto degli import. Stato esterno generico in timeoff. Catalogo ufficiale con immagine e digest. Tab Plugin di ogni utente: elenco dei plugin del catalogo, «Attiva», «Disattiva»; i plugin arrivano e si aggiornano con l'istanza, senza «installa, aggiorna, rimuovi» nell'interfaccia (H27). Nessun plugin fuori catalogo (H28). Al passaggio i plugin Wallet e Trek sono attivi per chi ha già un collegamento e non attivi per gli altri (H30). Uscita dei plugin solo verso gli host del manifest (decisione I8). Capacità `documents.read` nel contratto dei plugin, per i lettori che chiedono codice (E1). Import CSV dei movimenti nel core, con mappa delle colonne salvata per conto (decisione ST-8). La pubblicazione degli interessi su Wallet finisce per tutti i conti (decisione ST-14, confermata da H37) |
| Per l'utente | Navigazione più corta; solo i moduli scelti | Una risposta a «quanto ho guadagnato»; la voce Funds sparisce | Wallet e Trek sono plugin: ogni utente attiva quelli che usa; chi non li usa li vede non attivi |
| Git | Branch + PR · #1 | `main`; PR solo se cambia la forma di una risposta API (campo `kind`, `include=funds`: additivi) | Branch + PR · #1, #3, #5 |
| Migrazioni | Additive: `user_preferences.modules`, stato del primo avvio, impostazioni di istanza (paese, valuta, fuso, formato). Dati: righe di «Connections» → Subscriptions | Nessuna | Additive: colonne di stato esterno generiche in timeoff; righe del registro dei plugin. Dati: connessioni Wallet e Trek → connessioni dei plugin |
| Rollback | Immagini `pre-r5a` | Immagini `pre-r5b` | Immagini `pre-r5c` (core con Wallet e Trek compilati) + dump `r5c.dump`. Le colonne `trek_*` restano fino a R5f |
| Test | G1-G9; e2e di navigazione, primo avvio con utente nuovo, a11y | G1-G9; parità: totale Investments = riquadro Investments di Overview = somma delle righe; ogni fondo ha gli stessi numeri di prima nel dettaglio; API e MCP senza `include=funds` rispondono come prima | G1-G9; kit di test del contratto per i due plugin sulle fixture esistenti; parità dei movimenti e delle ferie dopo una sync dal plugin |
| Criteri di accettazione | Nessuna pagina persa; un modulo spento non compare; Settings ha i tab decisi; un utente nuovo di un altro paese non riceve default italiani | Un solo totale; 2 subtotali uguali ai riquadri di Overview; nessun valore `pac` in API, MCP ed export; i calcoli approvati dei fondi e dei servizi non cambiano; nessun URL vecchio dà 404 | Zero import di Wallet o Trek nel core; fotografia dei numeri uguale; il plugin Wallet scrive sul provider solo ciò che la sua modalità «lettura e scrittura» prevede (H32; versione del 13/11/2026 «il plugin Wallet non scrive sul provider», sostituita) |
| OK di Mattia | Sì | Solo se la valutazione sul diff trova un criterio | Sì |
| Dimensione | M | L | L |

Nota su R5a: con le voci della revisione la dimensione può passare da M a L. Si valuta alla conferma di R5a (rischio R-15).

**Nota del 16/11/2026 su R5a (H50).** «Moduli attivabili per utente» diventa la sezione **Addons**, con un elenco di
partenza e i moduli di base non disattivabili. La colonna si riscrive dopo le risposte alle domande sugli addon
([`13-plugins-addons.md`](13-plugins-addons.md) §13.5). La proposta di default tiene gli addon in R5a; l'alternativa è un rilascio nuovo N7
nella fase A: decide Mattia (PA1). R5c non cambia: i plugin restano di ogni utente (H51).

| | R5d · Portafoglio manuale | R5e · Avvisi | R5f · Pulizia dello schema |
|---|---|---|---|
| Obiettivo | Seguire titoli a mano con prezzi automatici | Avvisi solo quando serve un'azione, uguali su ogni client | Togliere ciò che non serve più |
| Contenuto | Servizio «Portafoglio manuale» (conto titoli di Accounts, unico scrittore `portfolio`). «Registra operazione»: tipo, ricerca per ISIN, nome o ticker, data, quantità, prezzo, commissioni, cambio. Anagrafica: OpenFIGI + ESMA FIRDS. Prezzi: EODHD, BCE, CoinGecko. Mercato dell'ordine, Xetra di riserva. Stato «prezzo automatico» o «prezzo manuale» per strumento. Job giornaliero dei prezzi con tetto di chiamate. Fonti extra solo come plugin `prices`. **Secondo passo: «Piano di acquisto» (PAC)**, dopo che il primo passo è stabile: piano per strumento (importo o quantità, frequenza, giorno, inizio, fine, conto di addebito, commissione), job giornaliero `investment-plans-due`, rata proposta da confermare (default) o registrata in automatico (interruttore del piano), collegamento facoltativo al movimento di addebito con l'abbinatore E7. Dettaglio: [`11-standardization.md`](11-standardization.md) §11.3 | Un servizio di notifica con canali (in app, email, notifica del dispositivo). Rotta di lettura per il controllo periodico delle app. Testi senza importi, banca o conto. Blocco «Da fare» in Overview. Preferenze per evento. «Nascondi importi» su tutti i client | Rimozione di colonne, tabelle e valori senza uso, elencati in [`06-data.md`](06-data.md) §6.1. Comprende le rimozioni di N6 (passo A3) e di R5g. Non comprende i file e le righe dei documenti di Cometa: si cancellano in N6 (decisione ST-25) |
| Per l'utente | Posizioni, P&L e prezzi per i titoli inseriti a mano. Secondo passo: acquisti periodici con una conferma per rata | Pochi avvisi, tutti utili | Nulla |
| Git | Branch + PR · #1, #5 (chiave EODHD) | Branch + PR · #1 | Branch + PR · #1 |
| Migrazioni | Additive: `instruments`, `instrument_listings`, `instrument_prices`, `investment_assets.instrument_id`. Secondo passo, additive: `investment_plans`, `investment_plan_runs` (`unique (plan_id, due_on)`), `investment_operations.plan_run_id` (nullable, unico) | Additive: preferenze dei canali, coda delle notifiche da leggere | Rimozioni. Solo dopo un rilascio stabile di chi le ha rese inutili |
| Rollback | Immagini `pre-r5d` e, per il secondo passo, `pre-r5d-2`; le tabelle nuove restano vuote o inutilizzate. Gli acquisti già registrati da un piano restano operazioni normali | Immagini `pre-r5e` | Immagini `pre-r5f` + dump `r5f.dump` (obbligatorio: è l'unico rilascio non compatibile all'indietro senza dump) |
| Test | G1-G9; P&L con le stesse regole di `investments-ux.md` §4; vendita oltre la quantità bloccata; prezzo più vecchio di 5 giorni lavorativi → «da aggiornare». Secondo passo: due esecuzioni del job nello stesso giorno creano una sola scadenza e un solo acquisto; ripresa dopo un'interruzione a metà; prezzo assente → `waiting_price`, poi voce da completare a mano dopo 5 giorni; recupero di al massimo 12 scadenze dopo un fermo; P&L di un acquisto da piano = P&L dello stesso acquisto inserito a mano | G1-G9; un evento non si ripete prima della sua pausa; nessun importo nei testi | G1-G9; restore di prova del dump in un database temporaneo |
| Criteri di accettazione | Gli 8 strumenti dello spike hanno anagrafica e prezzo; scostamento sul totale entro lo 0,05% rispetto alla banca con il mercato dell'ordine; un conto letto da una banca non può essere un portafoglio manuale. Secondo passo: nessun acquisto scritto senza conferma con il modo `propose`; un acquisto automatico ha il segno «automatica» ed è modificabile; mai due acquisti per la stessa scadenza; un servizio collegato non ha piani; l'addebito di un piano non compare come abbonamento; nessun dato dei fondi passa ai piani | Ogni evento che chiede un'azione è anche in «Da fare»; mai due avvisi per lo stesso fatto | Nessuna query usa gli oggetti rimossi; fotografia dei numeri uguale |
| OK di Mattia | Sì | Sì | Sì |
| Dimensione | L | M | S |

### R5g · Lavoro standard

Revisione sulla standardizzazione, approvata da Mattia il 14/11/2026. Si fa dopo R5c e prima di R5f (decisione ST-22).
Elenco delle voci: [`11-standardization.md`](11-standardization.md) §11.5.

| | |
|---|---|
| Obiettivo | Payroll e Time Off usabili da un utente con un altro datore di lavoro, un altro contratto o un altro paese, senza codice |
| Contenuto | **Tipi di assenza come dati** (E6): tabella `leave_types` (nome, colore, «ha un monte», «va al calendario esterno», unità: giorno, mezza giornata, ore). I tipi predefiniti arrivano dal pacchetto paese (`IT`: Ferie, ROL/Permessi); l'utente ne aggiunge altri. Nessun tipo per la malattia: non è un'assenza di Time Off e non viene contata (decisione H20). Monte per (anno, tipo); una scheda per tipo con monte; riporto inseribile a mano; un giorno passato è «goduto» anche senza busta paga; inizio dell'anno ferie e giorni lavorativi come configurazione; giorni non lavorativi personali (il patrono diventa una riga). Festività: fine del ripiego italiano nel codice (decisione ST-20). **Profili delle buste paga** (E1): registro dei lettori con `detect()`; un profilo è un file di dati (etichette, colonne, formati, codici, controlli, ritardo delle assenze). Il profilo di oggi è il primo. Busta paga generica inseribile a mano: mese, lordo, tasse, contributi, netto, PDF allegato (decisione ST-21). Campi base nel core; campi e ruoli del paese dal pacchetto `IT`, salvati come coppie chiave-valore (E4). Colonne e KPI dal catalogo dei campi. Prompt AI costruito da profilo, lingua e valuta. **Configurazione del datore** (E6): numero e mese delle mensilità extra, frequenza di paga; tipi di busta `ordinary`, `extra`, `bonus`, `settlement`. Regola di interesse: conteggio dei giorni, ancora del periodo e finestra dell'accredito come campi, con i default di oggi; tassa di default dal paese |
| Per l'utente | Mattia ritrova «Ferie» e «ROL» già creati, gli stessi residui e le stesse buste paga. Un utente nuovo crea i suoi tipi di assenza e inserisce una busta paga a mano o con un profilo |
| Git | Branch + PR · `feat(timeoff)`, `feat(payroll)` · criterio #1. Due PR di seguito, una per modulo: prima Time Off, poi Payroll |
| Migrazioni | Additive: `leave_types`; monte per (anno, tipo); `leave_days.type_id` (nullable, poi riempita); giorni non lavorativi personali; configurazione del datore; campi extra della busta paga come coppie chiave-valore; campi nuovi della regola di interesse con default. Dati: i tipi di oggi, senza `sick`, → righe (4); le 36 righe di assenza → `type_id`; 1 riga di monte → 2 righe; 1 patrono → 1 riga; tipi di busta `thirteenth`, `fourteenth`, `fifteenth` → `extra` con il numero; valori fiscali italiani copiati nei campi extra. Le colonne vecchie restano e restano scritte fino a R5f |
| Rollback | Immagini `pre-r5g-timeoff` e `pre-r5g-payroll`: l'immagine precedente legge le colonne vecchie, ancora scritte. Dump `r5g.dump` |
| Test e gate | G1-G9. Le 14 buste paga applicate, rilette con il profilo, danno gli stessi valori campo per campo. Residui di ferie e ROL uguali per ogni anno. Fotografia dei numeri uguale. Integration: un tipo di assenza nuovo con monte entra nel residuo senza codice; un utente senza buste paga ha un residuo corretto; una busta paga a mano entra nel registro dell'anno; un profilo nuovo si aggiunge come file di dati, con un test di sola lettura. E2E: Time Off e Payroll con un utente nuovo senza profilo |
| Criteri di accettazione | 1) Nessun nome di tipo di assenza nel codice e nei check DB: 0 usi di `vacation` e `rol` fuori dai dati e dalla migrazione. 2) Nessun nome di datore, di modulo di busta paga o di fornitore nel codice dei moduli `payroll` e `timeoff` (lista nota di M12 vuota per i due moduli). 3) Un utente senza profilo usa Payroll con l'inserimento a mano. 4) Un utente senza calendario festivo vede solo i fine settimana e un avviso. 5) Mattia: stessi residui, stesse buste paga, stessi KPI; la sync con Trek funziona come prima. 6) Export e cancellazione dell'utente derivano dai tipi registrati |
| OK di Mattia | Sì, sul SHA di ogni PR. ST-7 è la decisione H20. ST-20, ST-21, ST-22: decisioni del 14/11/2026, con il default |
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
