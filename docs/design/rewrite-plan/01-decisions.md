# 1. Registro delle decisioni

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md).

Tutte le decisioni sono di Mattia: del **13/11/2026**, salvo §1.0 che è del **14/11/2026**, del **15/11/2026**
(H31-H38), del **16/11/2026** (H39-H53) e del **17/11/2026** (H54). Dove §1.0 e una decisione più vecchia dicono cose diverse, vale §1.0. Le decisioni H12-H20 (standardizzazione) sono di Mattia; rilasci e default
che le applicano sono una revisione **approvata da Mattia il 14/11/2026**
([`11-standardization.md`](11-standardization.md), decisione H21). Le
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
| H19 | **Documenti.** Il lettore della busta paga resta nel core, dietro il registro E1. Il lettore dei documenti di Cometa si toglie, e si toglie la funzione: nei fondi non si caricano documenti. Contributi e valori dei fondi arrivano solo dalle sorgenti (busta paga, addebito in banca) e dall'inserimento a mano. Le operazioni e i valori già letti restano dati del fondo | Le ipotesi ST-6 e ST-19; il tipo `fund_statement`, `funds.statement_reader` e il tab «Documenti» della prima forma di questa revisione | N6 (codice; file e righe `documents`: decisione ST-25, H24); R5f (schema); R5g (profili delle buste paga) |
| H20 | **La malattia non è un tipo di assenza di Time Off e non viene contata.** Tipi predefiniti del paese `IT`: Ferie e ROL/Permessi. I tipi restano dati dell'utente | L'ipotesi ST-7 | N5 (decisione ST-27), R5g |

Le altre ipotesi ST-1…ST-24 sono decisioni di Mattia del 14/11/2026, con il default del piano: il testo di ogni
decisione è la sua riga in [`09-risks.md`](09-risks.md) §9.6. Le risposte hanno fatto nascere tre ipotesi nuove:
ST-25, ST-26, ST-27 (stessa sezione), ora decisioni H22-H24. Cosa si toglie nel codice e nei dati:
[`11-standardization.md`](11-standardization.md) §11.2.6.

### Standardizzazione: approvazione della revisione (quarta decisione del 14/11/2026)

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H21 | **La revisione sulla standardizzazione è approvata** (OK di Mattia del 14/11/2026). Le ipotesi ST-1…ST-24, salvo ST-4, ST-6, ST-7 e ST-19, sono decisioni, con il default del piano | Lo stato «in attesa dell'OK» della revisione; la nota «default confermato» | N1, N2, N5, N6, R5d, R5g |
| H22 | **ST-26, con il default.** `POST /imports`: i valori `cometa_operations` e `cometa_position` restano nel contratto. Da N6 la rotta li rifiuta con un errore dichiarato e non salva il file. Escono dal contratto con R5f | L'ipotesi ST-26 | N6, R5f |
| H23 | **ST-27, con il default.** Il tipo `sick` esce da Time Off in N5: il pannello nuovo non lo offre. In R5g non diventa un tipo. Il valore esce dal check in R5f | L'ipotesi ST-27 | N5, R5g, R5f |

### Standardizzazione: file dei documenti di Cometa (quinta decisione del 14/11/2026)

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H24 | **ST-25: cancellazione in N6.** I file dei documenti di Cometa già salvati e le loro righe `documents` si cancellano nel rilascio N6. Le operazioni e i valori già letti restano dati del fondo. Prima: dump del database e copia dei file in `projects/Ledgerly-dumps/`, con una prova di ripristino. La cancellazione è un passo separato di N6, dopo la prova SN7, con l'OK di Mattia sul SHA (`git-policy` §6 #1 e #2). Rollback: ripristino dalla copia | L'ipotesi ST-25 e il suo default (archiviati fino a R5f); l'alternativa «nessuna cancellazione» | N6 |

Dettaglio del passo: [`11-standardization.md`](11-standardization.md) §11.2.4, passo A4.

### Plugin attivati per utente e schermate di N1 (sesta decisione del 14/11/2026)

Risposte di Mattia alle 7 domande della specifica UX di N1 ([`ux/n1-plugin-bank.md`](ux/n1-plugin-bank.md) §12) e ai
punti nati da H25 (§14 e §15 della stessa specifica).

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H25 | **I plugin si attivano per utente. L'admin non fa niente.** I plugin sono già disponibili nell'istanza, non attivi: il container del plugin fa parte dell'installazione standard e non esiste un passo dell'admin nell'interfaccia. Ogni utente attiva per sé i plugin che vuole e gestisce i suoi, come fa oggi con Trek. Dopo la disattivazione la sezione del plugin sparisce e le letture di quell'utente si fermano; conti e movimenti restano e tornano aggiornati alla riattivazione. | N1: «L'admin attiva il plugin» e «tab Plugin essenziale (admin)»; `04-now.md` §4.1 «Installazione: solo l'admin … registra l'indirizzo nel tab Plugin». C4 «Installa solo l'admin», per l'interfaccia di N1. Per R5a, R5c e N2: H27-H30 | N1 |
| H26 | **Schermate di N1, con i default della specifica.** «Scollega» e «Rimuovi credenziali» sono in N1; la rimozione solo senza banche collegate. «Non importare» esiste per un conto esposto dalla banca. I saldi inseriti a mano restano; dalla prima data letta vale la banca. Un solo ingresso alla procedura, in Settings › Integrations. Un'applicazione Enable Banking che permette i pagamenti si rifiuta. La sezione «Banche» sta in Settings › Integrations fino a R5a. | Le domande Q2-Q7 della specifica | N1 |
| H27 | **I plugin del catalogo ufficiale fanno parte dell'installazione standard.** Arrivano e si aggiornano con l'istanza. Il tab Plugin è di ogni utente: elenco, «Attiva», «Disattiva». Nessun «installa, aggiorna, rimuovi» nell'interfaccia, per nessun ruolo. | C4 «Installa solo l'admin»; R5c «Tab Plugin completo: installa, attiva, aggiorna, rimuovi»; `07-apps.md` «installazione dei plugin» tra le funzioni dell'admin | R5a, R5c |
| H28 | **Nessun plugin fuori catalogo.** Esistono solo i plugin del catalogo ufficiale | C4 «Plugin fuori catalogo: solo admin, etichetta "non verificato"» | R5c |
| H29 | **Il registro grezzo è per utente.** Ogni utente vede il registro grezzo dei suoi collegamenti, sotto «Avanzate». L'admin non vede il registro degli altri utenti: in Server › Diagnostica vede solo lo stato dei plugin | C5 «Registro grezzo solo per l'admin»; N2, criterio 2 | N2 |
| H30 | **Disattivazione e passaggio, con i default.** **(H55, 18/11/2026: la regola sulla disattivazione e lo stato «In pausa» sono sostituiti; resta l'ultima frase su R5c.)** Alla disattivazione le credenziali e l'accesso alle banche restano cifrati nel core. In N1 nessuna schermata mostra lo stato del plugin a chi gestisce l'istanza. In N2 il collegamento di un plugin disattivato è «In pausa», con l'azione «Attiva», senza avvisi di ritardo o di scadenza. In R5c i plugin Wallet e Trek sono attivi da subito per chi ha già un collegamento e non attivi per gli altri. | — | N1, N2, R5c |

### Stato dei collegamenti, modalità dei conti e categorie delle sorgenti (decisione del 15/11/2026)

Risposte di Mattia alle 5 domande della specifica UX di N2 ([`ux/n2-connection-status.md`](ux/n2-connection-status.md) §14)
e alle 9 domande e ai 3 punti della specifica UX di N3 ([`ux/n3-categories-manual.md`](ux/n3-categories-manual.md) §17).
Due risposte sono regole nuove (H32-H34). H36-H38 sono le risposte alle tre domande nate dal controllo del piano
(D1-D3). Concetto ed effetti sugli altri rilasci: [`12-account-modes.md`](12-account-modes.md).

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H31 | **N2, con i default della specifica (Q1-Q5).** Q1: un avviso arriva per mail e come stato sulla riga del collegamento; nessun avviso in Overview. Q2: il limite di letture della banca non conta nei «3 fallimenti»: la riga dice «In ritardo», senza mail. Q3: lo stato del collegamento si vede anche nel dettaglio del conto; gli elenchi di Accounts e Investments restano come oggi fino a R3. Q4: un plugin che non risponde non manda un avviso all'admin: lo stato è solo in Server › Diagnostica. Q5: «Riattiva» su un collegamento «In pausa» applica la pianificazione consigliata del fornitore, con un clic | Le domande Q1-Q5 della specifica. Precisa C5 e H30 | N2 |
| H32 | **Tre modalità di conto.** Ogni conto con movimenti ha una modalità: **«a mano»** (nessuna sorgente, nessun aggiornamento); **«lettura e scrittura»** (la sorgente legge i movimenti e riceve quelli scritti in Ledgerly); **«sola lettura»** (la sorgente legge soltanto). La modalità deriva dalla sorgente del conto e dalle capacità che la sorgente dichiara: nessun nome di fornitore nella regola o nel codice (H16). Oggi: un conto senza collegamento è «a mano», un conto Wallet è «lettura e scrittura», un conto Enable Banking è «sola lettura». I conti di investimento non hanno una modalità | C4b «Wallet in sola lettura»: la sorgente Wallet è «lettura e scrittura», anche come plugin in R5c. Il vincolo «chiavi dei provider in sola lettura» (§1.5; premessa 5 dell'indice): le sorgenti «lettura e scrittura» sono un'eccezione dichiarata, come Trek | N3 (regola e conti «a mano» e «sola lettura»), N3.1 (invio alla sorgente, H36), R5c |
| H33 | **Un movimento a mano cambia il saldo del conto, su ogni conto con una modalità.** Il cambio si vede subito in Accounts, Overview e nel patrimonio. Diventa effettivo all'aggiornamento successivo: su un conto «a mano» è definitivo subito; su un conto «lettura e scrittura» Ledgerly scrive il movimento sulla sorgente all'aggiornamento successivo e da lì il movimento è della sorgente; su un conto «sola lettura» alla lettura successiva vale il saldo della sorgente e il movimento resta, a mano, in Expenses e nei budget (H35, punto 10) | Estende G10: da «anche su un conto collegato a una banca» a «su ogni conto, secondo la modalità». La regola «un movimento manuale non ha un link esterno» e l'assenza di una regola sul saldo in `04-now.md` §4.5. La domanda 2 della specifica («non i conti Wallet») e le opzioni A e B della domanda 3. Il criterio 6 di N3 «fotografia dei numeri invariata»: vale al rilascio, non dopo un movimento a mano | N3; N3.1 per i conti «lettura e scrittura» (H36) |
| H34 | **Categorie di una sorgente che le dà già.** Per ogni categoria della sorgente la persona sceglie: **associare** la categoria a una categoria di Ledgerly, oppure **aggiungerla** come categoria nuova. Le due scelte possono stare insieme. I movimenti che arrivano da quella sorgente non si ricategorizzano: tengono la categoria della sorgente e contano nella categoria di Ledgerly che le corrisponde. Una correzione a mano su un singolo movimento resta possibile | Il criterio 1 di N3 e `04-now.md` §4.4 «Dove gira» («sui conti Wallet restano le categorie di Wallet»). Le opzioni A e B della domanda 6 della specifica. Precisa S2b: l'unione vale tra categorie di Ledgerly; per le categorie di una sorgente vale l'associazione | N3 (nessuna ricategorizzazione), N3.1 (associazione, H36), R5c |
| H35 | **N3, le altre risposte, con i default della specifica.** 1: i movimenti senza categoria di una sorgente che dà le categorie non entrano in «Da rivedere». 4: il movimento a mano ha il campo «Beneficiario», facoltativo. 5: i 12 gruppi predefiniti della specifica (§7.2). 7: nell'unione di due categorie con un budget i limiti si sommano. 8: «Annulla» dopo un'azione di gruppo. 9: le categorie automatiche non compaiono in «Da rivedere». 10: su un conto «sola lettura», dopo la lettura successiva vale il saldo della sorgente. 11: una categoria nuova della sorgente entra da sola come «aggiunta», con il segno «Nuova»; nessuna lettura si ferma. 12: un movimento a mano con una data prima dell'ultimo saldo scritto del conto non cambia il saldo di oggi | Le domande 1, 4, 5, 7, 8, 9 e i punti 10, 11, 12 della specifica. La domanda 2 è sostituita da H33 | N3 |
| H36 | **D1, opzione B: N3 più il rilascio N3.1.** N3 = categorie automatiche e movimento a mano con il saldo, sui conti «a mano» e «sola lettura». **N3.1** = invio dei movimenti a mano alla sorgente di un conto «lettura e scrittura» e associazione delle categorie di una sorgente che le dà già. Tra N3 e N3.1 il dialogo del movimento a mano non offre i conti «lettura e scrittura» e le categorie di quella sorgente restano come oggi. Ordine: N3 → N3.1 → N4; N4 dipende solo da N3 e può andare prima di N3.1 per scelta di Mattia | L'opzione A («tutto in N3»). La riga N3 del 13/11/2026 come unico rilascio di categorie e movimento a mano | N3, N3.1 |
| H37 | **D2, con il default: ST-14 resta.** Da R5c Ledgerly non pubblica più gli interessi su Wallet, per nessun conto. L'accredito arriva dalla banca o si scrive a mano. Il plugin Wallet non dichiara `ledgerPosting` | Il motivo di ST-14 «Wallet in sola lettura» (non vale più con H32): la decisione resta, con questa conferma. L'alternativa «resta come capacità del plugin» | R5c |
| H38 | **D3, con il default.** Il passaggio di un conto da «lettura e scrittura» a un'altra sorgente (N4) aggiorna prima la sorgente di partenza e invia i movimenti a mano non ancora inviati. Se un movimento resta non inviato, la prova a secco lo elenca e il passaggio si ferma finché la persona lo invia o lo elimina | L'alternativa «il passaggio parte e il movimento resta a mano sul conto» | N4 |

### Passaggio di un conto e IBAN sul conto (decisione del 16/11/2026)

Risposte di Mattia alle 6 domande della specifica UX di N4 ([`ux/n4-account-switch.md`](ux/n4-account-switch.md) §17).
H39 è una regola nuova: vale per ogni conto e per ogni sorgente, non solo per il passaggio. H40 cambia numeri
esistenti: è un'eccezione dichiarata a «comportamento invariato», e questa riga è la decisione scritta. Righe del
piano, eccezioni ed effetti sugli altri rilasci: [`03-releases.md`](03-releases.md) «N4». H45-H47 sono le risposte
ai tre punti nati dal controllo del piano (P1-P3 di N4): Mattia ha scelto il default per tutti e tre.

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H39 | **Q1, regola nuova: un conto già aggiunto non si aggiunge una seconda volta. Ogni conto può avere un IBAN.** Parole di Mattia: «sia da Wallet che da Enable puoi estrarre un IBAN. Se esiste già non metterlo, dai un avviso; aggiungi anche la possibilità di aggiungere un IBAN ai conti». Regola: 1) il conto ha un campo IBAN, facoltativo: lo riempie la sorgente quando lo dà, oppure lo scrive la persona; 2) un IBAN, un conto: due conti non archiviati dello stesso utente non hanno lo stesso IBAN; 3) la procedura di collegamento di una sorgente e gli aggiornamenti automatici non creano un conto con un IBAN già presente: mostrano un avviso con il nome del conto che ha quell'IBAN; 4) un conto a mano, o un IBAN scritto a mano, con un IBAN già presente è rifiutato. La regola non contiene nomi di fornitore (H16). Nessuna unione di due conti in N4 (cambiata da H54 per i conti della banca già importati) | Le opzioni A («il conto resta non selezionabile, due conti restano») e B («il passaggio unisce i due conti») della domanda Q1. La guardia «stessa valuta e stesso saldo» della prima revisione della specifica. N4 «Migrazioni: nessuna di schema» e la stessa riga di `06-data.md` §6.1. Per N1: «Crea un conto nuovo» sempre disponibile per un conto della banca (`ux/n1-plugin-bank.md` §6.4). Per ogni sorgente: l'aggiornamento che crea da solo ogni conto nuovo | N4 |
| H40 | **Q2, opzione B: giroconti su tutto lo storico.** I movimenti tra il conto passato e gli altri conti della stessa banca si riconoscono come giroconti su tutto lo storico, non solo dal periodo del confronto. La prova elenca ogni coppia prima di «Applica». «Annulla passaggio» riporta ogni coppia com'era: un'entrata e un'uscita, con la categoria di prima. Dopo un passaggio reale entrate e uscite dei mesi passati scendono; patrimonio e saldi non cambiano | L'opzione A («dal periodo del confronto in poi»). Per i conti di un passaggio: la regola di oggi, che riconosce un giroconto solo dal riferimento della controparte dato dalla sorgente o dall'IBAN nel testo del movimento. Per N4: H3 e la regola della fase A «nessun numero esistente cambia senza una decisione scritta» hanno questa eccezione. Precisa il criterio 5 di N4 | N4 |
| H41 | **Q3, con il default (A).** Dopo «Annulla passaggio» i movimenti arrivati dalla banca dopo il passaggio non contano e non si vedono. Nessuna riga viene cancellata. La sorgente di partenza li porta di nuovo, se li ha | L'opzione B («restano sul conto come movimenti a mano») | N4 |
| H42 | **Q4, con il default (A).** «Annulla passaggio» non ha un limite di tempo: resta disponibile finché la sorgente di partenza è collegata | L'opzione B («30 giorni») | N4 |
| H43 | **Q5, con il default (A).** Il tipo di saldo della banca per il controllo lo sceglie Ledgerly: un tipo per banca, deciso dal dominio. La pagina dice quale tipo usa. La persona non lo cambia | L'opzione B («Confronta con un altro saldo»). Precisa `04-now.md` §4.6 «il tipo di saldo si sceglie per banca»: lo sceglie Ledgerly | N4 |
| H44 | **Q6, con il default (A).** La sezione «Da controllare» del rapporto è solo da leggere: la persona non collega i movimenti a mano | L'opzione B («scegli le coppie a mano»). Conferma il criterio 2 di N4 | N4 |
| H45 | **P1 di N4, con il default (A): l'IBAN non esce da Ledgerly.** L'IBAN di un conto si vede solo nelle pagine di Ledgerly. API, MCP ed export non lo contengono, né intero né mascherato. I log non lo contengono in nessun caso. Le rotte di scrittura del conto accettano l'IBAN; nessuna risposta lo restituisce | L'opzione B («API e MCP mascherato, export intero»). Precisa H39 e la regola «mai in log, API, MCP, export» di §1.5, che ora vale anche per l'IBAN | N4, R2 |
| H46 | **P2 di N4, con il default (A): due campi.** Il conto ha il campo «IBAN» e il campo «Riferimento». Al rilascio Ledgerly copia nel campo «IBAN» i valori di «IBAN o riferimento» che sono un IBAN valido. Il campo vecchio resta, con il nome «Riferimento», e il suo valore non cambia | L'opzione B («un campo solo, come oggi»). Il nome «IBAN o riferimento» del campo di oggi | N4 |
| H47 | **P3 di N4, con il default (A): il campo IBAN è dei conti con movimenti.** Hanno il campo i conti con una modalità (H32): «a mano», «lettura e scrittura», «sola lettura». I conti di investimento e i fondi pensione non lo hanno | L'opzione B («ogni conto, di ogni tipo»). Precisa H39: «ogni conto» vuol dire ogni conto con una modalità | N4 |

### Sezione Addons; plugin dell'admin ritirati (seconda, terza e quarta decisione del 16/11/2026)

Seconda decisione, parole di Mattia: «i plugin vengono gestiti e aggiunti dall'admin, poi gli utenti possono decidere
se attivarli oppure no. Nello specifico Enable Banking: l'application è gestita dall'admin, le altre persone ci si
collegano e basta. Ci deve essere anche la sezione Addons. Un Addon è un modulo core che può essere disattivato dal
singolo utente».
Terza decisione, dopo il fatto che l'applicazione Enable Banking gratuita è «Restricted» (legge solo i conti collegati
nel pannello del proprietario): «annulla la parte dei plugin, la gestiscono gli utenti come nel piano originale».
Risultato: **H48 e H49 sono ritirate (H51); H50 resta.** Per i plugin valgono di nuovo, senza cambi, H25-H30, C1c e C4.
Quarta decisione: «ok default» alle 9 domande sugli addon (PA1, PA9-PA16): è H52. Nessuna domanda è aperta.
Modello, domande decise ed effetti sugli altri rilasci: [`13-plugins-addons.md`](13-plugins-addons.md).

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H48 | **Ritirata lo stesso giorno (H51).** Testo: «I plugin sono gestiti e aggiunti dall'admin. Ogni utente decide solo se attivare un plugin che l'admin ha aggiunto» | Niente: H25 e H27 restano valide | — |
| H49 | **Ritirata lo stesso giorno (H51).** Testo: «Enable Banking: una sola applicazione per istanza, gestita dall'admin. Gli altri utenti collegano solo la loro banca» | Niente: C1c resta valida | — |
| H50 | **Sezione Addons.** Un addon è un modulo del core che il singolo utente può disattivare: un modulo intero (Investments, Work) oppure una sotto-categoria (Payroll, Subscriptions, Budgets, Pockets, Time Off). I moduli necessari al funzionamento di base dell'applicazione non si disattivano. Dettagli: H52 | Precisa D2 «moduli attivabili» e R5a «Moduli attivabili per utente»: nome, elenco di partenza e regola dei moduli di base. D3: Settings ha in più il tab «Addons» | R5a |
| H51 | **I plugin li gestiscono gli utenti, come nel piano prima di H48.** Ogni utente attiva e gestisce i suoi plugin; l'admin non fa niente nell'interfaccia (H25, H27). Enable Banking: ogni utente registra la sua applicazione e inserisce le sue credenziali (C1c). Motivo: l'applicazione gratuita è «Restricted»; con un'applicazione unica l'admin dovrebbe collegare a mano, nel suo pannello di Enable Banking, i conti di ogni altro utente | H48 e H49. Le domande PA2-PA8 non servono più | N1 (già in produzione), R5a, R5c: nessun cambio |
| H52 | **Addons, con i default (PA1, PA9-PA16).** PA1: la sezione Addons entra in R5a; nessun rilascio nuovo. PA9: moduli di base, non disattivabili: Overview, Accounts, Expenses con le categorie, Settings, collegamenti e sorgenti, avvisi, esportazione. Addon: Investments (con i fondi pensione), Work (Payroll, Time Off), Budgets, Subscriptions, Pockets, Interests. PA10: un addon disattivato è spento ovunque: menu, pagine, riquadri di Overview, job, avvisi e mail, API e MCP (errore dichiarato «modulo non attivo»); i dati restano e tornano alla riattivazione. PA11: patrimonio e totali non cambiano; i conti del modulo continuano a contare, con l'ultimo valore letto. PA12: la disattivazione di un addon non spegne e non blocca un altro addon; la funzione che ne dipende resta senza la parte che manca, e Ledgerly elenca cosa si ferma prima della conferma. PA13: per gli utenti di oggi tutti gli addon sono attivi; un utente nuovo sceglie nel primo avvio. PA14: l'admin non limita gli addon. PA15: il nome nelle schermate è «Addons», in italiano e in inglese. PA16: tab proprio, Settings › Addons | Le opzioni B delle domande PA1 e PA9-PA16: rilascio nuovo N7; Interests di base; spento solo nell'interfaccia; conti fuori dai totali; blocco delle dipendenze; tutti attivi per l'utente nuovo; limiti dell'admin; nome «Moduli»; sezione nel tab «Profilo» | R5a; R1, R2, R5b, R5e per gli effetti |
### Impostazioni dei plugin e disattivazione di una sorgente (decisione del 18/11/2026)

Richiesta di Mattia del 17/11/2026; risposta «ok default» alle 6 domande della specifica
[`../plugin-settings.md`](../plugin-settings.md) §8: vale l'opzione A di Q1-Q6.

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H55 | **Pagina del plugin e «Disattiva» che cancella e converte.** 1) Ogni sorgente ha una pagina con tutte le sue impostazioni: collegamento, conti scelti, «Categorie di {sorgente}», pianificazione, storico, scrittura sulla sorgente, «Disattiva» (Q5: N7.2, prima di R5a; R5a cambia solo l'URL). 2) «Disattiva» chiude tutti gli accessi, cancella credenziali e impostazioni della sorgente e converte i dati senza cambiare i numeri: i conti diventano «a mano» con lo stesso saldo (Q3), i movimenti tengono la categoria di Ledgerly, le categorie aggiunte restano, le regole di interessi passano a «solo calcolo», i movimenti «Da inviare» diventano movimenti a mano, i giorni di Trek restano (Q1). 3) Restano solo gli id tecnici della sorgente, mai visibili: alla riattivazione ogni conto torna legato senza doppioni (Q2). 4) «Scollega» chiude un collegamento e tiene conti scelti, pianificazione e storico per il ricollegamento (Q4). 5) Un conto eliminato in Ledgerly non torna con nessuna lettura: la memoria è del core. 6) Alla riattivazione le regole di interessi restano «solo calcolo» (Q6) | H30, prima frase («alla disattivazione le credenziali e l'accesso alle banche restano cifrati nel core») e seconda parte (collegamento «In pausa» di un plugin disattivato, N2 §3.4); N1 §2.3 «Disattiva» che tiene tutto; R5a «Categorie di {sorgente}» nel tab Finance (`12-account-modes.md` §12.5). La terza parte di H30 (Wallet e Trek attivi in R5c per chi ha già un collegamento) resta | N7.1-N7.3; R5a, R5c per gli effetti |

### Test dei rilasci: solo le parti modificate (decisione del 16/11/2026)

Mattia ha letto il rapporto sui test (misure, duplicati, legacy, parallelismo, 21 azioni) e ha risposto: «ok pacchetto
più tutte quelle aggiuntive». Il pacchetto consigliato e le azioni aggiuntive sono approvati; le due azioni che il
rapporto sconsiglia (seed dei soli utenti necessari, unit senza isolamento) no. La regola operativa è nella skill
`test-policy` (§6) e in [`../../testing.md`](../../testing.md); i gate sono in [`03-releases.md`](03-releases.md) §3.1.

| ID | Decisione | Sostituisce | Rilascio |
|---|---|---|---|
| H54 | **«Passa alla banca» accetta anche un conto della banca già importato (opzione A del 17/11/2026).** Caso: il conto della banca è entrato in Ledgerly come conto a sé prima di H39 (N1-N2), quindi lo stesso conto vero è due volte in Ledgerly. Regola: 1) il passo «Conto» del passaggio offre anche i conti della banca già in Ledgerly come conto a sé, con il nome di quel conto («Già in Ledgerly»); non offre un conto che un passaggio ha già portato alla banca, né il conto stesso; 2) la prova a secco abbina ogni movimento del conto già importato a un movimento del conto che passa (gruppi per importo, finestra di 5 giorni, poi testo); se un movimento non trova la coppia, o il conto già importato ha movimenti scritti a mano, non c'è «Applica»; 3) «Applica» collega il conto che passa alla banca; il conto già importato diventa un conto a mano archiviato; i suoi movimenti restano, non contano più (`removed_upstream_at`) e danno il loro link della banca al movimento abbinato; la categoria scelta dalla persona e la nota scritta dalla persona passano al movimento abbinato che non ne ha una della persona; 4) nessuna riga viene cancellata; «Annulla passaggio» riporta i link, i movimenti, le categorie e le note e ridà la banca al conto già importato. L'unione la lancia la persona dall'interfaccia, conto per conto. Diagnosi del caso reale: il conto della banca senza IBAN non poteva ricevere l'IBAN del conto Wallet (H39 punto 4), e il passaggio offriva solo i conti non importati | H39, ultima frase («nessuna unione di due conti in N4»). La specifica `ux/n4-account-switch.md` §4 («solo i conti non ancora in Ledgerly»). L'opzione B del 17/11/2026 (scollegare la banca, cancellare il doppione, ricollegare) | N4 (correzione) |
| H53 | **A ogni rilascio si provano solo le parti modificate.** 1) La mappa `file cambiati → modulo → comando → usato da` e la lista «codice critico o condiviso» sono nel repo (`docs/testing.md`, `scripts/test-map.ts`): un file critico o fuori mappa fa partire la suite completa. 2) Gli E2E girano una volta, sull'anteprima locale, prima del deploy; sul sito dopo il deploy girano solo `@smoke` e i test che l'anteprima non può eseguire. 3) I gate si eseguono una volta, sullo SHA finale; sui commit intermedi: statici, unit e test dei file toccati. 4) Prestazioni: il conteggio delle query sempre, i tempi una serie e solo se il diff tocca query, schema, `platform/api` o `platform/db`. 5) La suite completa gira ogni notte e a fine fase (G10), non a ogni rilascio. 6) La copertura non scende: un test si toglie solo se il rapporto lo indica come duplicato o legacy, con il motivo scritto | I gate G2, G3, G6 e G9 nella versione del 14/11 («`npm run test:integration`» intero, «`npm run e2e` … dopo il deploy», «`npm run perf` esteso» a ogni rilascio); la lettura «G1-G9 = suite completa» delle righe «Test e gate» | Tutti, da N3.1 |

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
| B1 (rev.) | Investments: una home con **2 gruppi**: «Azioni e crypto» e «Fondi pensione». I nomi sono la decisione ST-2. I conti con solo valore stanno nel primo gruppo. Fusione di modello di lettura e interfaccia. I dati dei fondi sono già nel modello unico da N6 (H12). Versione del 13/11/2026, sostituita: 3 gruppi («Azioni e crypto», gruppo dei fondi e dei piani di accumulo, «Pensione»), senza migrazione dei dati dei fondi | `investments-ux.md` §9 decisione 4 («totale solo servizi») e i suoi effetti in §3.1 e §8; `investments-ux.md` §1.1 (mappa delle pagine); `funds-ux.md` §6 direzione A e §10 solo per la home (il dettaglio del fondo resta) | R5b |
| B1b | I fondi passano a `/investments/[id]`; `/funds/*` risponde con un redirect permanente. La voce di menu «Funds» sparisce | `funds-ux.md` §10-§13 per gli URL | R5b |
| B1c | Niente «coming soon» e niente catalogo: dialog «Aggiungi investimento» a 3 scelte. (rev.) Nomi delle scelte: «Collega un servizio», «Segui i tuoi titoli a mano», «Fondo pensione» (decisione ST-3) | `investments.md` §1.1 (D5 per le voci `planned`, D12 catalogo statico), §4.2; `investments-ux.md` §3.7 | R5b |
| B2 | La pensione entra nel totale. Tutti i conti di investimento sono visibili in Investments, anche senza sync | `investments-ux.md` §9 decisione 4; `investments.md` §4.1 | R5b |
| B3 | Tracking manuale: servizio «Portafoglio manuale», modulo unico «Registra operazione» con ricerca per ISIN. (rev.) Esteso da H13: «Piano di acquisto» come secondo passo di R5d | `investments.md` §4.4 (inserimento manuale degli asset); estende §2.6 (conto manuale, solo valore): il servizio nuovo è separato | R5d |
| B4 | Fonti: OpenFIGI + ESMA FIRDS per l'anagrafica; EODHD, BCE, CoinGecko per i prezzi; altre fonti solo come plugin | `investments.md` §6 e D9 (prezzi solo con copertura ≥ 90% del valore): la regola diventa «per strumento» | R5d |
| S3 | Mercato del prezzo: quello dell'ordine, Xetra di riserva | `investments.md` §6 | R5d |
| C1 | Sorgenti bancarie: di default nessuna sync. Enable Banking, Wallet e Trek sono plugin e possono stare insieme | `investments.md` §3.1 solo per l'elenco chiuso dei provider | N1, R5c |
| C1b | eToro e Binance restano nel core. Le loro impostazioni stanno nel tab Finance | `investments.md` §4.2 (servizi elencati anche in Integrations) | R5a |
| C1c | Enable Banking: credenziali **per utente**. Ogni utente registra la sua applicazione. Il core le cifra; il plugin non le salva. | — | N1 |
| C1d | La prima sync parte subito dopo il consenso (storico oltre 90 giorni). Letture automatiche entro il limite della banca. «Sincronizza ora» manda gli header `Psu-*` | — | N1 |
| S4 | La prova su una banca vera è il primo passo dello sviluppo del plugin | — | N1 |
| C2 | Passaggio di un conto da Wallet a Enable Banking: scelta dell'utente, regola M1 | — | N4 |
| S1 | M1 corretta dallo spike: abbinamento per gruppi (conto + importo), controllo del saldo bloccante, prova a secco. **(H39-H44)** Nessun conto con un IBAN già presente; giroconti con gli altri conti della stessa banca su tutto lo storico; tipo di saldo scelto da Ledgerly; «Da controllare» solo da leggere; annullamento senza limite di tempo | — | N4 |
| C4 | Plugin: container separato senza stato, interrogato dal core. Catalogo ufficiale. **(H25, H27, H28)** Nessun passo dell'admin nell'interfaccia: i plugin del catalogo fanno parte dell'installazione standard e ogni utente attiva i suoi. Nessun plugin fuori catalogo. | — | N1, R5c |
| C4b (rev.) | **(H32)** La sorgente Wallet è «lettura e scrittura»: il plugin Wallet legge i movimenti e riceve quelli scritti a mano in Ledgerly. Trek tiene la scrittura delle ferie. Versione del 13/11/2026, sostituita: «Wallet in sola lettura». La pubblicazione degli interessi su Wallet finisce con R5c (ST-14, confermata da H37) | — | R5c |
| K1 | Categorizzazione: cascata (regole → memoria esatta → classificatore lineare per utente → tabelle MCC e marchi → «Da categorizzare») | — | N3 |
| S2 | Memoria severa: «ultime 3 tutte uguali». La copertura si misura a regime | — | N3 |
| K2 | Assegna da sola sopra la soglia di precisione 95%, con segno «automatica». Le automatiche contano subito in budget | — | N3 |
| K3 | Dopo una correzione l'app chiede se applicare ai simili | — | N3 |
| S2b | L'app propone di unire le categorie doppie. **(H34)** Per le categorie di una sorgente che le dà già vale l'associazione, non l'unione | — | N3 |
| K4 | Utente nuovo: circa 12 gruppi predefiniti e revisione guidata | — | N3 (tabelle e revisione), R5a (primo avvio) |
| G10 (rev.) | Movimento manuale disponibile su ogni conto con una modalità (H32): «a mano», «lettura e scrittura», «sola lettura». Su un conto «sola lettura» resta l'avviso. Il movimento cambia il saldo (H33). Non vale per i conti di investimento | — | N3 |
| C5 | Sync log: stato semplice per collegamento. Registro grezzo per utente, sotto «Avanzate», 30 giorni; l'admin vede solo lo stato dei plugin (H29) | — | N2 |
| D1 | Time Off: selezione di primo e ultimo giorno + pannello (tipo, durata), pulsante «Aggiungi assenza». Nessun gesto nascosto | — | N5 |
| D2 | Menu a 3 gruppi («Ogni giorno», «Risparmi e investimenti», «Lavoro»), moduli attivabili, primo avvio guidato. **(H50, H52)** I moduli attivabili sono la sezione «Addons»; i moduli di base non si disattivano | — | R5a |
| D2d | Tab mobile: Overview · Accounts · Expenses · Investments · More | — | R5a |
| D3 | Settings: tab Finance e tab Plugin (di ogni utente: H27). Integrations e Categories spariscono. **(H52)** In più il tab «Addons» | `investments.md` §4.2 | R5a |
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
| Chiavi in sola lettura, controllo all'inserimento | `investments.md` §5.2 | Restano. Eccezioni dichiarate: Trek (`provider.write`) e le sorgenti «lettura e scrittura» (H32) |
| Controllo di pianificazione a 4 modalità | `docs/scheduler.md` | Resta, chiuso sotto «Avanzate» |

## 1.6 Decisioni minori applicate con il default degli allegati

Mattia ha approvato «il resto va bene»: valgono i default dei documenti di brainstorming. I più rilevanti per il piano:

| Tema | Default applicato |
|---|---|
| Preavviso del rinnovo della banca | 14 e 3 giorni, in app e per email |
| Letture automatiche Enable Banking | 3 al giorno, più «Sincronizza ora» |
| Movimenti in sospeso | Esclusi: solo contabilizzati (`BOOK`) |
| Interessi pubblicati su Wallet | Finiscono per i conti passati a Enable Banking; l'accredito arriva dalla banca. (rev.) Con R5c finiscono per tutti i conti: decisione ST-14 |
| Modello di categorizzazione | Salvato in PostgreSQL per utente; fuori da export, API e MCP; si ricostruisce |
| Offline | Nessuna scrittura senza rete. Unica eccezione: un file condiviso in coda (Android) |
| Compatibilità app-istanza | L'app sostiene i livelli API degli ultimi 6 mesi |
| Layout | Tre classi di larghezza: < 600 px, 600-1023 px, ≥ 1024 px |
| Tabelle su schermo piccolo | Scheda per riga sotto 600 px, colonne per priorità fino a 1023 px |
| Widget | «Da fare» e «Questo mese», importi nascosti di default. Nessun widget del patrimonio |
| Windows | Area di notifica e avvio automatico facoltativi, spenti di default |
| iOS | Fuori dal piano |
