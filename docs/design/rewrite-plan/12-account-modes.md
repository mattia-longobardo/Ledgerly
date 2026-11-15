# 12. Modalità dei conti e categorie delle sorgenti

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md). Decisioni: [`01-decisions.md`](01-decisions.md) §1.0, H31-H35
(Mattia, 15/11/2026); H36-H38 per le domande D1-D3. Interfaccia: [`ux/n3-categories-manual.md`](ux/n3-categories-manual.md) §6.4, §9.7, §9.8, §17.
Regole tecniche: [`04-now.md`](04-now.md) §4.4 e §4.5.

Questo file contiene: il concetto delle tre modalità (§12.1-§12.3), le righe del piano aggiornate (§12.4), gli effetti
sugli altri rilasci (§12.5), la proposta sul perimetro di N3 (§12.6) e le altre domande aperte (§12.7).
§12.6 e §12.7 erano domande per Mattia: **decise il 15/11/2026** (D1 B; D2 e D3 con il default). Decisioni H36-H38.

Le stime tecniche di questo file sono una prima lettura del designer. I punti con il segno **[DEV]** vanno confermati
dallo sviluppatore prima dello sviluppo. **Confermati o corretti il 16/11/2026: §12.8.** Dove §12.8 e una riga più
vecchia di questo file dicono cose diverse, vale §12.8.

## 12.1 Le tre modalità di conto (H32)

Ogni conto con movimenti ha una modalità. I conti di investimento non hanno una modalità.

| Modalità | Nome nel codice | Definizione | Oggi |
|---|---|---|---|
| **A mano** | `manual` | Il conto non ha una sorgente. Nessun aggiornamento | Un conto senza collegamento (esempio: «Contanti») |
| **Lettura e scrittura** | `two_way` | La sorgente legge i movimenti e riceve i movimenti scritti in Ledgerly | Un conto Wallet |
| **Sola lettura** | `read_only` | La sorgente legge soltanto. Ledgerly non scrive mai sulla sorgente | Un conto Enable Banking |

Regole:

1. Un nome solo per ogni modalità, in tutto il piano, nel codice e nell'interfaccia. I nomi «bidirezionale» e
   «monodirezionale» non si usano.
2. La modalità è una proprietà **derivata**: nessuna sorgente → «a mano»; la sorgente dichiara la capacità di creare
   un movimento → «lettura e scrittura»; altrimenti → «sola lettura».
3. La regola non contiene nomi di fornitore (H16). Il core chiede «la sorgente sa creare un movimento?», non «la
   sorgente è Wallet?». La colonna «Oggi» è solo un esempio.
4. La modalità è una funzione pura del dominio. L'interfaccia riceve la modalità e il nome del fornitore; non li calcola.
5. Un conto cambia modalità solo quando cambia la sorgente (esempio: il passaggio di N4 porta un conto da «lettura e
   scrittura» a «sola lettura»).

## 12.2 Movimento a mano e saldo (H33, H35)

Un movimento a mano cambia il saldo del conto, su ogni conto con una modalità. Il cambio si vede subito in Accounts,
Overview e nel patrimonio.

| Modalità | Subito | All'aggiornamento successivo |
|---|---|---|
| A mano | Il saldo cambia | Non esiste: il saldo nuovo è definitivo |
| Lettura e scrittura | Il saldo cambia. Il movimento è «da inviare» | Il core scrive il movimento sulla sorgente. Da lì il movimento è della sorgente e il saldo è quello della sorgente |
| Sola lettura | Il saldo cambia, con l'avviso sul possibile doppione | Vale il saldo della sorgente. Il movimento resta, a mano, in Expenses e nei budget |

- Regola del saldo: saldo = ultimo saldo conosciuto + movimenti a mano dopo quella data.
- Un movimento a mano con una data prima dell'ultimo saldo conosciuto non cambia il saldo di oggi.
- Modifica ed eliminazione di un movimento a mano correggono il saldo allo stesso modo.
- Un invio non riuscito si ripete all'aggiornamento successivo. Movimento e saldo nuovo restano in Ledgerly.
- Una lettura non modifica e non elimina un movimento a mano su un conto «a mano» o «sola lettura».

## 12.3 Categorie di una sorgente che le dà già (H34, H35)

- Per ogni categoria della sorgente la persona sceglie: **associa** a una categoria di Ledgerly, oppure **aggiungi**
  come categoria nuova. Le due scelte possono stare insieme.
- Più categorie della sorgente possono corrispondere alla stessa categoria di Ledgerly. Una categoria della sorgente
  corrisponde a una sola categoria di Ledgerly.
- I movimenti della sorgente non si ricategorizzano: la cascata di N3 non li tocca. Contano nella categoria di Ledgerly
  che corrisponde.
- Una categoria nuova della sorgente entra da sola come «aggiunta», con il segno «Nuova». Nessuna lettura si ferma.
- Stato di partenza al rilascio: ogni categoria della sorgente è «aggiunta» con il suo nome, come oggi. Nessun numero
  cambia finché la persona non associa una categoria.
- Un movimento a mano inviato a una sorgente porta la categoria della sorgente che corrisponde a quella scelta.

## 12.4 Righe del piano aggiornate il 15/11/2026

Le 8 righe in conflitto elencate in `ux/n3-categories-manual.md` §18.1.

| # | Punto del piano | Cosa è cambiato |
|---|---|---|
| 1 | `04-now.md` §4.5, link esterno | Su un conto «lettura e scrittura» il movimento a mano riceve un link esterno dopo l'invio |
| 2 | `04-now.md` §4.5, saldo | Regola del saldo aggiunta |
| 3 | `03-releases.md` N3 «Migrazioni»; `06-data.md` §6.1 | Aggiunte: categoria suggerita e motivo; stato dell'invio; corrispondenza delle categorie. Le ultime due sono di N3.1 (H36) |
| 4 | `03-releases.md` N3 criterio 1; `04-now.md` §4.4 «Dove gira» | «Non si ricategorizzano; la persona associa o aggiunge» |
| 5 | `03-releases.md` N3 criterio 6 e «Rollback» | La fotografia dei numeri vale al rilascio. Nota sul saldo con l'immagine precedente |
| 6 | `03-releases.md` N3 «Dimensione» | N3 resta L; nasce N3.1, M (H36) |
| 7 | `01-decisions.md` C4b; `03-releases.md` R5c | Wallet è «lettura e scrittura». Il criterio «il plugin Wallet non scrive sul provider» è sostituito |
| 8 | `01-decisions.md` G10 | Movimento a mano su ogni conto con una modalità |

Altre righe toccate per coerenza: `01-decisions.md` S2b e §1.5 («chiavi in sola lettura»); `09-risks.md` ST-14 e
R-30…R-33; `11-standardization.md` §11.5 (riga `transactions`); indice, premessa 5 e riga N3.

## 12.5 Effetti sugli altri rilasci

Questa sezione elenca gli effetti. Non riscrive i rilasci: ogni rilascio si aggiorna con la sua specifica.

| Rilascio | Effetto | Da confermare |
|---|---|---|
| **N2** | Nessun cambio di perimetro. Un invio non riuscito non crea un avviso proprio: lo stato del collegamento resta quello di N2. Un collegamento «In pausa» non invia: il movimento parte quando il collegamento riparte | **[DEV]** Un invio fallito conta nei «fallimenti consecutivi» del collegamento? Proposta: sì, è un fallimento dell'aggiornamento |
| **N4** | 1) Il passaggio porta un conto da «lettura e scrittura» a «sola lettura». 2) Il controllo bloccante «saldo banca = saldo locale» deve usare il saldo della sorgente, senza i movimenti a mano non ancora inviati. 3) La prova a secco copia sul testo della banca la categoria di Ledgerly che corrisponde alla categoria della sorgente. 4) Dopo il passaggio i movimenti vecchi tengono la categoria della sorgente; i movimenti nuovi passano dalla cascata. 5) Movimenti «da inviare» al momento del passaggio: prima l'invio, poi il passaggio (H38) | **[DEV]** Punto 2: quale saldo legge oggi il controllo |
| **N6, N5, N5.1** | Nessun effetto | — |
| **R1** | L'invio alla sorgente è un passo dell'aggiornamento: nel worker diventa un passo del job di sync, dopo la lettura o prima | **[DEV]** Ordine dei due passi, per non leggere un doppione del movimento appena creato |
| **R2** | 1) Rotte nuove, additive: creazione, modifica ed eliminazione di un movimento a mano, con chiave di idempotenza. 2) Campi nuovi, additivi: modalità del conto in `GET /accounts`; stato dell'invio e origine `manual` sul movimento; saldo di prima e di dopo nella risposta della creazione. 3) Rotte di lettura e di scrittura della corrispondenza delle categorie. 4) Porta `MovementsSource`: oltre alla lettura, la creazione di un movimento. 5) MCP resta in sola lettura (F5b). 6) Il descrittore del fornitore (E5) porta la capacità che decide la modalità | **[DEV]** Scope OAuth per la scrittura dei movimenti: esistente o nuovo (criterio §6 #4 se nuovo) |
| **R3** | Le schermate di N3 (dialogo, «Categorie di {sorgente}») passano a `packages/ui` come le altre. Nessun client calcola il saldo: è un campo dell'API | — |
| **R5a** | 1) «Categorie di {sorgente}» si sposta con Categories nel tab Finance, «Categorie ed etichette». 2) Il glossario unico comprende i tre nomi delle modalità | — |
| **R5c** | 1) Il plugin Wallet dichiara la capacità di creare un movimento e usa `POST /push` del contratto. C4b è rivista: non «sola lettura». 2) Il criterio «il plugin Wallet non scrive sul provider» è sostituito. 3) La corrispondenza delle categorie resta un dato del core, per utente e per sorgente; il plugin dà solo le categorie della sorgente (capacità `categories`). 4) Kit di test del contratto: un caso per `POST /push` con chiave di idempotenza. 5) La pubblicazione degli interessi su Wallet finisce con R5c: ST-14 resta (H37); il plugin Wallet non dichiara `ledgerPosting`. 6) Import CSV (ST-8): un movimento importato su un conto «a mano» cambia il saldo come un movimento a mano? Da decidere con la specifica di R5c; non blocca N3 | **[DEV]** Il nome della capacità (vedi «Contratto dei plugin») |
| **R5f** | Candidati alla rimozione dopo un rilascio stabile: i campi di oggi che legano una categoria di Ledgerly a una categoria di Wallet per nome (`categories.provider_name` e la sync dei nomi nei due sensi), se la corrispondenza li rende inutili | **[DEV]** Elenco delle colonne |
| **R5g** | Nessun effetto sul contenuto. La modalità è un concetto dei conti con movimenti. Trek resta con `provider.write` per le ferie | — |
| **C1, C2 (Android)** | «Aggiungi un movimento a mano» è un'azione rapida possibile (G2). Senza rete nessuna scrittura (F3b): la regola non cambia | Scelta di prodotto alla specifica di C2 |
| **Contratto dei plugin** (`04-now.md` §4.1) | 1) Oggi `POST /push` esiste «solo con `provider.write`» e nessun plugin lo usa per i movimenti. 2) Serve una capacità che dice «la sorgente sa creare un movimento»: è la capacità che decide la modalità «lettura e scrittura». 3) `provider.write` da solo non basta: Trek lo dichiara per le ferie e non ha conti. 4) La risposta di `POST /push` deve dare l'id esterno del movimento creato, per il link e per evitare il doppione. 5) Il contratto v1 cresce in modo additivo: il plugin Enable Banking non cambia | **[DEV]** Nome della capacità (proposta: `createRecord`, accanto a `editRecord`); forma della risposta di `/push`; dove si dichiara la capacità di Wallet in N3, quando Wallet non è ancora un plugin, senza un nome di fornitore nel dominio (lista nota di M12) |

Fatto utile per la stima: oggi il core scrive già un movimento su Wallet, per la pubblicazione degli interessi
(`src/modules/interests/posting.ts`, con un segno di riconoscimento contro i doppioni). La creazione sulla sorgente
non parte da zero. **[DEV]** Da confermare che lo stesso percorso è riusabile per un movimento a mano.

## 12.6 Domanda D1 · perimetro di N3

**Decisione di Mattia del 15/11/2026: opzione B (H36).** Rilascio nuovo: [`03-releases.md`](03-releases.md) «N3.1». Il testo sotto resta come traccia delle due opzioni.

**Esempio.** Sei al bar. Scrivi in Ledgerly una spesa di 4,50 € sul conto Wallet «Contanti», categoria «Ristoranti».
Su Wallet la categoria si chiama «Bar, cafe».

| | A · Tutto in N3 | **B · N3 più il rilascio N3.1 (decisa)** |
|---|---|---|
| Contenuto | N3 = categorie automatiche + movimento a mano con il saldo + invio a Wallet + associazione delle categorie | N3 = categorie automatiche + movimento a mano con il saldo, sui conti «a mano» e «sola lettura». N3.1 = invio dei movimenti a mano alla sorgente + associazione delle categorie |
| L'esempio | Dal rilascio N3: il saldo di «Contanti» scende subito di 4,50 €. Al prossimo aggiornamento Ledgerly scrive la spesa su Wallet con «Bar, cafe». In Settings associ «Bar, cafe» a «Ristoranti» | Dopo N3: il dialogo non offre i conti Wallet; scrivi la spesa su Wallet, come oggi. Le categorie di Wallet restano come oggi. Dopo N3.1: come A |
| Migrazioni in più (oltre al piano) | In N3, tutte additive: categoria suggerita e motivo; stato dell'invio; corrispondenza delle categorie; categoria della sorgente sul movimento. Dati: riempimento della corrispondenza | In N3: solo categoria suggerita e motivo. In N3.1: stato dell'invio; corrispondenza; categoria della sorgente sul movimento; riempimento della corrispondenza |
| Dimensione | N3 oltre L: da dividere in due PR di seguito | N3 = L. N3.1 = M |
| Criteri §6 attesi | #1 (schema e dati). #8 da valutare: Ledgerly scrive dati nuovi su un servizio esterno | N3: #1. N3.1: #1; #8 da valutare |
| OK di Mattia | Un OK, su un SHA che contiene tutto | Due OK, uno per rilascio |
| Rollback | Uno solo. Un movimento già inviato a Wallet resta su Wallet: l'immagine `pre-n3` non lo toglie | Il rollback di N3 non ha effetti fuori da Ledgerly. Solo il rollback di N3.1 lascia movimenti su Wallet |
| Rischi | Un difetto nell'invio o nella corrispondenza ferma anche le categorie automatiche. La fotografia dei numeri deve reggere due cambi insieme (categorie, saldi). Il primo rilascio con scrittura di movimenti su Wallet è anche il più grande | Per un periodo il movimento a mano non esiste sui conti Wallet. Due deploy e due finestre di rilascio. N4 aspetta un rilascio in più, se N3.1 resta prima di N4 |
| Effetto sui tempi | Le categorie automatiche e il movimento a mano arrivano più tardi, insieme al resto | Le categorie automatiche e il movimento a mano arrivano prima. L'invio a Wallet arriva dopo |

Ordine: N3 → N3.1 → N4. N4 dipende solo da N3: se il passaggio dei conti alla banca è più urgente
dell'invio a Wallet, N4 può andare prima di N3.1.

Perché B: N3 è già un rilascio L. L'invio a Wallet è la prima scrittura di movimenti dell'utente su un servizio
esterno e ha un rollback diverso dal resto. In un rilascio a parte ha un suo OK, un suo dump e un criterio di
accettazione proprio.

Punti che lo sviluppatore deve confermare **[DEV]**:

1. La regola del saldo non chiede una migrazione: il saldo si ricava dall'ultimo saldo conosciuto (`balance_entries`)
   più i movimenti a mano dopo quella data. Tocca `deriveMonthEnds` e il patrimonio.
2. La dimensione M di N3.1.
3. Il riempimento della corrispondenza lascia uguale la fotografia dei numeri.
4. Nel periodo tra N3 e N3.1 il dialogo del movimento a mano non offre i conti «lettura e scrittura». L'alternativa
   (offrirli senza invio) dà un saldo che la lettura successiva di Wallet cancella: per questo è scartata.
5. Il criterio §6 #8 per la scrittura su Wallet.

## 12.7 Altre domande: decise

Nate dal controllo degli effetti (§12.5). **Mattia ha scelto il default (A) per tutte e due, il 15/11/2026** (H37, H38).

| # | Domanda | Esempio | A (default) | B | Effetto | Decisione |
|---|---|---|---|---|---|---|
| D2 | Dopo R5c Ledgerly scrive ancora su Wallet gli interessi maturati? La decisione ST-14 dice «no», con il motivo «Wallet in sola lettura». Con H32 il motivo non vale più | Il conto deposito matura 3,20 € a novembre. Oggi Ledgerly scrive l'accredito su Wallet | ST-14 resta: da R5c nessuna pubblicazione. L'accredito arriva dalla banca o si scrive a mano | La pubblicazione resta per i conti ancora su Wallet, come capacità `ledgerPosting` del plugin | A: una scrittura in meno verso Wallet; sui conti ancora su Wallet l'accredito va scritto a mano. B: come oggi; il plugin Wallet ha una capacità in più da scrivere e da provare. Tocca R5c e `interests` in R2 | **A** (H37) |
| D3 | Passaggio di un conto da Wallet alla banca (N4) con movimenti a mano non ancora inviati | Sul conto Wallet «BBVA» hai una spesa a mano di 20 € «Da inviare». Avvii il passaggio a Enable Banking | Il passaggio aggiorna prima Wallet e invia la spesa. Se un movimento resta non inviato, la prova a secco lo elenca e il passaggio si ferma finché lo invii o lo elimini | Il passaggio parte. La spesa resta in Ledgerly come movimento a mano sul conto, ora «sola lettura»; Wallet non la riceve | A: lo storico di Wallet è completo e il controllo del saldo è pulito; un passo in più. B: più rapido; Wallet non ha quel movimento e la spesa può risultare doppia quando la banca la legge. Tocca N4 | **A** (H38) |

Nessuna domanda è aperta.

## 12.8 Conferme dello sviluppatore (16/11/2026)

Lette sul codice di `v0.20.0` (`1e235ab`). Nessuna conferma cambia il perimetro di N3 o di N3.1 e nessuna chiede una
decisione di prodotto. Una sola è una correzione: la regola del saldo (punto 1).

| # | Punto **[DEV]** | Esito | Dettaglio |
|---|---|---|---|
| 1 | §12.6 punto 1 · la regola del saldo non chiede una migrazione | **Corretto** | Nessun dato si sposta, ma serve un cambio di schema: il check `balance_entries_source_ck` si allarga con la fonte `movement` (check allargato: eccezione di [`06-data.md`](06-data.md) §6.2 regola 4). Motivo: oggi il saldo è sempre una riga di `balance_entries`, letta da più di 10 punti (Accounts, Overview, patrimonio, snapshot, Pockets, Subscriptions, export, API, MCP). Calcolare «ultimo saldo + movimenti a mano» in ogni lettura vuol dire toccarle tutte, con una query in più o con SQL sulla tabella di un altro modulo. La regola è invece una funzione pura (`accounts/rules.ts`) che scrive i punti del saldo dopo ogni movimento a mano e dopo ogni saldo nuovo, come già fa `deriveMonthEnds` con la fonte `derived`. Ogni lettura resta com'è e vede lo stesso numero. `deriveMonthEnds` non cambia: i movimenti a mano restano fuori dalla ricostruzione dei mesi passati di un conto con una sorgente |
| 2 | §12.6 punto 1 · «stessa data» | Precisato | «Dopo quella data» = un giorno dopo, oppure lo stesso giorno se il movimento è stato scritto dopo la lettura del saldo. Esempio: scrivi che «Contanti» ha 80 € la mattina e paghi 4,50 € al bar lo stesso giorno: il saldo scende. Una lettura della banca fatta la sera comprende i movimenti scritti prima |
| 3 | §12.6 punto 2 · dimensione M di N3.1 | Confermato | La scrittura di un record su Wallet esiste già nel client (`createRecord`) ed è usata dagli interessi. La parte più grande è la corrispondenza delle categorie sopra la sync dei nomi nei due sensi di oggi |
| 4 | §12.6 punto 3 · il riempimento della corrispondenza lascia uguali i numeri | Confermato | Una riga di corrispondenza per ogni legame `category` di oggi, verso la stessa categoria. Nessuna riga di `transactions` cambia `category_id` |
| 5 | §12.6 punto 4 · tra N3 e N3.1 il dialogo non offre i conti «lettura e scrittura» | Confermato | La modalità è già calcolata in N3 (punto 9). Il dialogo e il servizio rifiutano la modalità `two_way`, non un nome di fornitore |
| 6 | §12.6 punto 5 · criterio §6 #8 per la scrittura su Wallet | Confermato: **sì, in N3.1** | Ledgerly crea record su un servizio esterno e non li può ritirare. N3 non scrive fuori da Ledgerly: #8 no |
| 7 | §12.5 N2 · un invio fallito conta nei «fallimenti consecutivi»? | Confermato, con un limite | Conta un errore del collegamento (rete, accesso rifiutato): è un fallimento del passo dei movimenti. Non conta il rifiuto di un singolo movimento: resta «Non inviato» sulla riga |
| 8 | §12.5 N4 punto 2 · quale saldo legge il controllo | Confermato | Il controllo non esiste ancora. Leggerà solo le righe con fonte `provider`: i movimenti a mano stanno in righe con fonte `movement` (punto 1) e restano fuori senza altra logica |
| 9 | §12.5 Contratto dei plugin · nome della capacità e dove si dichiara in N3 | Confermato | Nome: `createRecord`, accanto a `editRecord` (stesso nome del metodo del client di oggi). Per un plugin arriva dal manifest. Per i fornitori ancora nel core si dichiara in `src/platform/integrations/rules.ts`, accanto a `KINDS_OF`: la cartella dei fornitori. La regola `accountMode` del dominio riceve solo «ha una sorgente» e «la sorgente sa creare un movimento»: la lista nota di M12 non cresce. Risposta di `POST /push` (N3.1): per ogni record l'id esterno e la chiave di idempotenza ricevuta |
| 10 | §12.5 R1 · ordine dei due passi | Confermato | Prima l'invio, poi la lettura. L'invio salva il legame esterno; la lettura riconosce il record dal legame. Se la risposta dell'invio si perde, vale il segno nella nota, come per gli interessi (`postingMarker`) |
| 11 | §12.5 R2 · scope OAuth per la scrittura dei movimenti | Confermato: esistente | Lo scope `write` esiste già (`src/platform/auth/scopes.ts`). Nessuno scope nuovo: criterio §6 #4 no |
| 12 | §12.5 R5f · elenco delle colonne | Confermato | Candidata: `categories.provider_name`, con il segno `name` in `categories.locally_edited` per le categorie non più «aggiunte». I legami `category` e `category_group` di `provider_links` restano: sono la base della corrispondenza. Si decide dopo un rilascio stabile di N3.1 |
| 13 | §12.5 · il percorso degli interessi è riusabile per un movimento a mano | Confermato in parte | Riusabili: `createRecord` del client e il segno contro i doppioni. Non riusabile: `interests/posting.ts`, che è scritto sulle righe degli interessi |
| 14 | `03-releases.md` N3 · dimensione L | Confermato | Due PR in sequenza, ognuna con il suo OK: prima il movimento a mano con le modalità e la regola del saldo, poi le categorie automatiche. La prima è la parte che tocca i saldi: da sola ha una fotografia dei numeri più facile da leggere |

Effetto della correzione 1 sul rollback di N3: l'immagine precedente legge le righe con fonte `movement` come un
saldo qualunque, ma non le aggiorna. File di recupero: `n3-rollback.sql`, che le cancella; i movimenti a mano restano.

