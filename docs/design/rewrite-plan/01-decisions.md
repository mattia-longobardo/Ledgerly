# 1. Registro delle decisioni

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md).

Tutte le decisioni sono di Mattia: del **13/11/2026**, salvo §1.0 che è del **14/11/2026**. Dove §1.0 e una decisione
più vecchia dicono cose diverse, vale §1.0. Le decisioni H12-H20 (standardizzazione) sono di Mattia; rilasci e default
che le applicano sono una revisione **in attesa del suo OK** ([`11-standardization.md`](11-standardization.md)). Le
righe di questo registro che la revisione riscrive hanno il segno «(rev.)». La colonna «Sostituisce» cita i documenti esistenti,
che non vengono modificati: dove questo registro e un documento più vecchio dicono cose diverse, vale questo registro.
La colonna «Rilascio» rimanda a [`03-releases.md`](03-releases.md).

## 1.0 Obiettivo, priorità e decisioni del 14/11/2026

Dettaglio, regole e controlli: [`10-modularity.md`](10-modularity.md).

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H1 | **Obiettivo del refactor:** ottimizzazione del codice, intesa soprattutto come qualità della sua organizzazione. Non un refactor generico. Priorità in ordine: **1. Modularità** (moduli con responsabilità singole e ben definite, interfacce chiare, basso accoppiamento, nessuna duplicazione); **2. Pulizia e chiarezza** (codice leggibile, nomi espliciti, struttura coerente, niente codice morto o complessità superflua); **3. Prestazioni** (esecuzione più veloce, solo dopo i due punti precedenti) | Precisa F1b: la modularità è l'obiettivo, non un effetto del refactor | R0-R4 |
| H2 | **Regola di conflitto:** vince la priorità più alta. Non si sacrifica modularità o leggibilità per la velocità, a meno che il guadagno sia significativo. In quel caso va segnalato in modo esplicito a Mattia, che decide, prima del commit | — | R0-R4 |
| H3 | **Il comportamento funzionale del codice resta invariato.** Prova: test esistenti verdi senza asserzioni adattate, test «stessi numeri», e2e | Rafforza F1b e la premessa 6 del piano | R0-R4 |
| H4 | Il difetto BUD-1 («lo stop di un budget per conto scrive una riga senza conto») si corregge subito come `fix`, in una sotto-issue separata, fuori dai rilasci del piano. Non tocca le righe già scritte. Gli altri due difetti dell'audit (ACC-2, FND-2) restano nel passo R2 del loro modulo | L'ipotesi I13 | Subito (BUD-1); R2 (ACC-2, FND-2) |
| H5 | Per i numeri calcolati in due modi (D1-D11) vale il default del piano: il numero che l'utente vede nelle pagine. Da ipotesi diventano decisioni | Le ipotesi D1-D11 | R2 |
| H6 | **Nessuna review del codice fino alla fine, in nessun rilascio.** Niente review incrociata tra i due sviluppatori e nessun revisore intermedio. Gate di ogni rilascio: test, controlli automatici, verifica dell'orchestratore. Alla fine: una review finale unica | L'ipotesi I7; il gate G7 «Review del codice»; `08-agents.md` §8.5 nella versione del 13/11. Estende P4 al codice | Tutti; Z |
| H7 | **Il piano è approvato** (OK di Mattia del 14/11/2026). Le ipotesi da confermare I1-I6, I8-I12, I14 e I19 di [`09-risks.md`](09-risks.md) §9.3 sono decisioni, con il default del piano. I7 e I13 erano già decisioni (H6, H4) | Lo stato «ipotesi da confermare» di `09-risks.md` §9.3; chiude P5 | Tutti |
| H8 | **Soglie di pulizia e di duplicazione** (I15), confermate in modo esplicito: file 400 righe, funzione 60 righe, 4 parametri, complessità ciclomatica 12, annidamento 4; righe duplicate al massimo 3% per pacchetto a fine R3 | L'ipotesi I15 | R0, R3 |
| H9 | **Guadagno di velocità «significativo»** (I16), confermato in modo esplicito: almeno il 30% del tempo di una vista o di una rotta, o almeno 200 ms sul 95° percentile di una pagina. Sotto la soglia la modifica non si fa. Obiettivi assoluti: una proposta dopo le misure di N0; fino ad allora vale «non peggiora di oltre il 10%» | L'ipotesi I16 | N0, R0-R4 |
| H10 | **Review finale unica in due parti** (I17), confermata in modo esplicito: un solo passo Z con il codice (un agente di review scelto dall'orchestratore) e la sicurezza (Security Reviewer) | L'ipotesi I17 | Z |
| H11 | **Nessun pacchetto nuovo per le misure** (I18), confermato in modo esplicito: duplicati, codice morto, complessità e cicli si misurano con script propri sullo scanner di `typescript`, regole del nucleo di ESLint e `architecture.test.ts` esteso. Strumenti di terzi solo come alternativa, dopo il gate del Security Gatekeeper | L'ipotesi I18 | N0, R0 |

### Standardizzazione (seconda decisione del 14/11/2026)

Mattia ha riguardato la pagina Funds: per aggiungere un fondo come Cometa o Fideuram serve una pagina su misura.
Dettaglio, modelli e rilasci: [`11-standardization.md`](11-standardization.md). Punti di estensione comuni:
[`10-modularity.md`](10-modularity.md) §10.11.

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H12 | **Fondo pensione unico.** Cometa e Fideuram sono tutti e due fondi pensione. Il tipo «PAC» sparisce da Funds: un solo modello, un solo motore, una sola serie di schermate | B1 per il numero e i nomi dei gruppi della home; la riga «Nessuna migrazione dei dati dei fondi, in nessun rilascio» di `06-data.md` §6.1 e di `05-refactor.md` §5.5; `funds-ux.md` per la sola distinzione tra i due tipi (KPI, periodo e direzione A restano) | N6 |
| H13 | **Un PAC è un acquisto periodico di strumenti finanziari.** È una funzione del Portafoglio manuale: «Piano di acquisto» | La regola «un PAC resta un fondo con il suo piano» (proposte tecniche della fase 1, §4.4). Estende B3 | R5d, secondo passo |
| H14 | Un fondo pensione può essere legato al **TFR** oppure a un **contributo volontario**: sorgenti di contributo configurabili | Il legame fisso «un fondo riceve la busta paga»; il piano mensile fisso del PAC | N6 |
| H15 | Le **commissioni sono generiche e impostabili**: una lista per fondo | Le 4 colonne di commissione e il tariffario per gestore nel codice | N6 |
| H16 | **Regola generale:** nessuna funzione richiede codice o una pagina su misura per un fornitore, una banca, un fondo o un datore di lavoro. Aggiungere un fondo nuovo non richiede una pagina custom | Estende C4, F6 e H1 (modularità): vale anche per lettori di documenti, tipi di assenza, regole per paese, descrittori dei fornitori | N1, N2, N5, N6, R0-R3, R5 |
| H17 | Il piano comprende, oltre ai miglioramenti già segnati, **tutte le altre ottimizzazioni utili all'obiettivo**, nell'ordine di H1: modularità, poi pulizia, poi prestazioni | Estende l'audit: 28 voci nuove ([`02-audit.md`](02-audit.md) §2.6) | Il rilascio di ogni voce |

Effetto di H12-H17 su H3 («comportamento invariato»): N6 e R5g sono cambi voluti, con i loro criteri di accettazione.
Le sole differenze di numeri in più sono X1-X3 ([`11-standardization.md`](11-standardization.md) §11.2.5).

### Standardizzazione: risposte alle ipotesi (terza decisione del 14/11/2026)

Mattia ha risposto alle ipotesi ST-1…ST-24 con le sole eccezioni. Le tre eccezioni sono decisioni:

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H18 | **Il «Deducibile» si toglie.** Nessun riquadro e nessun calcolo del limite di deducibilità, per nessun fondo (anche Cometa). Il limite fiscale non è un dato del paese | L'ipotesi ST-4; la prima forma di X1 («Deducibile» con Fideuram); il limite nel pacchetto paese (E4); `funds-ux.md` §5.3 per il «Deducibile» | N6 |
| H19 | **Documenti.** Il lettore della busta paga resta nel core, dietro il registro E1. Il lettore dei documenti di Cometa si toglie, e si toglie la funzione: nei fondi non si caricano documenti. Contributi e valori dei fondi arrivano solo dalle sorgenti (busta paga, addebito in banca) e dall'inserimento a mano. Le operazioni e i valori già letti restano dati del fondo | Le ipotesi ST-6 e ST-19; il tipo `fund_statement`, `funds.statement_reader` e il tab «Documenti» della prima forma di questa revisione | N6 (codice); R5f (file e schema: ipotesi ST-25); R5g (profili delle buste paga) |
| H20 | **La malattia non è un tipo di assenza di Time Off e non viene contata.** Tipi predefiniti del paese `IT`: Ferie e ROL/Permessi. I tipi restano dati dell'utente | L'ipotesi ST-7 | N5 (ipotesi ST-27), R5g |

Per le altre ipotesi ST-1…ST-24 vale il default del piano: restano in [`09-risks.md`](09-risks.md) §9.6 con la nota
«default confermato da Mattia il 14/11/2026 (risposta con le sole eccezioni)». Le risposte fanno nascere tre ipotesi
nuove, da confermare: ST-25, ST-26, ST-27 (stessa sezione). Cosa si toglie nel codice e nei dati:
[`11-standardization.md`](11-standardization.md) §11.2.6.

## 1.1 Premesse

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| P1 | Ogni host gestisce la sua istanza e aggiunge amici e familiari con il loro account | — | Tutti |
| P2 | Utenti non tecnici: impostazioni tecniche nascoste o sotto «Avanzate» | — | N2, R5a |
| P3 | L'istanza è pubblica su internet (tunnel Cloudflare → Traefik). Le app la raggiungono direttamente | — | R2, C1 |
| P4 | Una sola review di sicurezza, finale, quando Mattia dichiara tutto completo (con H6: è la review finale unica, codice e sicurezza) | `investments.md` §7 e §9 (review per fase) come modello per i rilasci nuovi | Z |
| P5 | Nessuno sviluppo prima dell'OK di Mattia al piano | — | N0 |

## 1.2 Prodotto (fase 1)

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| A3 | Ordine Z: prima, sul codice attuale, le sorgenti dati e Time Off. Il resto nella riscrittura | — | N1-N5, poi R0-R5 |
| B1 (rev.) | Investments: una home con **2 gruppi**: «Azioni e crypto» e «Fondi pensione». I nomi sono un'ipotesi da confermare (ST-2). I conti con solo valore stanno nel primo gruppo. Fusione di modello di lettura e interfaccia. I dati dei fondi sono già nel modello unico da N6 (H12). Versione del 13/11/2026, sostituita: 3 gruppi («Azioni e crypto», gruppo dei fondi e dei piani di accumulo, «Pensione»), senza migrazione dei dati dei fondi | `investments-ux.md` §9 decisione 4 («totale solo servizi») e i suoi effetti in §3.1 e §8; `investments-ux.md` §1.1 (mappa delle pagine); `funds-ux.md` §6 direzione A e §10 solo per la home (il dettaglio del fondo resta) | R5b |
| B1b | I fondi passano a `/investments/[id]`; `/funds/*` risponde con un redirect permanente. La voce di menu «Funds» sparisce | `funds-ux.md` §10-§13 per gli URL | R5b |
| B1c | Niente «coming soon» e niente catalogo: dialog «Aggiungi investimento» a 3 scelte. (rev.) Nomi delle scelte: «Collega un servizio», «Segui i tuoi titoli a mano», «Fondo pensione» (ipotesi ST-3) | `investments.md` §1.1 (D5 per le voci `planned`, D12 catalogo statico), §4.2; `investments-ux.md` §3.7 | R5b |
| B2 | La pensione entra nel totale. Tutti i conti di investimento sono visibili in Investments, anche senza sync | `investments-ux.md` §9 decisione 4; `investments.md` §4.1 | R5b |
| B3 | Tracking manuale: servizio «Portafoglio manuale», modulo unico «Registra operazione» con ricerca per ISIN. (rev.) Esteso da H13: «Piano di acquisto» come secondo passo di R5d | `investments.md` §4.4 (inserimento manuale degli asset); estende §2.6 (conto manuale, solo valore): il servizio nuovo è separato | R5d |
| B4 | Fonti: OpenFIGI + ESMA FIRDS per l'anagrafica; EODHD, BCE, CoinGecko per i prezzi; altre fonti solo come plugin | `investments.md` §6 e D9 (prezzi solo con copertura ≥ 90% del valore): la regola diventa «per strumento» | R5d |
| S3 | Mercato del prezzo: quello dell'ordine, Xetra di riserva | `investments.md` §6 | R5d |
| C1 | Sorgenti bancarie: di default nessuna sync. Enable Banking, Wallet e Trek sono plugin e possono stare insieme | `investments.md` §3.1 solo per l'elenco chiuso dei provider | N1, R5c |
| C1b | eToro e Binance restano nel core. Le loro impostazioni stanno nel tab Finance | `investments.md` §4.2 (servizi elencati anche in Integrations) | R5a |
| C1c | Enable Banking: credenziali **per utente**. Ogni utente registra la sua applicazione. Il core le cifra; il plugin non le salva | — | N1 |
| C1d | La prima sync parte subito dopo il consenso (storico oltre 90 giorni). Letture automatiche entro il limite della banca. «Sincronizza ora» manda gli header `Psu-*` | — | N1 |
| S4 | La prova su una banca vera è il primo passo dello sviluppo del plugin | — | N1 |
| C2 | Passaggio di un conto da Wallet a Enable Banking: scelta dell'utente, regola M1 | — | N4 |
| S1 | M1 corretta dallo spike: abbinamento per gruppi (conto + importo), controllo del saldo bloccante, prova a secco | — | N4 |
| C4 | Plugin: container separato senza stato, interrogato dal core. Installa solo l'admin. Catalogo ufficiale. Plugin fuori catalogo: solo admin, etichetta «non verificato» | — | N1, R5c |
| C4b | Wallet in sola lettura. Trek tiene la scrittura delle ferie | — | R5c |
| K1 | Categorizzazione: cascata (regole → memoria esatta → classificatore lineare per utente → tabelle MCC e marchi → «Da categorizzare») | — | N3 |
| S2 | Memoria severa: «ultime 3 tutte uguali». La copertura si misura a regime | — | N3 |
| K2 | Assegna da sola sopra la soglia di precisione 95%, con segno «automatica». Le automatiche contano subito in budget | — | N3 |
| K3 | Dopo una correzione l'app chiede se applicare ai simili | — | N3 |
| S2b | L'app propone di unire le categorie doppie | — | N3 |
| K4 | Utente nuovo: circa 12 gruppi predefiniti e revisione guidata | — | N3 (tabelle e revisione), R5a (primo avvio) |
| G10 | Movimento manuale disponibile, anche su un conto collegato a una banca, con avviso | — | N3 |
| C5 | Sync log: stato semplice per collegamento. Registro grezzo solo per l'admin, 30 giorni | — | N2 |
| D1 | Time Off: selezione di primo e ultimo giorno + pannello (tipo, durata), pulsante «Aggiungi assenza». Nessun gesto nascosto | — | N5 |
| D2 | Menu a 3 gruppi («Ogni giorno», «Risparmi e investimenti», «Lavoro»), moduli attivabili, primo avvio guidato | — | R5a |
| D2d | Tab mobile: Overview · Accounts · Expenses · Investments · More | — | R5a |
| D3 | Settings: tab Finance e tab Plugin. Integrations e Categories spariscono | `investments.md` §4.2 | R5a |
| O1 | Overview: lista dei conti a gruppi, subtotale = riquadro. Mostra anche i conti di investimento. (rev.) Il gruppo degli investimenti ha i 2 sottogruppi di B1 | — | R5b |

## 1.3 Architettura (fase 2)

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| F1 | Backend separato in TypeScript: Hono + Drizzle. Il web usa solo l'API | — | R2-R4 |
| F1b | **Refactor completo**: audit dei doppioni e del debito per modulo; refactor esplicito modulo per modulo (dominio e interfaccia). Criterio di uscita nell'ordine delle priorità di H1 ([`05-refactor.md`](05-refactor.md) §5.1): modularità, pulizia, prestazioni, comportamento invariato. I calcoli approvati non cambiano risultato | `investments-ux.md` §4 e `funds-ux.md` §5 restano le regole di calcolo | R0, R2, R3 |
| F2 | Monorepo npm workspaces: `apps/` (api, worker, web), `packages/` (domain, api-contract, api-client, design-tokens, ui, plugin-contract, plugin-host), `plugins/`. Repo privato, nessun repo nuovo | — | R0 |
| F3 | Stesso PostgreSQL e stesso schema. Migrazioni solo additive, compatibili con l'immagine precedente | — | Tutti |
| F3b | Client: cache di sola lettura. Chiave di idempotenza sulle scritture | — | R2, C1 |
| F4 | Login nativo: OAuth2 + PKCE nel browser di sistema. L'app chiede l'indirizzo dell'istanza al primo avvio, anche con QR dal web | — | R2, C1 |
| F5 | Worker dedicato con coda su PostgreSQL. Il container cron sparisce | `investments.md` D15 resta valida: ccxt resta nel codice del core | R1 |
| F5b | `/api/v1` cresce solo in modo additivo. MCP in sola lettura | — | R2 |
| F6 | Runtime minimo dei plugin subito, con Enable Banking come primo plugin. Wallet e Trek diventano plugin nella riscrittura | — | N1, R5c |
| F7 | Migrazione progressiva: R0 monorepo → R1 worker → R2 API completa → R3 web sull'API → R4 container separati → R5 prodotto nuovo. Ogni rilascio ha rollback: immagine `pre-*` + dump | `investments-ux.md` §10 (ramo di integrazione e rilascio unico) non è il modello dei rilasci nuovi | R0-R5 |
| F9 | Dump dei rilasci in una cartella sotto `/home/mattia/docker/projects/`, fuori dal repo git | Il percorso `../../backups/ledgerly/` citato nei documenti `investments-phase-*.md` e `investments-ux-*.md` | N0 |
| F8 | Due filoni (server, client) da R2. Un secondo agente di sviluppo nasce quando parte il filone client e si elimina a fine sviluppo. Secondo database di test | — | R2 |

## 1.4 App (fase 3)

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| G1 | Una sola interfaccia web React solo client, in pacchetti condivisi, dentro involucri nativi: Capacitor su Android, Tauri 2 su Windows (alternativa Electron) | — | R3, C1, C4 |
| G1b | Vincolo fissato prima di R3: niente Server Components e niente Server Actions nelle schermate | — | R3 |
| G2 | Android «compagno»: consultazione completa, azioni rapide, conferme. Revisione delle buste paga, chiavi, import e admin restano sul web | — | C1, C2 |
| G3 | Windows: guscio con la stessa interfaccia, dopo Android | — | C4 |
| G6 | **Nessuna distribuzione per ora.** Nessun canale pubblico e nessun account sviluppatore. Android: APK installato a mano. Windows: build locale. La distribuzione è una fase futura, fuori dal piano | — | C1, C4 |
| G4 | Notifiche con controllo periodico, senza servizi di terzi. Testo senza importi, banca o conto | — | R5e, C2 |
| G5 | Sblocco con biometria. Cache cifrata (90 giorni di movimenti). «Nascondi importi» su tutti i client. Widget in una seconda versione | — | C1, C2, C3, R5e |
| G7 | L'API accetta le chiamate dagli involucri: CORS, solo `Bearer`, origini fisse | — | R2 |
| G7b | `GET /api/v1/meta` con livello API e capacità | — | R2 |
| G9 | Prove tecniche degli involucri: passo zero del filone client. Ogni strumento o pacchetto di terzi nuovo (Android SDK, Capacitor, Tauri) passa prima dal Security Gatekeeper | — | C0 |

## 1.5 Decisioni più vecchie che restano valide

| Decisione | Documento | Nota |
|---|---|---|
| Regole di calcolo del P&L: Modified Dietz, XIRR nel tooltip, costo medio ponderato, taglio a 12 mesi | `investments-ux.md` §4 | Non cambiano risultato (F1b) |
| Fondi: direzione A nel dettaglio, lettura del 1° gennaio, soglia di 31 giorni, proiezione | `funds-ux.md` §9 | Restano nel dettaglio del fondo. Valgono per ogni fondo pensione (H12) |
| Un solo scrittore per conto (`portfolio`) | `investments.md` §2.3, D3 | Vincolo di B1 e B3 |
| Conto manuale: solo «Aggiorna valore» | `investments.md` §2.6 | Resta. Il Portafoglio manuale è un servizio diverso (B3) |
| Regole sui segreti: mai in log, API, MCP, export | `investments.md` §5.1 | Estese a plugin, Wallet e Trek |
| Chiavi in sola lettura, controllo all'inserimento | `investments.md` §5.2 | Restano. Eccezione dichiarata: Trek (`provider.write`) |
| Controllo di pianificazione a 4 modalità | `docs/scheduler.md` | Resta, chiuso sotto «Avanzate» |

## 1.6 Decisioni minori applicate con il default degli allegati

Mattia ha approvato «il resto va bene»: valgono i default dei documenti di brainstorming. I più rilevanti per il piano:

| Tema | Default applicato |
|---|---|
| Preavviso del rinnovo della banca | 14 e 3 giorni, in app e per email |
| Letture automatiche Enable Banking | 3 al giorno, più «Sincronizza ora» |
| Movimenti in sospeso | Esclusi: solo contabilizzati (`BOOK`) |
| Interessi pubblicati su Wallet | Finiscono per i conti passati a Enable Banking; l'accredito arriva dalla banca. (rev.) Con R5c finiscono per tutti i conti: ipotesi ST-14 |
| Modello di categorizzazione | Salvato in PostgreSQL per utente; fuori da export, API e MCP; si ricostruisce |
| Offline | Nessuna scrittura senza rete. Unica eccezione: un file condiviso in coda (Android) |
| Compatibilità app-istanza | L'app sostiene i livelli API degli ultimi 6 mesi |
| Layout | Tre classi di larghezza: < 600 px, 600-1023 px, ≥ 1024 px |
| Tabelle su schermo piccolo | Scheda per riga sotto 600 px, colonne per priorità fino a 1023 px |
| Widget | «Da fare» e «Questo mese», importi nascosti di default. Nessun widget del patrimonio |
| Windows | Area di notifica e avvio automatico facoltativi, spenti di default |
| iOS | Fuori dal piano |
